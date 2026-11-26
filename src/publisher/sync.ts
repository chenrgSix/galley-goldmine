import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { workspacePaths, type WorkspacePaths } from "../core/config.js";
import { withDatabase, type DatabaseReader } from "../core/db/client.js";
import { platformBuilds, syncAttempts } from "../core/db/schema.js";
import { bundlePaths, getBuild, verifyBuild, type BuildRecord } from "../review/bundle.js";
import { requireApproval } from "../review/reviews.js";
import { attemptStatus } from "./attempt-status.js";
import {
  adapterIds, assertPublisherReferences, cleanDraftUrl, dryRunTimeoutMs, publisherOutcome,
  requirePlatformLogin, runPublisher, syncTimeoutMs,
} from "./wechatsync.js";

function requireSyncEligibility(db: DatabaseReader, build: BuildRecord) {
  const review = requireApproval(db, build);
  if (build.warnings.some(({ severity }) => severity === "blocking")) {
    throw new Error("Resolve the build's blocking warnings before syncing.");
  }
  const previous = db.select({ attempt: syncAttempts }).from(syncAttempts)
    .innerJoin(platformBuilds, eq(platformBuilds.id, syncAttempts.buildId))
    .where(and(
      eq(platformBuilds.sourceUrl, build.sourceUrl), eq(platformBuilds.platform, build.platform),
      eq(syncAttempts.mode, "sync"),
    )).all();
  for (const { attempt } of previous) {
    const status = attemptStatus(attempt);
    if (status === "pending") throw new Error(`Sync attempt #${attempt.id} is still pending.`);
    if (status === "unknown") throw new Error(`Check the draft box and resolve sync attempt #${attempt.id} before retrying.`);
    if (status === "succeeded" && attempt.bundleSha256 === build.bundleSha256) {
      throw new Error(`This article bundle already synced successfully in attempt #${attempt.id}.`);
    }
  }
  return review;
}

export async function syncBuild(paths: WorkspacePaths, buildId: string, command: string, dryRun: boolean) {
  const build = getBuild(paths, buildId);
  const timeout = dryRun ? dryRunTimeoutMs : syncTimeoutMs;
  if (!dryRun) {
    withDatabase(paths, true, (db) => requireSyncEligibility(db, build));
    verifyBuild(paths, build);
    await requirePlatformLogin(command, build.platform);
  }

  // Keep the bytes verified for this invocation separate from later edits to the workspace.
  const staged = workspacePaths(mkdtempSync(join(tmpdir(), "goldmine-sync-")));
  const files = bundlePaths(staged, buildId);
  try {
    mkdirSync(files.directory, { recursive: true, mode: 0o700 });
    mkdirSync(staged.assets, { mode: 0o700 });
    const localAssets = new Set<string>();
    const { manifest, html } = verifyBuild(paths, build, (file, bytes) => {
      const path = join(staged.assets, file);
      writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
      localAssets.add(path);
    });
    if (!dryRun) assertPublisherReferences(html.toString("utf8"), files.directory, localAssets);
    writeFileSync(files.html, html, { mode: 0o600, flag: "wx" });

    const pending = withDatabase(paths, false, (db) => db.transaction((tx) => {
      const reviewId = dryRun ? null : requireSyncEligibility(tx, build).id;
      const start = Date.now();
      return tx.insert(syncAttempts).values({
        buildId, reviewId, bundleSha256: build.bundleSha256, mode: dryRun ? "dry_run" : "sync", status: "pending",
        startedAt: new Date(start).toISOString(),
        deadlineAt: new Date(start + timeout + 10_000).toISOString(),
      }).returning().get();
    }, { behavior: "immediate" }));

    const args = ["sync", files.html, "-p", adapterIds[build.platform], `--title=${build.title}`];
    if (manifest.cover) args.push("--cover", join(staged.assets, manifest.cover.file));
    if (dryRun) args.push("--dry-run");
    const result = await runPublisher(command, args, !dryRun, timeout);
    const outcome = publisherOutcome(result, build.platform, dryRun);
    return withDatabase(paths, false, (db) => db.transaction((tx) => {
      const updated = tx.update(syncAttempts)
        .set({ ...outcome, finishedAt: new Date().toISOString() })
        .where(and(eq(syncAttempts.id, pending.id), eq(syncAttempts.status, "pending")))
        .returning().get();
      return updated ?? tx.select().from(syncAttempts).where(eq(syncAttempts.id, pending.id)).get()!;
    }, { behavior: "immediate" }));
  } finally {
    rmSync(staged.root, { recursive: true, force: true });
  }
}

export function resolveAttempt(
  paths: WorkspacePaths, id: number, resolution: "succeeded" | "failed", note: string, draftUrl?: string,
) {
  if (note.trim() === "") throw new Error("A resolution note is required.");
  const token = process.env.WECHATSYNC_TOKEN;
  const resolutionNote = token ? note.trim().replaceAll(token, "[redacted]") : note.trim();
  if (resolution === "failed" && draftUrl !== undefined) throw new Error("--draft-url requires --succeeded.");
  const verifiedUrl = draftUrl === undefined ? null : cleanDraftUrl(draftUrl);
  if (draftUrl !== undefined && !verifiedUrl) throw new Error("Use a valid HTTP(S) draft URL.");
  return withDatabase(paths, false, (db) => db.transaction((tx) => {
    const attempt = tx.select().from(syncAttempts).where(eq(syncAttempts.id, id)).get();
    if (!attempt || attempt.mode !== "sync" || attemptStatus(attempt) !== "unknown") {
      throw new Error("Only a sync attempt with an unknown outcome can be resolved.");
    }
    const now = new Date().toISOString();
    return tx.update(syncAttempts).set({
      status: resolution,
      draftUrl: resolution === "succeeded" ? verifiedUrl ?? attempt.draftUrl : null,
      finishedAt: attempt.finishedAt ?? now,
      resolvedAt: now,
      resolutionNote,
    }).where(eq(syncAttempts.id, id)).returning().get();
  }, { behavior: "immediate" }));
}
