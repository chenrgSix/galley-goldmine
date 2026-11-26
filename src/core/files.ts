import { randomUUID } from "node:crypto";
import { linkSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

export function writeNewFile(path: string, content: string): boolean {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    // Publish a complete file while preserving an existing destination.
    linkSync(temporary, path);
    return true;
  } catch (error) {
    if (isErrno(error, "EEXIST")) return false;
    throw error;
  } finally {
    rmSync(temporary, { force: true });
  }
}
