import { mkdirSync, readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { WorkspacePaths } from "../config.js";

export type DatabaseReader = Pick<BetterSQLite3Database, "select">;

const migrations = [
  new URL("../../../drizzle/0001_article_snapshots.sql", import.meta.url),
  new URL("../../../drizzle/0002_distribution.sql", import.meta.url),
  new URL("../../../drizzle/0003_scene_assets.sql", import.meta.url),
];

function schemaVersion(connection: Database.Database): number {
  return Number(connection.pragma("user_version", { simple: true }));
}

export function initializeDatabase(paths: WorkspacePaths): void {
  for (const directory of [paths.snapshots, paths.assets, paths.builds]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const connection = new Database(paths.database);
  try {
    // Table rebuilds must leave foreign keys pointing to the final table names.
    connection.pragma("foreign_keys = OFF");
    connection.transaction(() => {
      const version = schemaVersion(connection);
      if (version > migrations.length) {
        throw new Error("This workspace requires a newer version of Goldmine.");
      }
      for (const migration of migrations.slice(version)) {
        connection.exec(readFileSync(migration, "utf8"));
      }
      if (version < migrations.length) {
        const violations = connection.pragma("foreign_key_check") as unknown[];
        if (violations.length) throw new Error("The migration would leave inconsistent foreign keys.");
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
    connection.pragma("foreign_keys = ON");
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
