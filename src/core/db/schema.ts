import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
