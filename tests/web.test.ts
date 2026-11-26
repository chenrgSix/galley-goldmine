import { once } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { load } from "cheerio";
import { request as sendRequest } from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConfig, workspacePaths, type WorkspacePaths } from "../src/core/config.js";
import { createWebServer } from "../src/web/server.js";
import type { JobView } from "../src/web/pages.js";

const origin = new URL("https://goldmine.example.test");
const password = "goldmine-ephemeral-test";
const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR7sAAAAASUVORK5CYII=",
  "base64",
);

async function listen(server: Server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe("Goldmine dashboard", () => {
  const source = createServer((request, response) => {
    if (request.url !== "/posts/example") return response.writeHead(404).end();
    response.writeHead(200, { "Content-Type": "text/html" }).end(`
      <article class="galley-article">
        <header class="galley-article-header"><h1 class="galley-title">测试文章</h1></header>
        <div class="galley-prose"><p>公开文章正文</p></div>
      </article>`);
  });
  let galleyUrl: string;
  let paths: WorkspacePaths;
  let server: Server;
  let address: string;
  let cookie: string;
  let csrf: string;

  beforeAll(async () => { galleyUrl = await listen(source); });
  afterAll(() => { source.close(); });
  beforeEach(async () => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-web-test-")));
    cookie = "";
    csrf = "";
    server = await createWebServer(paths, { origin: origin.origin, password, galleyUrl });
    address = await listen(server);
  });
  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
    rmSync(paths.root, { recursive: true, force: true });
  });

  async function request(path: string, options: { body?: URLSearchParams | FormData; headers?: HeadersInit } = {}) {
    const headers = new Headers({ Host: origin.host, Cookie: cookie, Origin: origin.origin });
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    const payload = options.body && new Response(options.body);
    if (payload) headers.set("Content-Type", payload.headers.get("Content-Type")!);
    const response = await sendRequest(address + path, {
      method: payload ? "POST" : "GET",
      headers: Object.fromEntries(headers),
      body: payload ? new Uint8Array(await payload.arrayBuffer()) : undefined,
    });
    const returned = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (typeof value === "string") returned.set(key, value);
      else for (const item of value ?? []) returned.append(key, item);
    }
    return new Response(await response.body.arrayBuffer(), { status: response.statusCode, headers: returned });
  }

  function post(path: string, fields: Record<string, string> | FormData, headers?: HeadersInit) {
    const body = fields instanceof FormData ? fields : new URLSearchParams({ csrf, ...fields });
    return request(path, { body, headers });
  }

  async function login() {
    const res = await post("/login", { username: "admin", password });
    expect(res.status).toBe(303);
    const session = res.headers.get("set-cookie")!;
    expect(session).toMatch(/^__Host-goldmine_session=.+; Path=\/; Max-Age=28800; HttpOnly; SameSite=Strict; Secure$/u);
    cookie = session.split(";")[0]!;
    const page = load(await (await request("/")).text());
    csrf = page("form[action='/logout'] input[name='csrf']").attr("value")!;
    expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  }

  async function complete(response: Response) {
    expect(response.status).toBe(303);
    const location = response.headers.get("location")!;
    expect(location).toMatch(/^\/jobs\//u);
    return vi.waitUntil(async () => {
      const result: JobView = await (await request(location + "?status=1")).json();
      return result.state === "running" ? false : result;
    }, { interval: 20, timeout: 2500 });
  }

  it("protects all workspace routes and revokes a signed-in session at logout", async () => {
    for (const path of ["/", "/article?source=example", "/builds/12345678-1234-1234-1234-123456789abc/preview.html",
      `/assets/${"a".repeat(64)}.png`]) {
      expect((await request(path)).headers.get("location")).toBe("/login");
    }
    expect((await post("/import", { source: "example" })).status).toBe(401);
    expect((await post("/login", { username: "admin", password: "wrong" })).status).toBe(401);
    expect((await post("/login", { username: "admin", password }, { Origin: "https://foreign.example" })).status).toBe(403);
    await login();
    expect(await (await request("/")).text()).toContain("文章工作区");
    expect((await request("/", { headers: { Host: "foreign.example" } })).status).toBe(400);
    expect((await post("/import", { source: "example", csrf: "invalid" })).status).toBe(403);
    expect((await post("/import", { source: "example" }, { Origin: "https://foreign.example" })).status).toBe(403);
    expect((await post("/logout", {})).headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await request("/")).headers.get("location")).toBe("/login");
  });

  it("uses saved imports and the same build, review, and draft gates as the CLI", async () => {
    const publisher = join(paths.root, "mock-publisher");
    writeFileSync(publisher, `#!/usr/bin/env node
if (process.env.GOLDMINE_ADMIN_PASSWORD) process.exit(9);
if (process.argv[2] === "platforms") console.log("  weixin    微信公众号    ✓ 已登录");
else if (process.argv.includes("--dry-run")) console.log("dry-run 模式");
else console.log("同步结果:\\n  ✓ weixin (草稿)\\nhttps://example.test/draft?token=temporary-token");
`, { mode: 0o700 });
    const config = loadConfig(paths);
    config.publisher.command = publisher;
    writeFileSync(paths.config, JSON.stringify(config));
    vi.stubEnv("WECHATSYNC_TOKEN", "temporary-token");
    vi.stubEnv("GOLDMINE_ADMIN_PASSWORD", password);
    await login();

    const imported = await complete(await post("/import", { source: galleyUrl + "/posts/example" }));
    expect(imported).toMatchObject({ state: "done", message: "已导入快照 v1。" });
    const form = new FormData();
    form.set("csrf", csrf);
    form.set("source", galleyUrl + "/posts/example");
    form.set("platform", "wechat");
    form.set("cover", new Blob([new Uint8Array(pixel)], { type: "image/png" }), "cover.png");
    const built = await complete(await post("/build", form));
    expect(built).toMatchObject({ state: "done", href: imported.href, message: "已生成微信公众号预览。" });

    const page = load(await (await request(built.href)).text());
    const previewPath = page("a[href$='/preview.html']").attr("href")!;
    const build = page("input[name='build']").first().attr("value")!;
    const preview = await request(previewPath);
    expect(preview.headers.get("content-security-policy")).toContain("sandbox allow-same-origin");
    const previewHtml = load(await preview.text());
    expect(previewHtml("article").text()).toContain("公开文章正文");
    const imagePath = new URL(previewHtml("img.cover").attr("src")!, new URL(previewPath, origin)).pathname;
    const image = await request(imagePath);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await image.arrayBuffer())).toEqual(pixel);
    expect((await request(previewPath, { headers: { Cookie: "" } })).headers.get("location")).toBe("/login");
    expect((await request(imagePath, { headers: { Cookie: "" } })).headers.get("location")).toBe("/login");

    expect(await complete(await post("/sync", { build, mode: "draft" }))).toMatchObject({
      state: "failed", message: expect.stringContaining("valid approval"),
    });
    expect(await complete(await post("/sync", { build, mode: "dry-run" }))).toMatchObject({ state: "done" });
    expect(await complete(await post("/review", { build, decision: "approved" }))).toMatchObject({ state: "done" });
    expect(await complete(await post("/sync", { build, mode: "draft" }))).toMatchObject({ state: "done" });
    const synced = await (await request(built.href)).text();
    expect(synced).toContain("打开平台草稿");
    expect(synced).not.toContain("temporary-token");
  });
});
