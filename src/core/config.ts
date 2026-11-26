import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { isErrno, writeNewFile } from "./files.js";

const galleyOrigin = z.string().transform((value, context) => {
  const url = URL.parse(value);
  if (
    !url ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== `${url.origin}/`
  ) {
    context.addIssue({
      code: "custom",
      message: "Use a Galley site origin, for example https://blog.example.com.",
    });
    return z.NEVER;
  }
  return url.origin;
});

const configSchema = z.strictObject({
  galley: z.strictObject({ baseUrl: galleyOrigin.nullable() }),
  publisher: z.strictObject({ command: z.string().trim().min(1) }),
});

export type Config = z.infer<typeof configSchema>;

export type WorkspacePaths = ReturnType<typeof workspacePaths>;

export function workspacePaths(directory?: string) {
  const root = resolve(directory ?? (process.env.GOLDMINE_HOME || join(homedir(), ".goldmine")));
  return {
    root,
    config: join(root, "config.json"),
    database: join(root, "goldmine.db"),
    snapshots: join(root, "snapshots"),
    assets: join(root, "assets"),
    builds: join(root, "builds"),
  };
}

export function loadConfig(paths: WorkspacePaths): Config {
  let contents: string;
  try {
    contents = readFileSync(paths.config, "utf8");
  } catch (error) {
    if (!isErrno(error, "ENOENT")) throw error;
    throw new Error(`Configuration is missing at ${paths.config}. Run goldmine init.`);
  }

  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Configuration at ${paths.config} must be valid JSON.`);
  }
  const result = configSchema.safeParse(value);
  if (!result.success) {
    const details = z.prettifyError(result.error);
    throw new Error(`Invalid configuration at ${paths.config}.\n${details}`);
  }
  return result.data;
}

export function initializeConfig(paths: WorkspacePaths, galleyUrl?: string): boolean {
  const baseUrl = galleyUrl === undefined ? null : galleyOrigin.parse(galleyUrl);
  const defaults: Config = { galley: { baseUrl }, publisher: { command: "wechatsync" } };
  mkdirSync(paths.root, { recursive: true, mode: 0o700 });
  const created = writeNewFile(paths.config, `${JSON.stringify(defaults, null, 2)}\n`);
  if (!created) {
    const existing = loadConfig(paths);
    if (galleyUrl !== undefined && existing.galley.baseUrl !== baseUrl) {
      throw new Error(`Update galley.baseUrl in ${paths.config} to change the configured site.`);
    }
  }
  return created;
}
