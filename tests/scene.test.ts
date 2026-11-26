import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { workspacePaths } from "../src/core/config.js";
import { initializeDatabase } from "../src/core/db/client.js";
import { sceneFrames, sceneGif, sceneSvgFrames } from "../src/transform/scene.js";
import { staticImages } from "../src/transform/static-images.js";
import { scene } from "./fixtures/scene.js";

describe("scene GIFs", () => {
  it("carries the endpoint state forward and emphasizes sends for one frame", () => {
    const frames = [...sceneFrames(scene)];
    const visible = frames.map(({ nodes }) => nodes
      .filter((node) => node.kind !== "camera" && node.props.opacity > 0).map(({ id }) => id));
    expect(visible).toEqual([["question"], ["question", "answer", "lookup"], ["question", "answer", "lookup"]]);
    expect(frames.map(({ caption }) => caption)).toEqual(["", ...scene.steps.map(({ caption }) => caption)]);
    expect(frames.map(({ sent }) => sent.size)).toEqual([0, 1, 0]);
    expect(frames[1]?.sent.get("lookup")).toEqual(new Map([["result", "订单记录"]]));
    expect(frames[1]?.nodes[1]?.props).toMatchObject({ stroke: "accent", text: "资料" });
    expect(frames[2]?.nodes[1]?.props).toMatchObject({ stroke: "c3", text: "订单" });
    expect(frames[2]?.nodes[0]?.props).toMatchObject({ opacity: 0.4 });
    expect(scene.nodes[1]?.props).toMatchObject({ opacity: 0, text: "资料" });
  });

  it("keeps both labels on a shared send and skips highlights for unchanged or reset positions", () => {
    const shared = structuredClone(scene);
    const packet = shared.nodes.find((node) => node.kind === "packet")!;
    shared.nodes.push(
      { ...packet, id: "receipt", props: { ...packet.props, text: "付款回执" } },
      { ...packet, id: "waiting", props: { ...packet.props, text: "待核对", pos: 0.5, opacity: 1 } },
    );
    shared.steps[0]!.changes.push(
      { id: "result", property: "opacity", value: 1 },
      { id: "receipt", property: "opacity", value: 1 },
      { id: "receipt", property: "pos", value: 1 },
      { id: "receipt", property: "opacity", value: 0 },
    );
    shared.steps[1]!.changes.push({ id: "result", property: "pos", value: 1 });
    shared.steps.push({ caption: "重置数据包。", changes: [
      { id: "result", property: "pos", value: 0 },
      { id: "result", property: "opacity", value: 0 },
    ] });

    const [, sent, unchanged, reset] = [...sceneSvgFrames(shared)];
    const highlight = 'stroke="#D43A2F" stroke-width="4"';
    expect(sent?.svg).toContain(highlight);
    expect(sent?.svg).toContain(">订单记录 · 付款回执</text>");
    expect(sent?.svg).toContain(">待核对</text>");
    expect(sent?.svg).not.toContain(">订单记录</text>");
    expect(sent?.svg.match(/<circle /gu)).toHaveLength(2);
    expect(unchanged?.svg).not.toContain(highlight);
    expect(unchanged?.svg).toContain(">订单记录</text>");
    expect(reset?.svg).not.toContain(highlight);
    expect(reset?.svg).not.toContain("订单记录");
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

  it("fits mixed captions to two lines and reserves room for longer captions in every frame", async () => {
    const withCaptions = structuredClone(scene);
    const first = "查".repeat(47);
    const second = `searchIndex ${"证".repeat(39)}`;
    const long = "W".repeat(256);
    withCaptions.steps[0]!.caption = `${first} ${second}`;
    withCaptions.steps[1]!.caption = long;
    const [initial, mixed, expanded] = [...sceneSvgFrames(withCaptions)].map(({ svg }) => load(svg, { xmlMode: true }));

    const mixedLines = mixed!('svg > text[fill="#D43A2F"]');
    expect(mixedLines.map((_, line) => mixed!(line).text()).get()).toEqual([first, second]);
    const longLines = expanded!('svg > text[fill="#D43A2F"]');
    expect(longLines.length).toBeGreaterThan(2);
    expect(longLines.text()).toBe(long);
    const height = Number(expanded!("svg").attr("height"));
    expect(height).toBeGreaterThan(582);
    expect(Number(initial!("svg").attr("height"))).toBe(height);
    expect(Number(mixed!("svg").attr("height"))).toBe(height);
    expect(Number(longLines.first().attr("y"))).toBeGreaterThan(516 + 12);
    expect(Number(longLines.last().attr("y"))).toBeLessThan(height - 12);
    const gif = await sceneGif(withCaptions);
    expect(gif.readUInt16LE(8)).toBe(height);
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
