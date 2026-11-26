import { execFile, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import type { Platform } from "../core/db/schema.js";
import { httpUrl } from "../core/http.js";
import type { SyncAttempt } from "./attempt-status.js";

export const adapterIds: Record<Platform, string> = { wechat: "weixin", toutiao: "toutiao" };
export const dryRunTimeoutMs = 15_000;
export const syncTimeoutMs = 7 * 60_000;

function publisherEnv(authenticated: boolean): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0" };
  delete env.MCP_TOKEN;
  delete env.GOLDMINE_ADMIN_PASSWORD;
  if (!authenticated) delete env.WECHATSYNC_TOKEN;
  return env;
}

export function publisherAvailable(command: string): boolean {
  return spawnSync(command, ["--version"], {
    env: publisherEnv(false), stdio: "ignore", timeout: 3_000, windowsHide: true,
  }).status === 0;
}

type CommandResult = {
  exitCode: number | null;
  failedToStart: boolean;
  interrupted: boolean;
  stdout: string;
  stderr: string;
};

export function runPublisher(
  command: string, args: string[], authenticated: boolean, timeout: number,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let interrupted = false;
    try {
      const child = execFile(command, args, {
        env: publisherEnv(authenticated), encoding: "utf8", maxBuffer: 1024 * 1024,
        timeout, killSignal: "SIGKILL", windowsHide: true,
      }, (error, stdout, stderr) => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        resolve({
          exitCode: error ? (typeof error.code === "number" ? error.code : null) : 0,
          failedToStart: child.pid === undefined,
          interrupted: interrupted || Boolean(error?.signal) || Boolean(error?.killed),
          stdout: stripVTControlCharacters(stdout),
          stderr: stripVTControlCharacters(stderr),
        });
      });
      function stop() {
        interrupted = true;
        child.kill("SIGKILL");
      }
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      child.stdin?.end();
    } catch {
      resolve({ exitCode: null, failedToStart: true, interrupted: false, stdout: "", stderr: "" });
    }
  });
}

export async function requirePlatformLogin(command: string, platform: Platform): Promise<void> {
  const result = await runPublisher(command, ["platforms", "--auth"], true, 45_000);
  if (result.failedToStart) throw new Error("Could not start the configured Wechatsync CLI.");
  const adapter = adapterIds[platform];
  const loggedIn = new RegExp(`^\\s*${adapter}\\s+.+?\\s+✓\\s+已登录(?:\\s|$)`, "mu");
  if (result.interrupted || result.exitCode !== 0 || !loggedIn.test(result.stdout)) {
    throw new Error(`Wechatsync did not confirm an active login for ${adapter}.`);
  }
}

export function cleanDraftUrl(value: string): string | null {
  const url = httpUrl(value.trim());
  if (!url) return null;
  url.hash = "";
  for (const name of new Set(url.searchParams.keys())) {
    if (/token|auth|session|cookie|secret|password|signature|credential|(?:^|[_-])key$/i.test(name)) {
      url.searchParams.delete(name);
    }
  }
  const token = process.env.WECHATSYNC_TOKEN;
  if (token && (url.href.includes(token) || url.href.includes(encodeURIComponent(token)))) return null;
  return url.href;
}

export function assertPublisherReferences(html: string, directory: string, allowed: Set<string>): void {
  // The CLI's local-image scanner also recognizes Markdown in HTML inputs.
  const patterns = [/!\[[^\]]*\]\(([^)]+)\)/gu, /<img[^>]+src=["']([^"']+)["'][^>]*>/giu];
  for (const pattern of patterns) {
    for (const [, source] of html.matchAll(pattern)) {
      const value = source?.trim() ?? "";
      if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:")) continue;
      if (!allowed.has(resolve(directory, value))) {
        throw new Error("The article contains an image reference outside the verified build assets.");
      }
    }
  }
}

type Outcome = Pick<SyncAttempt, "exitCode" | "status" | "draftUrl" | "outputExcerpt">;

export function publisherOutcome(result: CommandResult, platform: Platform, dryRun: boolean): Outcome {
  const { exitCode } = result;
  const outcome = (status: Outcome["status"], outputExcerpt: string, draftUrl: string | null = null): Outcome =>
    ({ status, draftUrl, exitCode, outputExcerpt });

  if (result.failedToStart) return outcome("failed", "Could not start the configured Wechatsync CLI.");
  if (dryRun) {
    return exitCode === 0 && !result.interrupted
      ? outcome("succeeded", "Wechatsync completed the dry run.")
      : outcome("failed", "Wechatsync did not complete the dry run.");
  }
  if (result.interrupted) return outcome("unknown", "Wechatsync was interrupted or timed out.");

  const lines = result.stdout.split(/\r?\n/u).map((line) => line.trim());
  const header = lines.lastIndexOf("同步结果:");
  const results = header >= 0 ? lines.slice(header + 1) : [];
  const adapter = adapterIds[platform];
  const positive = results.findIndex((line) => line === `✓ ${adapter} (草稿)` || line === `✓ ${adapter}`);
  const negative = results.findIndex((line) => line === `✗ ${adapter}`);
  const loggedUrl = (positive >= 0 ? results[positive + 1] : undefined) ?? "";
  const draftUrl = cleanDraftUrl(loggedUrl);
  const parsedDraft = draftUrl ? new URL(draftUrl) : null;
  const confirmedDraft = positive >= 0 && (results[positive]?.endsWith("(草稿)") ||
    (platform === "wechat" && parsedDraft?.hostname === "mp.weixin.qq.com" &&
      parsedDraft.searchParams.get("action") === "edit" && parsedDraft.searchParams.has("appmsgid")));
  const missedImages = lines.some((line) => /^图片上传完成: \d+ 成功, [1-9]\d* 失败$/u.test(line));
  if (confirmedDraft && negative < 0 && exitCode === 0) {
    return missedImages
      ? outcome("unknown", "Wechatsync reported a draft and incomplete image uploads.", draftUrl)
      : outcome("succeeded", `Wechatsync reported ${adapter} (草稿).`, draftUrl);
  }

  const platformError = negative >= 0 ? results[negative + 1] ?? "" : "";
  const validationFailure = /^(?:未登录|请先登录|未授权|参数错误|封面(?:图)?(?:缺失|无效|格式错误)|unauthorized\b|invalid (?:argument|parameter|title|cover)\b)/iu;
  const cliError = /^(?:文件不存在:|封面图文件不存在:|无法从文件提取标题|error: (?:unknown option|required option|missing required argument))/imu;
  if (positive < 0 && (validationFailure.test(platformError) || cliError.test(result.stderr))) {
    return outcome("failed", "Wechatsync reported an authentication or input error.");
  }
  return outcome("unknown", "Wechatsync exited without confirming a draft.", draftUrl);
}
