import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { workspacePaths, type WorkspacePaths } from "../src/core/config.js";
import { initializeDatabase, withDatabase } from "../src/core/db/client.js";
import { syncAttempts } from "../src/core/db/schema.js";
import type { GalleyArticle } from "../src/importer/galley.js";
import { saveSnapshot } from "../src/importer/snapshots.js";
import { resolveAttempt, syncBuild } from "../src/publisher/sync.js";
import { recordReview } from "../src/review/reviews.js";
import { distributionStatus } from "../src/review/status.js";
import { buildArticle } from "../src/transform/build.js";

const article: GalleyArticle = {
  schemaVersion: 1, sourceUrl: "https://example.org/posts/sync", slug: "sync", title: "标题",
  summary: "摘要", tags: [], category: null, bodyHtml: "<p>公开正文</p>", images: [],
};

const mock = String.raw`#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(path.join(__dirname, "behavior.json"), "utf8"));
const auth = args[0] === "platforms";
const adapter = auth ? state.adapter || "toutiao" : args[args.indexOf("-p") + 1];
const dry = args.includes("--dry-run");
const cover = args.includes("--cover") && fs.existsSync(args[args.indexOf("--cover") + 1]);
fs.appendFileSync(path.join(__dirname, "calls.jsonl"), JSON.stringify({
  type: args[0], adapter, dry, cover,
  hasToken: Boolean(process.env.WECHATSYNC_TOKEN), hasMcpToken: Boolean(process.env.MCP_TOKEN),
}) + "\n");
if (auth) {
  console.log("  " + adapter + "    平台    " + (state.loggedOut ? "✗ 未登录" : "✓ 已登录 (example)"));
} else if (dry) {
  if (fs.readFileSync(args[1], "utf8").includes("<html")) console.log("(dry-run 模式，不实际同步)");
  else process.exitCode = 1;
} else if (state.mode === "failed") {
  console.log("同步结果:\n  ✗ " + adapter + "\n  请先登录平台");
} else if (state.mode === "unknown") {
  console.log("同步失败，请稍后查看");
} else {
  setTimeout(() => {
    if (state.mode === "partial") console.log("图片上传完成: 2 成功, 1 失败");
    console.log("同步结果:\n  ✓ " + adapter + " (草稿)");
    console.log("https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=42&token=" + process.env.WECHATSYNC_TOKEN);
  }, state.delay || 0);
}
`;

