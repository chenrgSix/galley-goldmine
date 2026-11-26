import { desc, eq } from "drizzle-orm";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase } from "../core/db/client.js";
import { platformBuilds, syncAttempts, type Platform } from "../core/db/schema.js";
import { listArticles, matchArticle } from "../importer/snapshots.js";
import { attemptStatus } from "../publisher/attempt-status.js";
import { bundlePaths, verifyBuild, type BuildRecord } from "./bundle.js";
import { latestReview, type Review } from "./reviews.js";

function reviewState(paths: WorkspacePaths, build: BuildRecord, review: Review | undefined, current: boolean):
  "superseded" | "unreviewed" | "rejected" | "invalid" | "approved" {
  if (!current) return "superseded";
  if (!review) return "unreviewed";
  if (review.decision === "rejected") return "rejected";
  if (review.bundleSha256 !== build.bundleSha256) return "invalid";
  try {
    verifyBuild(paths, build);
    return "approved";
  } catch {
    return "invalid";
  }
}

export function distributionStatus(paths: WorkspacePaths, article?: string) {
  const entries = listArticles(paths);
  const selected = article === undefined ? entries : [matchArticle(entries, article)];
  return withDatabase(paths, true, (db) => selected.map((snapshot) => {
    const latestPlatforms = new Set<Platform>();
    const builds = db.select().from(platformBuilds).where(eq(platformBuilds.sourceUrl, snapshot.sourceUrl))
      .orderBy(desc(platformBuilds.revision)).all()
      .map((build) => {
        const current = build.version === snapshot.version && !latestPlatforms.has(build.platform);
        latestPlatforms.add(build.platform);
        const review = latestReview(db, build.id);
        const attempts = db.select().from(syncAttempts).where(eq(syncAttempts.buildId, build.id))
          .orderBy(desc(syncAttempts.id)).all()
          .map((attempt) => ({ ...attempt, status: attemptStatus(attempt) }));
        return {
          ...build, previewPath: bundlePaths(paths, build.id).preview, review: review ?? null,
          reviewState: reviewState(paths, build, review, current), attempts,
        };
      });
    return { ...snapshot, builds };
  }));
}
