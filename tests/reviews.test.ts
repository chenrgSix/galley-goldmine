import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspacePaths, type WorkspacePaths } from "../src/core/config.js";
import { initializeDatabase } from "../src/core/db/client.js";
import type { GalleyArticle } from "../src/importer/galley.js";
import { saveSnapshot } from "../src/importer/snapshots.js";
import { previewBuild, recordReview } from "../src/review/reviews.js";
import { distributionStatus } from "../src/review/status.js";
import { buildArticle } from "../src/transform/build.js";

const article: GalleyArticle = {
  schemaVersion: 1, sourceUrl: "https://example.org/posts/review", slug: "review", title: "文章",
  summary: null, tags: [], category: null, bodyHtml: "<p>正文</p>", images: [],
};

describe("build reviews", () => {
  let paths: WorkspacePaths;

  beforeEach(() => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-reviews-")));
    initializeDatabase(paths);
    saveSnapshot(paths, article);
  });
  afterEach(() => { rmSync(paths.root, { recursive: true, force: true }); });

  it("reports the latest decision and supersedes reviews after either a rebuild or a new snapshot", async () => {
    const first = await buildArticle(paths, article.slug, { platform: "toutiao" });
    expect(previewBuild(paths, first.id).files.preview).toBe(first.files.preview);
    expect(recordReview(paths, first.id, "approved", "Reviewed")).toMatchObject({ bundleSha256: first.bundleSha256 });
    expect(distributionStatus(paths, article.slug)[0]?.builds[0]?.reviewState).toBe("approved");
    recordReview(paths, first.id, "rejected");
    expect(distributionStatus(paths, article.slug)[0]?.builds[0]?.reviewState).toBe("rejected");

    const second = await buildArticle(paths, article.slug, { platform: "toutiao" });
    expect(second.bundleSha256).toBe(first.bundleSha256);
    expect(() => recordReview(paths, first.id, "approved")).toThrow(/superseded/);
    recordReview(paths, second.id, "approved");
    saveSnapshot(paths, { ...article, bodyHtml: "<p>新版本</p>" });
    expect(distributionStatus(paths, article.slug)[0]?.builds.map(({ reviewState }) => reviewState))
      .toEqual(["superseded", "superseded"]);
  });

  it.each(["html", "markdown", "preview", "manifest"] as const)(
    "invalidates a review after the %s file is changed",
    async (file) => {
      const build = await buildArticle(paths, article.slug, { platform: "toutiao" });
      recordReview(paths, build.id, "approved");
      appendFileSync(build.files[file], "\nchanged\n");
      expect(distributionStatus(paths, article.slug)[0]?.builds[0]?.reviewState).toBe("invalid");
      expect(() => recordReview(paths, build.id, "approved")).toThrow(/changed/);
    },
  );

  it("invalidates a review when a body asset or a cover is replaced on disk", async () => {
    const cover = join(paths.root, "cover.png");
    writeFileSync(cover, Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aR7sAAAAASUVORK5CYII=",
      "base64",
    ));
    saveSnapshot(paths, {
      ...article, bodyHtml: '<p><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></p>',
    });
    const build = await buildArticle(paths, article.slug, { platform: "wechat", cover });
    recordReview(paths, build.id, "approved");
    expect(build.assets.map(({ kind }) => kind).sort()).toEqual(["cover", "katex"]);
    for (const asset of build.assets) {
      const file = join(paths.assets, asset.file);
      appendFileSync(file, "extra bytes");
      expect(distributionStatus(paths, article.slug)[0]?.builds[0]?.reviewState).toBe("invalid");
      const { truncateSync } = await import("node:fs");
      truncateSync(file, asset.bytes);
      expect(distributionStatus(paths, article.slug)[0]?.builds[0]?.reviewState).toBe("approved");
    }
  });
});
