import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { workspacePaths } from "../src/core/config.js";
import { initializeDatabase } from "../src/core/db/client.js";
import { sceneFrames, sceneGif } from "../src/transform/scene.js";
import { staticImages } from "../src/transform/static-images.js";
import { scene } from "./fixtures/scene.js";

describe("scene GIFs", () => {
  it("carries the endpoint state forward and emphasizes sends for one frame", () => {
    const frames = [...sceneFrames(scene)];
    const visible = frames.map(({ nodes }) => nodes
      .filter((node) => node.kind !== "camera" && node.props.opacity > 0).map(({ id }) => id));
    expect(visible).toEqual([["question"], ["question", "answer", "lookup"], ["question", "answer", "lookup"]]);
    expect(frames.map(({ caption }) => caption)).toEqual(["", ...scene.steps.map(({ caption }) => caption)]);
    expect(frames.map(({ sent }) => [...sent])).toEqual([[], [["lookup", "订单记录"]], []]);
    expect(frames[1]?.nodes[1]?.props).toMatchObject({ stroke: "accent", text: "资料" });
    expect(frames[2]?.nodes[1]?.props).toMatchObject({ stroke: "c3", text: "订单" });
    expect(frames[2]?.nodes[0]?.props).toMatchObject({ opacity: 0.4 });
    expect(scene.nodes[1]?.props).toMatchObject({ opacity: 0, text: "资料" });
  });

  it("encodes all frames with the requested delays and infinite looping", async () => {
    const gif = await sceneGif(scene);
    expect(gif.subarray(0, 6).toString("ascii")).toBe("GIF89a");
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([1000, 582]);
    const bytes = gif.toString("latin1");
    const controlBlocks = [...bytes.matchAll(/\x21\xf9\x04.([\s\S]{2}).\x00/gsu)];
    expect(controlBlocks.map(([, delay]) => Buffer.from(delay!, "latin1").readUInt16LE() * 10))
      .toEqual([1000, 1500, 2600]);
    expect(bytes).toContain("NETSCAPE2.0\x03\x01\x00\x00\x00");
    expect(gif.length).toBeLessThan(2 * 1024 * 1024);
  });

  it("migrates an existing cover reference and caches a distinct scene asset", async () => {
    const paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-scene-assets-")));
    try {
      const previous = new Database(paths.database);
      try {
        for (const migration of ["0001_article_snapshots.sql", "0002_distribution.sql"]) {
          previous.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
        }
        previous.exec(`
          PRAGMA user_version = 2;
          INSERT INTO articles VALUES ('https://example.test/posts/sample', 'sample');
          INSERT INTO article_snapshots VALUES ('https://example.test/posts/sample', 1, 'hash', 'title', 'date');
          INSERT INTO assets VALUES ('cover-id', 'hash', 'cover', NULL, NULL, 'image/png', 42, 20, 30);
          INSERT INTO platform_builds VALUES ('build-id', 'https://example.test/posts/sample', 1, 'wechat', 1,
            'title', NULL, 'cover-id', 'html', 'md', 'bundle', 'manifest', '[]', '2', 'date');
        `);
      } finally {
        previous.close();
      }
      initializeDatabase(paths);
      const current = new Database(paths.database, { readonly: true });
      try {
        expect(current.pragma("foreign_key_check")).toEqual([]);
        expect(current.prepare("SELECT cover_asset_id FROM platform_builds").pluck().get()).toBe("cover-id");
        expect(current.prepare("SELECT kind FROM assets WHERE id = 'cover-id'").pluck().get()).toBe("cover");
      } finally {
        current.close();
      }
      const renderer = staticImages(paths);
      const first = await renderer.scene(scene);
      expect(first).toMatchObject({ kind: "scene", mime: "image/gif", width: 1000, height: 582 });
      expect(await renderer.scene(scene)).toEqual(first);
    } finally {
      rmSync(paths.root, { recursive: true, force: true });
    }
  });
});
