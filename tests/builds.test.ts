import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { load } from "cheerio";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { workspacePaths, type WorkspacePaths } from "../src/core/config.js";
import { initializeDatabase, withDatabase } from "../src/core/db/client.js";
import { assets } from "../src/core/db/schema.js";
import type { GalleyArticle } from "../src/importer/galley.js";
import { saveSnapshot } from "../src/importer/snapshots.js";
import { buildArticle } from "../src/transform/build.js";

const pixel = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR7sAAAAASUVORK5CYII=",
  "base64",
);

describe("platform builds", () => {
  let paths: WorkspacePaths;
  let article: GalleyArticle;
  let origin: string;
  let downloads = 0;
  const server = createServer((request, response) => {
    if (request.url === "/image.png") {
      downloads += 1;
      response.writeHead(200, { "content-type": "image/png" }).end(pixel);
      return;
    }
    response.writeHead(404).end();
  });

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => { server.close(); });

  beforeEach(() => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-builds-")));
    initializeDatabase(paths);
    article = {
      schemaVersion: 1, sourceUrl: `${origin}/posts/example`, slug: "example", title: "文章",
      summary: "摘要", tags: [], category: null, bodyHtml: "<p>公开正文</p>", images: [],
    };
    downloads = 0;
  });
  afterEach(() => { rmSync(paths.root, { recursive: true, force: true }); });

  it("normalizes public components, emits safe files, and reuses an image within the build", async () => {
    saveSnapshot(paths, {
      ...article,
      bodyHtml: `<p>公开正文与 <a href="../posts/source">出处</a>
        <a href="file:///private/fixture">local file</a></p>
        <script>private fixture</script><style>body{display:none}</style>
        <details class="galley-fold"><summary>更多</summary><p>保留内容</p></details>
        <aside class="galley-callout galley-callout-tip" onclick="void(0)">这里是提示</aside>
        <figure class="galley-figure"><p>知识块</p><figcaption>资料</figcaption></figure>
        <pre><code class="language-js">const a = 1;</code></pre>
        <img src="/image.png" alt="第一张图" srcset="/unread.png 2x">
        <img src="/image.png" alt="重复的图">`,
    });
    const build = await buildArticle(paths, "example", { platform: "wechat" });
    const $ = load(readFileSync(build.files.html, "utf8"));
    expect(downloads).toBe(1);
    expect(build.assets).toHaveLength(1);
    expect(build.cover?.kind).toBe("image");
    expect(build.warnings.map(({ code }) => code)).toEqual(["cover-from-body"]);
    expect($("img").first().attr("src")).toBe(`../../assets/${build.assets[0]?.file}`);
    expect($("img").last().attr("src")).not.toBe($("img").first().attr("src"));
    expect(resolve(build.files.directory, $("img").last().attr("src") ?? "")).toBe(join(paths.assets, build.assets[0]!.file));
    expect($("a").first().attr("href")).toBe(`${origin}/posts/source`);
    expect($("a").last().attr("href")).toBeUndefined();
    expect($("details, script, style, [onclick], [srcset]")).toHaveLength(0);
    expect($(".goldmine-fold").text()).toBe("更多保留内容");
    expect($(".goldmine-callout").text()).toBe("提示这里是提示");
    expect($("figure figcaption").text()).toBe("资料");
    expect($("p").first().attr("style")).toMatch(/line-height/);
    expect(readFileSync(build.files.markdown, "utf8")).toContain("```js\nconst a = 1;");
    expect(readFileSync(build.files.preview, "utf8")).toContain("default-src 'none'");
  });

  it("uses overrides per platform and refreshes metadata taken from a new snapshot", async () => {
    const coverFile = join(paths.root, "cover.png");
    writeFileSync(coverFile, pixel);
    saveSnapshot(paths, article);
    const first = await buildArticle(paths, "example", { platform: "wechat", title: "定稿标题", cover: coverFile });
    const repeated = await buildArticle(paths, "example", { platform: "wechat" });
    expect(repeated.revision).toBe(2);
    expect(repeated.bundleSha256).toBe(first.bundleSha256);

    saveSnapshot(paths, { ...article, title: "新标题", summary: "新摘要" });
    const wechat = await buildArticle(paths, "example", { platform: "wechat" });
    const toutiao = await buildArticle(paths, article.sourceUrl, { platform: "toutiao" });
    expect(wechat).toMatchObject({ title: "定稿标题", summary: "新摘要", cover: first.cover, revision: 3, version: 2 });
    expect(toutiao).toMatchObject({ title: "新标题", summary: "新摘要", cover: null, revision: 1, version: 2 });
    expect(readFileSync(toutiao.files.html, "utf8")).not.toContain("style=");
  });

  it("caches browser-free formulas and preserves missing components as blocking warnings", async () => {
    saveSnapshot(paths, {
      ...article,
      bodyHtml: `<p><span class="katex"><math><semantics><annotation encoding="application/x-tex">x^2+1</annotation>
        </semantics></math></span></p>
        <figure class="galley-mermaid"><div class="galley-mermaid-placeholder"></div></figure>
        <img src="/missing.png" alt="没有图片">`,
    });
    const first = await buildArticle(paths, "example", { platform: "wechat" });
    const second = await buildArticle(paths, "example", { platform: "wechat" });
    expect(first.assets).toMatchObject([{ kind: "katex" }]);
    expect(first.warnings).toMatchObject([
      { code: "image-unavailable", severity: "blocking" },
      { code: "mermaid-source-missing", severity: "blocking" },
      { code: "cover-required", severity: "blocking" },
    ]);
    expect(second.bundleSha256).toBe(first.bundleSha256);
    expect(withDatabase(paths, true, (db) => db.select().from(assets).all())).toHaveLength(1);
    expect(readFileSync(first.files.markdown, "utf8")).toMatch(/没有图片/);
  });
});
