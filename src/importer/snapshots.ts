import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, asc, desc, eq, max } from "drizzle-orm";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase } from "../core/db/client.js";
import { articles, articleSnapshots } from "../core/db/schema.js";
import { sha256, writeNewFile } from "../core/files.js";
import { canonicalArticleUrl, type GalleyArticle } from "./galley.js";

export function saveSnapshot(paths: WorkspacePaths, article: GalleyArticle) {
  const { sourceUrl, slug, title } = article;
  const content = `${JSON.stringify(article, null, 2)}\n`;
  const fingerprint = sha256(content);
  const snapshotPath = join(paths.snapshots, `${fingerprint}.json`);

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
      if (latest?.sha256 === fingerprint) {
        return { ...latest, slug, snapshotPath, created: false };
      }

      const entry = {
        sourceUrl,
        version: (latest?.version ?? 0) + 1,
        sha256: fingerprint,
        title,
        importedAt: new Date().toISOString(),
      };
      tx.insert(articleSnapshots).values(entry).run();
      return { ...entry, slug, snapshotPath, created: true };
    }, { behavior: "immediate" });
  });
}

export type SnapshotEntry = ReturnType<typeof listArticles>[number];

export function matchArticle(entries: SnapshotEntry[], reference: string): SnapshotEntry {
  const sourceUrl = URL.parse(reference) ? canonicalArticleUrl(reference) : null;
  const matches = entries.filter((entry) => sourceUrl ? entry.sourceUrl === sourceUrl : entry.slug === reference);
  if (matches.length > 1) throw new Error("This slug belongs to multiple articles. Use the full article URL.");
  const entry = matches[0];
  if (!entry) throw new Error("Article has not been imported. Run goldmine import first.");
  return entry;
}

export function readSnapshot(entry: SnapshotEntry): GalleyArticle {
  const contents = readFileSync(entry.snapshotPath);
  if (sha256(contents) !== entry.sha256) throw new Error("The snapshot file has changed. Restore it before building.");
  return JSON.parse(contents.toString("utf8")) as GalleyArticle;
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
