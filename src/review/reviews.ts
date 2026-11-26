import { desc, eq } from "drizzle-orm";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase, type DatabaseReader } from "../core/db/client.js";
import { reviews } from "../core/db/schema.js";
import { assertCurrentBuild, getBuild, verifyBuild, type BuildRecord } from "./bundle.js";

export type Review = typeof reviews.$inferSelect;

export function latestReview(db: DatabaseReader, buildId: string): Review | undefined {
  return db.select().from(reviews).where(eq(reviews.buildId, buildId)).orderBy(desc(reviews.id)).get();
}

export function requireApproval(db: DatabaseReader, build: BuildRecord): Review {
  assertCurrentBuild(db, build);
  const review = latestReview(db, build.id);
  if (review?.decision !== "approved" || review.bundleSha256 !== build.bundleSha256) {
    throw new Error("This build needs a valid approval before syncing.");
  }
  return review;
}

export function recordReview(paths: WorkspacePaths, buildId: string, decision: Review["decision"], note?: string) {
  const build = getBuild(paths, buildId);
  verifyBuild(paths, build);
  return withDatabase(paths, false, (db) => db.transaction((tx) => {
    assertCurrentBuild(tx, build);
    const review = tx.insert(reviews).values({
      buildId, bundleSha256: build.bundleSha256, decision,
      note: note?.trim() || null, reviewedAt: new Date().toISOString(),
    }).returning().get();
    return review;
  }, { behavior: "immediate" }));
}

export function previewBuild(paths: WorkspacePaths, buildId: string) {
  const { manifest, files } = verifyBuild(paths, getBuild(paths, buildId));
  return { ...manifest, files };
}
