import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readAsset, storedImageType } from "../core/assets.js";
import { initializeConfig, loadConfig, type WorkspacePaths } from "../core/config.js";
import { initializeDatabase } from "../core/db/client.js";
import { isErrno, sha256 } from "../core/files.js";
import { maxDownloadBytes } from "../core/http.js";
import { readGalleyArticle } from "../importer/galley.js";
import { listArticles, saveSnapshot } from "../importer/snapshots.js";
import { resolveAttempt, syncBuild } from "../publisher/sync.js";
import { getBuild } from "../review/bundle.js";
import { previewBuild, recordReview } from "../review/reviews.js";
import { distributionStatus } from "../review/status.js";
import { buildArticle } from "../transform/build.js";
import { createAdminAuth } from "./auth.js";
import { script, styles } from "./client.js";
import {
  articleHref, articlePage, dashboardPage, errorPage, jobPage, loginPage, platformNames, type JobView,
} from "./pages.js";

const formBytes = 16 * 1024;
const pageCsp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const previewCsp = "sandbox allow-same-origin; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

class WebError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function webOrigin(value: string) {
  const url = URL.parse(value);
  const loopback = url && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (!url || url.href !== url.origin + "/" || url.username || url.password
    || (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))) {
    throw new Error("Set GOLDMINE_WEB_ORIGIN to the browser's HTTPS origin or a local HTTP origin.");
  }
  return url;
}

function send(response: ServerResponse, content: string | Buffer, type = "text/html; charset=utf-8", status = 200) {
  response.writeHead(status, { "Content-Type": type });
  response.end(content);
}

function redirect(response: ServerResponse, location: string) {
  response.writeHead(303, { Location: location });
  response.end();
}

async function readForm(request: IncomingMessage, withFile = false) {
  const type = request.headers["content-type"] ?? "";
  const mediaType = type.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "application/x-www-form-urlencoded" && !(withFile && mediaType === "multipart/form-data")) {
    throw new WebError(415, "请用页面上的表单提交操作。");
  }
  const limit = mediaType === "multipart/form-data" ? maxDownloadBytes + formBytes : formBytes;
  if (Number(request.headers["content-length"]) > limit) throw new WebError(413, "表单或封面文件超出大小限制。");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > limit) throw new WebError(413, "表单或封面文件超出大小限制。");
    chunks.push(chunk);
  }
  try {
    return await new Response(new Uint8Array(Buffer.concat(chunks, size)), {
      headers: { "Content-Type": type },
    }).formData();
  } catch {
    throw new WebError(400, "无法读取表单，请重新提交。");
  }
}

function textField(form: FormData, name: string, limit: number, message: string) {
  const value = form.get(name);
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new WebError(400, message);
  return value.trim();
}

function preview(response: ServerResponse, paths: WorkspacePaths, buildId: string) {
  const build = previewBuild(paths, buildId);
  const content = readFileSync(build.files.preview);
  if (sha256(content) !== build.previewSha256) throw new WebError(409, "预览内容已改变，请重新构建。");
  response.setHeader("Content-Security-Policy", previewCsp);
  return send(response, content);
}

function image(response: ServerResponse, paths: WorkspacePaths, hash: string, extension: string) {
  const type = storedImageType(extension);
  if (!type) throw new WebError(404, "找不到素材。");
  const file = `${hash}.${extension}`;
  try {
    return send(response, readAsset(paths, { file, sha256: hash }), type);
  } catch (error) {
    if (isErrno(error, "ENOENT")) throw new WebError(404, "找不到素材。");
    throw error;
  }
}

