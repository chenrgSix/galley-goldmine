import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, max } from "drizzle-orm";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase } from "../core/db/client.js";
import { articles, articleSnapshots } from "../core/db/schema.js";
import { writeNewFile } from "../core/files.js";
import type { GalleyArticle } from "./galley.js";

export function saveSnapshot(paths: WorkspacePaths, article: GalleyArticle) {
  const { sourceUrl, slug, title } = article;
  const content = `${JSON.stringify(article, null, 2)}\n`;
  const sha256 = createHash("sha256").update(content).digest("hex");
  const snapshotPath = join(paths.snapshots, `${sha256}.json`);

  return withDatabase(paths, false, (db) => {
    // Write the complete content before committing any index entry.
    const written = writeNewFile(snapshotPath, content);
    if (!written && readFileSync(snapshotPath, "utf8") !== content) {
      throw new Error(`Snapshot contents do not match its fingerprint at ${snapshotPath}.`);
    }

    return db.transaction((tx) => {
      tx.insert(articles).values({ sourceUrl, slug }).onConflictDoNothing().run();
      const latest = tx.select().from(articleSnapshots)
        .where(eq(articleSnapshots.sourceUrl, sourceUrl))
        .orderBy(desc(articleSnapshots.version)).get();
      if (latest?.sha256 === sha256) {
        return { ...latest, slug, snapshotPath, created: false };
      }

      const entry = {
        sourceUrl,
        version: (latest?.version ?? 0) + 1,
        sha256,
        title,
        importedAt: new Date().toISOString(),
      };
      tx.insert(articleSnapshots).values(entry).run();
      return { ...entry, slug, snapshotPath, created: true };
    }, { behavior: "immediate" });
  });
}

export function listArticles(paths: WorkspacePaths) {
  return withDatabase(paths, true, (db) => {
    const latest = db.select({
      sourceUrl: articleSnapshots.sourceUrl,
      version: max(articleSnapshots.version).as("latest_version"),
    }).from(articleSnapshots).groupBy(articleSnapshots.sourceUrl).as("latest");

    const entries = db.select({
      sourceUrl: articles.sourceUrl,
      slug: articles.slug,
      title: articleSnapshots.title,
      version: articleSnapshots.version,
      sha256: articleSnapshots.sha256,
      importedAt: articleSnapshots.importedAt,
    }).from(articles)
      .innerJoin(latest, eq(articles.sourceUrl, latest.sourceUrl))
      .innerJoin(articleSnapshots, and(
        eq(articleSnapshots.sourceUrl, latest.sourceUrl),
        eq(articleSnapshots.version, latest.version),
      ))
      .orderBy(desc(articleSnapshots.importedAt), asc(articles.sourceUrl))
      .all();

    return entries.map((entry) => ({
      ...entry,
      snapshotPath: join(paths.snapshots, `${entry.sha256}.json`),
    }));
  });
}
