import { foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const platforms = ["wechat", "toutiao"] as const;
export type Platform = typeof platforms[number];

export type BuildWarning = {
  code: string;
  message: string;
  severity: "warning" | "blocking";
};

export const articles = sqliteTable("articles", {
  sourceUrl: text("source_url").primaryKey().notNull(),
  slug: text().notNull(),
});

export const articleSnapshots = sqliteTable(
  "article_snapshots",
  {
    sourceUrl: text("source_url").notNull().references(() => articles.sourceUrl),
    version: integer().notNull(),
    sha256: text().notNull(),
    title: text().notNull(),
    importedAt: text("imported_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.sourceUrl, table.version] })],
);

export const assets = sqliteTable("assets", {
  id: text().primaryKey().notNull(),
  sha256: text().notNull(),
  kind: text({ enum: ["image", "mermaid", "katex", "cover"] }).notNull(),
  source: text(),
  cacheKey: text("cache_key").unique(),
  mime: text().notNull(),
  bytes: integer().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
});

export const platformBuilds = sqliteTable("platform_builds", {
  id: text().primaryKey().notNull(),
  sourceUrl: text("source_url").notNull(),
  version: integer().notNull(),
  platform: text({ enum: platforms }).notNull(),
  revision: integer().notNull(),
  title: text().notNull(),
  summary: text(),
  coverAssetId: text("cover_asset_id").references(() => assets.id),
  htmlSha256: text("html_sha256").notNull(),
  markdownSha256: text("markdown_sha256").notNull(),
  bundleSha256: text("bundle_sha256").notNull(),
  manifestSha256: text("manifest_sha256").notNull(),
  warnings: text({ mode: "json" }).$type<BuildWarning[]>().notNull(),
  rendererVersion: text("renderer_version").notNull(),
  createdAt: text("created_at").notNull(),
}, (table) => [
  foreignKey({
    columns: [table.sourceUrl, table.version],
    foreignColumns: [articleSnapshots.sourceUrl, articleSnapshots.version],
  }),
  uniqueIndex("platform_build_revision").on(table.sourceUrl, table.platform, table.revision),
]);

export const reviews = sqliteTable("reviews", {
  id: integer().primaryKey({ autoIncrement: true }),
  buildId: text("build_id").notNull().references(() => platformBuilds.id),
  bundleSha256: text("bundle_sha256").notNull(),
  decision: text({ enum: ["approved", "rejected"] }).notNull(),
  note: text(),
  reviewedAt: text("reviewed_at").notNull(),
}, (table) => [index("review_build").on(table.buildId, table.id)]);

export const syncAttempts = sqliteTable("sync_attempts", {
  id: integer().primaryKey({ autoIncrement: true }),
  buildId: text("build_id").notNull().references(() => platformBuilds.id),
  bundleSha256: text("bundle_sha256").notNull(),
  reviewId: integer("review_id").references(() => reviews.id),
  mode: text({ enum: ["dry_run", "sync"] }).notNull(),
  status: text({ enum: ["pending", "succeeded", "failed", "unknown"] }).notNull(),
  draftUrl: text("draft_url"),
  exitCode: integer("exit_code"),
  outputExcerpt: text("output_excerpt"),
  startedAt: text("started_at").notNull(),
  deadlineAt: text("deadline_at").notNull(),
  finishedAt: text("finished_at"),
  resolvedAt: text("resolved_at"),
  resolutionNote: text("resolution_note"),
}, (table) => [index("sync_attempt_build").on(table.buildId, table.id)]);