export async function createWebServer(paths: WorkspacePaths, options: {
  origin: string;
  password: string;
  galleyUrl?: string;
}) {
  const origin = webOrigin(options.origin);
  const auth = await createAdminAuth(options.password, origin.protocol === "https:");
  initializeConfig(paths, options.galleyUrl);
  initializeDatabase(paths);

  const jobs = new Map<string, JobView>();
  let activeJob: JobView | undefined;
  function startJob(response: ServerResponse, title: string, href: string,
    work: () => Promise<{ message: string; href?: string }>) {
    if (activeJob?.state === "running") throw new WebError(409, "上一项操作仍在进行。请返回工作区查看进度。");
    const job: JobView = { id: randomUUID(), title, href, state: "running", message: `正在${title}，请稍候。` };
    if (jobs.size >= 16) jobs.delete(jobs.keys().next().value!);
    jobs.set(job.id, job);
    activeJob = job;
    redirect(response, `/jobs/${job.id}`);
    void work().then((result) => {
      job.state = "done";
      job.message = result.message;
      job.href = result.href ?? href;
    }, (error: unknown) => {
      job.state = "failed";
      job.message = error instanceof Error ? error.message : "操作失败，请重试。";
    });
  }

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const { method } = request;
    const path = request.url ?? "/";
    if (request.headers.host?.toLowerCase() !== origin.host || !path.startsWith("/")) {
      throw new WebError(400, "访问地址与后台配置不一致。");
    }
    const url = new URL(path, origin);
    if (url.origin !== origin.origin) throw new WebError(400, "无效的访问地址。");
    if (method !== "GET" && method !== "POST") throw new WebError(405, "此页面不支持该请求方法。");
    if (method === "POST" && request.headers.origin !== origin.origin) {
      throw new WebError(403, "请从后台页面重新提交操作。");
    }

    const route = url.pathname;
    if (method === "GET" && route === "/app.css") return send(response, styles, "text/css; charset=utf-8");
    if (method === "GET" && route === "/app.js") return send(response, script, "text/javascript; charset=utf-8");
    const session = auth.session(request);

    if (route === "/login") {
      if (method === "GET") return session ? redirect(response, "/") : send(response, loginPage());
      const form = await readForm(request);
      const username = form.get("username");
      const password = form.get("password");
      if (typeof username !== "string" || typeof password !== "string" || password.length > 256) {
        return send(response, loginPage("请输入管理员账号和密码。"), undefined, 400);
      }
      const result = await auth.login(request, response, username, password);
      if (result === "ok") return redirect(response, "/");
      if (result === "limited") return send(response, loginPage("登录尝试过于频繁，请稍后再试。"), undefined, 429);
      return send(response, loginPage("账号或密码不正确。"), undefined, 401);
    }
    if (!session) {
      if (method === "GET") return redirect(response, "/login");
      throw new WebError(401, "登录已失效，请重新登录。");
    }

    if (method === "GET") {
      if (route === "/") {
        return send(response, dashboardPage(listArticles(paths), loadConfig(paths).galley.baseUrl, session.csrf, activeJob));
      }
      if (route === "/article") {
        const source = url.searchParams.get("source");
        if (!source) throw new WebError(400, "请选择已导入的文章。");
        const article = distributionStatus(paths, source)[0]!;
        return send(response, articlePage(article, session.csrf, activeJob));
      }
      const jobId = /^\/jobs\/([a-f0-9-]{36})$/u.exec(route)?.[1];
      if (jobId) {
        const job = jobs.get(jobId);
        if (!job) throw new WebError(404, "操作记录已过期。请返回工作区查看已保存的结果。");
        return url.searchParams.has("status")
          ? send(response, JSON.stringify(job), "application/json; charset=utf-8")
          : send(response, jobPage(job, session.csrf));
      }
      const buildId = /^\/builds\/([a-f0-9-]{36})\/preview\.html$/u.exec(route)?.[1];
      if (buildId) return preview(response, paths, buildId);
      const asset = /^\/assets\/([a-f0-9]{64})\.([a-z]+)$/u.exec(route);
      if (asset) return image(response, paths, asset[1]!, asset[2]!);
      throw new WebError(404, "找不到页面。");
    }

    const form = await readForm(request, route === "/build");
    if (form.get("csrf") !== session.csrf || auth.session(request) !== session) {
      throw new WebError(403, "页面已过期，请刷新后再提交。");
    }
    if (route === "/logout") {
      auth.logout(response, session);
      return redirect(response, "/login");
    }
    if (route === "/import") {
      const baseUrl = loadConfig(paths).galley.baseUrl;
      if (!baseUrl) throw new WebError(400, "请先设置工作区的 Galley 站点。");
      const source = textField(form, "source", 2048, "请输入公开文章链接或 slug。");
      return startJob(response, "导入文章", "/", async () => {
        const entry = saveSnapshot(paths, await readGalleyArticle(source, baseUrl));
        const message = entry.created ? `已导入快照 v${entry.version}。` : `已存在相同内容的快照 v${entry.version}。`;
        return { message, href: articleHref(entry.sourceUrl) };
      });
    }
    if (route === "/build") {
      const source = textField(form, "source", 2048, "请选择已导入的文章。");
      const platform = form.get("platform");
      if (platform !== "wechat" && platform !== "toutiao") throw new WebError(400, "请选择目标平台。");
      const upload = form.get("cover");
      if (upload !== null && !(upload instanceof File)) throw new WebError(400, "请选择封面图片。");
      const label = platformNames[platform];
      return startJob(response, `构建${label}版本`, articleHref(source), async () => {
        const cover = upload?.name ? new Uint8Array(await upload.arrayBuffer()) : undefined;
        const build = await buildArticle(paths, source, { platform, cover });
        return { message: `已生成${label}预览。`, href: articleHref(build.sourceUrl) };
      });
    }
    if (route === "/review" || route === "/sync") {
      const id = textField(form, "build", 36, "请选择平台构建。");
      const build = getBuild(paths, id);
      const href = articleHref(build.sourceUrl);
      if (route === "/review") {
        const decision = form.get("decision");
        if (decision !== "approved" && decision !== "rejected") throw new WebError(400, "请选择审核结果。");
        return startJob(response, "记录审核", href, async () => {
          recordReview(paths, id, decision);
          return { message: decision === "approved" ? "已记录审核通过。" : "已退回该版本。" };
        });
      }
      const mode = form.get("mode");
      if (mode !== "dry-run" && mode !== "draft") throw new WebError(400, "请选择同步方式。");
      const dryRun = mode === "dry-run";
      const command = loadConfig(paths).publisher.command;
      return startJob(response, dryRun ? "同步预演" : "同步草稿", href, async () => {
        const attempt = await syncBuild(paths, id, command, dryRun);
        if (attempt.status === "unknown") throw new Error("同步结果待核对。请检查平台草稿箱并记录结果。");
        if (attempt.status !== "succeeded") throw new Error(attempt.outputExcerpt || "同步失败。");
        return { message: dryRun ? "预演通过。" : "草稿已同步，请到平台核对正文和封面。" };
      });
    }
    if (route === "/resolve") {
      const input = textField(form, "attempt", 16, "缺少同步记录。");
      const id = Number(input);
      if (!/^\d+$/u.test(input) || !Number.isSafeInteger(id) || id < 1) throw new WebError(400, "无效的同步记录。");
      const resolution = form.get("resolution");
      if (resolution !== "succeeded" && resolution !== "failed") throw new WebError(400, "请选择核对结果。");
      const note = textField(form, "note", 500, "请填写核对备注。");
      return startJob(response, "记录核对结果", "/", async () => {
        const attempt = resolveAttempt(paths, id, resolution, note);
        const build = getBuild(paths, attempt.buildId);
        return { message: "已保存草稿核对结果。", href: articleHref(build.sourceUrl) };
      });
    }
    throw new WebError(404, "找不到操作。");
  }

  return createServer({ requestTimeout: 30_000 }, (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", pageCsp);
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "same-origin");
    void handle(request, response).catch((error: unknown) => {
      if (response.writableEnded || response.destroyed) return;
      const status = error instanceof WebError ? error.status : 500;
      const message = error instanceof WebError ? error.message : "后台无法完成操作，请在服务器检查日志。";
      if (!(error instanceof WebError)) console.error("Goldmine web request failed", error);
      if (status === 413) response.setHeader("Connection", "close");
      send(response, errorPage(message, auth.session(request)?.csrf), undefined, status);
    });
  });
}