describe("draft delivery", () => {
  let paths: WorkspacePaths;
  let command: string;

  function behavior(state: Record<string, unknown>) {
    writeFileSync(join(paths.root, "behavior.json"), JSON.stringify(state));
  }

  function calls() {
    return readFileSync(join(paths.root, "calls.jsonl"), "utf8").trim().split("\n")
      .filter(Boolean).map((line) => JSON.parse(line) as { type: string });
  }

  beforeEach(() => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-publisher-")));
    initializeDatabase(paths);
    saveSnapshot(paths, article);
    command = join(paths.root, "publisher.cjs");
    writeFileSync(command, mock, { mode: 0o700 });
    writeFileSync(join(paths.root, "calls.jsonl"), "");
    behavior({});
    vi.stubEnv("WECHATSYNC_TOKEN", "temporary-bridge-secret");
    vi.stubEnv("MCP_TOKEN", "unrelated-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(paths.root, { recursive: true, force: true });
  });

  it("runs a dry-run without an approval, login or bridge token", async () => {
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    const attempted = await syncBuild(paths, build.id, command, true);
    expect(attempted).toMatchObject({ mode: "dry_run", status: "succeeded", reviewId: null, exitCode: 0 });
    expect(calls()).toMatchObject([{
      type: "sync", adapter: "toutiao", dry: true, hasToken: false, hasMcpToken: false,
    }]);
    await expect(syncBuild(paths, build.id, command, false)).rejects.toThrow(/valid approval/);
    expect(calls()).toHaveLength(1);
  });

  it("uses the Weixin adapter, strips the draft token, and prevents repeating identical builds", async () => {
    behavior({ adapter: "weixin" });
    const cover = join(paths.root, "cover.png");
    writeFileSync(cover, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR7sAAAAASUVORK5CYII=",
      "base64",
    ));
    const build = await buildArticle(paths, article.slug, { platform: "wechat", cover });
    const review = recordReview(paths, build.id, "approved");
    const succeeded = await syncBuild(paths, build.id, command, false);
    expect(succeeded).toMatchObject({
      status: "succeeded", reviewId: review.id, exitCode: 0,
      draftUrl: "https://mp.weixin.qq.com/cgi-bin/appmsg?action=edit&appmsgid=42",
    });
    expect(JSON.stringify(succeeded)).not.toContain("temporary-bridge-secret");
    expect(calls()).toMatchObject([
      { type: "platforms", hasToken: true, hasMcpToken: false },
      { type: "sync", adapter: "weixin", cover: true, hasToken: true, hasMcpToken: false },
    ]);
    const same = await buildArticle(paths, article.slug, { platform: "wechat" });
    recordReview(paths, same.id, "approved");
    await expect(syncBuild(paths, same.id, command, false)).rejects.toThrow(/already synced/);
    expect(calls()).toHaveLength(2);
  });

  it("treats a clear failure as retryable and requires a decision for an ambiguous result", async () => {
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    recordReview(paths, build.id, "approved");

    behavior({ loggedOut: true });
    await expect(syncBuild(paths, build.id, command, false)).rejects.toThrow(/active login/);
    expect(distributionStatus(paths)[0]?.builds[0]?.attempts).toEqual([]);

    behavior({ mode: "failed" });
    expect(await syncBuild(paths, build.id, command, false)).toMatchObject({ status: "failed", exitCode: 0 });
    behavior({ mode: "unknown" });
    const unknown = await syncBuild(paths, build.id, command, false);
    expect(unknown).toMatchObject({ status: "unknown", exitCode: 0, draftUrl: null });

    saveSnapshot(paths, { ...article, bodyHtml: "<p>已修订</p>" });
    const revised = await buildArticle(paths, article.slug, { platform: "toutiao" });
    recordReview(paths, revised.id, "approved");
    await expect(syncBuild(paths, revised.id, command, false)).rejects.toThrow(/resolve sync attempt/);
    expect(() => resolveAttempt(paths, unknown.id, "failed", " ")).toThrow(/note is required/);
    expect(resolveAttempt(paths, unknown.id, "failed", "Draft box checked")).toMatchObject({
      status: "failed", resolutionNote: "Draft box checked",
    });
    behavior({});
    expect(await syncBuild(paths, revised.id, command, false)).toMatchObject({ status: "succeeded" });
  });

  it("classifies an incomplete delivery with a draft as unknown and can confirm it manually", async () => {
    behavior({ mode: "partial" });
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    recordReview(paths, build.id, "approved");
    const unknown = await syncBuild(paths, build.id, command, false);
    expect(unknown).toMatchObject({ status: "unknown", draftUrl: expect.stringContaining("appmsgid=42") });
    expect(resolveAttempt(paths, unknown.id, "succeeded", "Draft checked",
      "https://mp.toutiao.com/editor?draft=42&session=private")).toMatchObject({
      status: "succeeded", draftUrl: "https://mp.toutiao.com/editor?draft=42",
    });
    await expect(syncBuild(paths, build.id, command, false)).rejects.toThrow(/already synced/);
  });

  it("allows one concurrent attempt and treats a stale pending record as unknown", async () => {
    behavior({ delay: 120 });
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    const review = recordReview(paths, build.id, "approved");
    const copies = await Promise.allSettled([
      syncBuild(paths, build.id, command, false), syncBuild(paths, build.id, command, false),
    ]);
    expect(copies.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(calls().filter(({ type }) => type === "sync")).toHaveLength(1);

    const stale = withDatabase(paths, false, (db) => db.insert(syncAttempts).values({
      buildId: build.id, bundleSha256: build.bundleSha256, reviewId: review.id, mode: "sync", status: "pending",
      startedAt: "2020-01-01T00:00:00.000Z", deadlineAt: "2020-01-01T00:07:00.000Z",
    }).returning().get());
    expect(distributionStatus(paths)[0]?.builds[0]?.attempts[0]?.status).toBe("unknown");
    expect(resolveAttempt(paths, stale.id, "failed", "No draft found").resolvedAt).toBeTruthy();
  });

  it("stops before delivery when files changed or the build has blocking warnings", async () => {
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    recordReview(paths, build.id, "approved");
    appendFileSync(build.files.html, "changed");
    await expect(syncBuild(paths, build.id, command, false)).rejects.toThrow(/changed/);

    const withoutCover = await buildArticle(paths, article.slug, { platform: "wechat" });
    recordReview(paths, withoutCover.id, "approved");
    await expect(syncBuild(paths, withoutCover.id, command, false)).rejects.toThrow(/blocking warnings/);
    expect(calls()).toEqual([]);
  });

  it("rejects local paths outside the approved asset list before delivery", async () => {
    saveSnapshot(paths, { ...article, bodyHtml: "<pre><code>![example](./sample.png)</code></pre>" });
    const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
    recordReview(paths, build.id, "approved");
    await expect(syncBuild(paths, build.id, command, false)).rejects.toThrow(/outside the verified build assets/);
    expect(calls().map(({ type }) => type)).toEqual(["platforms"]);
  });
});
