import type { syncAttempts } from "../core/db/schema.js";

export type SyncAttempt = typeof syncAttempts.$inferSelect;

export function attemptStatus(attempt: SyncAttempt, now = new Date().toISOString()): SyncAttempt["status"] {
  if (attempt.status === "pending" && attempt.deadlineAt <= now) {
    return attempt.mode === "dry_run" ? "failed" : "unknown";
  }
  return attempt.status;
}
