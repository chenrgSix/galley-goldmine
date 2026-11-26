import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initializeConfig,
  loadConfig,
  workspacePaths,
  type WorkspacePaths,
} from "../src/core/config.js";

describe("workspace configuration", () => {
  let paths: WorkspacePaths;

  beforeEach(() => {
    paths = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-config-")));
  });

  afterEach(() => {
    rmSync(paths.root, { recursive: true, force: true });
  });

  it("creates a configuration with a normalized Galley origin", () => {
    expect(initializeConfig(paths, "https://blog.example.com/")).toBe(true);
    expect(loadConfig(paths)).toEqual({
      galley: { baseUrl: "https://blog.example.com" },
      publisher: { command: "wechatsync" },
    });
  });

  it("preserves existing settings when initialized again", () => {
    initializeConfig(paths, "https://blog.example.com");
    const existing = readFileSync(paths.config, "utf8");

    expect(initializeConfig(paths)).toBe(false);
    expect(() => initializeConfig(paths, "https://other.example.com")).toThrow(/change the configured site/);
    expect(readFileSync(paths.config, "utf8")).toBe(existing);
  });

  it("reports a malformed configuration without replacing it", () => {
    const invalid = "{";
    writeFileSync(paths.config, invalid);

    expect(() => initializeConfig(paths)).toThrow(/valid JSON/);
    expect(readFileSync(paths.config, "utf8")).toBe(invalid);
  });

  it("rejects credential-bearing and non-origin URLs", () => {
    expect(() => initializeConfig(paths, "https://user:password@blog.example.com")).toThrow();
    expect(() => initializeConfig(paths, "https://blog.example.com/posts/a")).toThrow();
    expect(() => loadConfig(paths)).toThrow(/Run goldmine init/);
  });
});
