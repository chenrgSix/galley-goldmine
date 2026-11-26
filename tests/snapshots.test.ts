import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { workspacePaths, type WorkspacePaths } from "../src/core/config.js";
import { initializeDatabase } from "../src/core/db/client.js";
import type { GalleyArticle } from "../src/importer/galley.js";
import { listArticles, saveSnapshot } from "../src/importer/snapshots.js";

const article: GalleyArticle = {
  schemaVersion: 1,
  sourceUrl: "https://blog.example.com/posts/fixture",
  slug: "fixture",
  title: "第一版",
  summary: null,
  category: null,
  tags: [],
  bodyHtml: "<p>正文</p>",
  images: [],
};

describe("article snapshots", () => {
  let paths: WorkspacePaths;

  beforeEach(() => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-snapshots-")));
    initializeDatabase(paths);
  });

  afterEach(() => {
    rmSync(paths.root, { recursive: true, force: true });
  });

  it("indexes each article once and reuses an identical latest snapshot", () => {
    expect(listArticles(paths)).toEqual([]);
    const initial = saveSnapshot(paths, article);
    const repeated = saveSnapshot(paths, article);

    expect(initial).toMatchObject({ created: true, version: 1 });
    expect(repeated).toEqual({ ...initial, created: false });
    expect(listArticles(paths)).toMatchObject([{ version: 1, title: article.title }]);
    expect(JSON.parse(readFileSync(initial.snapshotPath, "utf8"))).toEqual(article);
  });

  it("keeps historical files and advances the version when the source reverts", () => {
    const initial = saveSnapshot(paths, article);
    const revisedArticle = { ...article, title: "第二版", bodyHtml: "<p>修订正文</p>" };
    const revised = saveSnapshot(paths, revisedArticle);
    initializeDatabase(paths);

    expect(revised).toMatchObject({ created: true, version: 2 });
    expect(listArticles(paths)).toMatchObject([{ version: 2, title: revisedArticle.title }]);
    expect(JSON.parse(readFileSync(initial.snapshotPath, "utf8"))).toEqual(article);

    const reverted = saveSnapshot(paths, article);
    expect(reverted).toMatchObject({ created: true, version: 3, snapshotPath: initial.snapshotPath });
    expect(readdirSync(paths.snapshots)).toHaveLength(2);
    expect(listArticles(paths)).toMatchObject([{ version: 3, title: article.title }]);
  });
});
