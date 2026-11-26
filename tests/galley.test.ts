import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readGalleyArticle } from "../src/importer/galley.js";

const fixture = readFileSync(new URL("./fixtures/published-article.html", import.meta.url));
const stepsFixture = fixture.toString("utf8").replace('<div class="galley-prose">', `<div class="galley-prose">
  <figure class="galley-codesteps">
    <header><span class="galley-codesteps-file">Two steps</span><span class="galley-codesteps-count">1 / 2</span></header>
    <div class="galley-codesteps-code"><pre><code><span class="galley-codesteps-line">  $first</span></code></pre></div>
  </figure>`);
const stepsProps = {
  title: "Two steps", lang: "JavaScript",
  steps: [
    { file: "$undefined", lines: [{ node: ["$", "$1", "0", { children: [["$", "span", null, { children: "  $first" }]] }] }] },
    { file: "demo.js", lines: [{ node: ["$", "span", null, { children: "$$second" }] }] },
  ],
  texts: ["First note", "Second note"],
};
const flightSteps = [
  '58:I[731007,["$1f"],"CodeStepsPlayer"]',
  "37:" + JSON.stringify(["$", "section", null, { children: ["$", "$L58", "galley-code-steps-0", stepsProps] }]),
  "",
].join("\n");
const stepsScript = "<script>self.__next_f.push(" + JSON.stringify([1, flightSteps]) + ")</script>";

describe("Galley article reader", () => {
  let origin: string;
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(request.url ?? "");
    switch (request.url) {
      case "/posts/old-fixture":
        response.writeHead(302, { location: "/posts/fixture" }).end();
        return;
      case "/posts/other-site":
        response.writeHead(302, { location: "https://example.org/posts/fixture" }).end();
        return;
      case "/posts/no-article":
        response.writeHead(200, { "content-type": "text/html" }).end("<h1>站点登录</h1>");
        return;
      case "/posts/fixture":
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(fixture);
        return;
      case "/posts/incomplete":
        response.writeHead(200, { "content-type": "text/html" })
          .end(fixture.toString("utf8").replace('id="S:2"', 'id="S:4"'));
        return;
      case "/posts/steps":
        response.writeHead(200, { "content-type": "text/html" })
          .end(stepsFixture.replace("</body>", () => stepsScript + "</body>"));
        return;
      case "/posts/unmatched-steps":
        response.writeHead(200, { "content-type": "text/html" })
          .end(stepsFixture.replace("1 / 2", "1 / 3").replace("</body>", () => stepsScript + "</body>"));
        return;
      default:
        response.writeHead(404).end();
    }
  });

  beforeAll(async () => {
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it("extracts public metadata, rendered body, and image references", async () => {
    const start = requests.length;
    const article = await readGalleyArticle(`${origin}/posts/old-fixture?from=test#summary`, null);

    expect(article).toMatchObject({
      sourceUrl: `${origin}/posts/fixture`,
      slug: "fixture",
      title: "文章快照",
      summary: "公开文章的摘要",
      category: "工程",
      tags: ["Galley", "SQLite"],
      images: [{ url: `${origin}/media/diagram.png`, alt: "文章示意图" }],
    });
    expect(article.bodyHtml).toContain("公开正文");
    expect(article.bodyHtml).toContain("折叠正文");
    expect(article.bodyHtml).toContain("const answer = 42;");
    expect(article.bodyHtml).toContain("公开知识块");
    expect(article.bodyHtml).toContain('encoding="application/x-tex"');
    expect(article.bodyHtml).toContain('<pre class="galley-mermaid-source">flowchart TD\n A[Start] --&gt; B[Finish]</pre>');
    expect(article.bodyHtml).not.toMatch(/站点导航|相关文章|pageState|__next_f/);
    expect(requests.slice(start)).toEqual(["/posts/old-fixture", "/posts/fixture"]);
  });

  it("resolves a slug against the configured site", async () => {
    const article = await readGalleyArticle("fixture", origin);
    expect(article.sourceUrl).toBe(`${origin}/posts/fixture`);
  });

  it("requires a public article route and checks the configured origin", async () => {
    await expect(readGalleyArticle(`${origin}/admin`, null)).rejects.toThrow(/public Galley URL/);
    await expect(readGalleyArticle(`${origin}/posts/fixture`, "https://example.org"))
      .rejects.toThrow(/must come from/);
  });

  it("rejects redirects off the chosen origin", async () => {
    await expect(readGalleyArticle("other-site", origin)).rejects.toThrow(/must come from/);
  });

  it("reports HTTP errors and pages without an article body", async () => {
    await expect(readGalleyArticle("missing", origin)).rejects.toThrow(/HTTP 404/);
    await expect(readGalleyArticle("no-article", origin)).rejects.toThrow(/no Galley article/);
  });

  it("rejects a partial article when a streamed segment is missing", async () => {
    await expect(readGalleyArticle("incomplete", origin)).rejects.toThrow(/incomplete streamed article/);
  });

  it("captures all published code steps when the data matches the rendered first step and count", async () => {
    const article = await readGalleyArticle("steps", origin);
    expect(article.codeSteps).toEqual([{
      title: "Two steps", language: "JavaScript",
      steps: [
        { file: "", code: "  $first", note: "First note" },
        { file: "demo.js", code: "$second", note: "Second note" },
      ],
    }]);
    expect((await readGalleyArticle("unmatched-steps", origin)).codeSteps).toBeUndefined();
  });
});
