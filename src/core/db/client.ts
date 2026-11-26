import { mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { WorkspacePaths } from "../config.js";

const migrations = [new URL("../../../drizzle/0001_article_snapshots.sql", import.meta.url)];

function schemaVersion(connection: Database.Database): number {
  return Number(connection.pragma("user_version", { simple: true }));
}

export function initializeDatabase(paths: WorkspacePaths): void {
  mkdirSync(paths.snapshots, { recursive: true, mode: 0o700 });
  const connection = new Database(paths.database);
  try {
    connection.transaction(() => {
      const version = schemaVersion(connection);
      if (version > migrations.length) {
        throw new Error("This workspace requires a newer version of Goldmine.");
      }
      for (const migration of migrations.slice(version)) {
        connection.exec(readFileSync(migration, "utf8"));
      }
      if (version < migrations.length) {
        connection.pragma(`user_version = ${migrations.length}`);
      }
    }).immediate();
  } finally {
    connection.close();
  }
}

export function withDatabase<T>(
  paths: WorkspacePaths,
  readonly: boolean,
  use: (db: BetterSQLite3Database) => T,
): T {
  const connection = new Database(paths.database, { readonly, fileMustExist: true });
  try {
    const version = schemaVersion(connection);
    if (version > migrations.length) {
      throw new Error("This workspace requires a newer version of Goldmine.");
    }
    if (version < migrations.length) {
      throw new Error("Run goldmine init to update the workspace database.");
    }
    return use(drizzle(connection));
  } finally {
    connection.close();
  }
}
