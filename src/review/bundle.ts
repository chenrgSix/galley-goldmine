import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { readAsset, type AssetRef } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase, type DatabaseReader } from "../core/db/client.js";
import { articleSnapshots, platformBuilds, type BuildWarning, type Platform } from "../core/db/schema.js";
import { sha256 } from "../core/files.js";

export type BuildRecord = typeof platformBuilds.$inferSelect;

type BundleContents = Pick<BuildRecord, "platform" | "title" | "summary" | "htmlSha256" | "markdownSha256"> & {
  cover: AssetRef | null;
  assets: AssetRef[];
};

export type BuildManifest = BundleContents & {
  schemaVersion: 1;
  id: string;
  sourceUrl: string;
  version: number;
  snapshotSha256: string;
  revision: number;
  bundleSha256: string;
  previewSha256: string;
  warnings: BuildWarning[];
  rendererVersion: string;
  createdAt: string;
  overrides: { title: boolean; summary: boolean; cover: boolean };
};

export function bundleFingerprint(bundle: BundleContents): string {
  const { platform, title, summary, cover, htmlSha256, markdownSha256, assets } = bundle;
  const files = assets.map(({ file, sha256 }) => [file, sha256]).sort();
  return sha256(JSON.stringify({ platform, title, summary, cover: cover?.sha256 ?? null, htmlSha256, markdownSha256, files }));
}

export function latestBuild(db: DatabaseReader, sourceUrl: string, platform: Platform): BuildRecord | undefined {
  return db.select().from(platformBuilds)
    .where(and(eq(platformBuilds.sourceUrl, sourceUrl), eq(platformBuilds.platform, platform)))
    .orderBy(desc(platformBuilds.revision)).get();
}

export function latestSnapshotVersion(db: DatabaseReader, sourceUrl: string): number | undefined {
  return db.select({ version: articleSnapshots.version }).from(articleSnapshots)
    .where(eq(articleSnapshots.sourceUrl, sourceUrl)).orderBy(desc(articleSnapshots.version)).get()?.version;
}

export function assertCurrentBuild(db: DatabaseReader, build: BuildRecord): void {
  if (latestSnapshotVersion(db, build.sourceUrl) !== build.version ||
    latestBuild(db, build.sourceUrl, build.platform)?.id !== build.id) {
    throw new Error("This build has been superseded by a newer snapshot or platform build.");
  }
}

export function getBuild(paths: WorkspacePaths, id: string): BuildRecord {
  const build = withDatabase(paths, true, (db) =>
    db.select().from(platformBuilds).where(eq(platformBuilds.id, id)).get());
  if (!build) throw new Error(`Build not found: ${id}`);
  return build;
}

export function bundlePaths(paths: WorkspacePaths, id: string) {
  const directory = join(paths.builds, id);
  return {
    directory,
    html: join(directory, "article.html"),
    markdown: join(directory, "article.md"),
    manifest: join(directory, "manifest.json"),
    preview: join(directory, "preview.html"),
  };
}

export function readManifest(paths: WorkspacePaths, build: BuildRecord): BuildManifest {
  const file = readFileSync(bundlePaths(paths, build.id).manifest);
  if (sha256(file) !== build.manifestSha256) throw new Error("The build manifest has changed. Rebuild before reviewing or syncing.");
  return JSON.parse(file.toString("utf8")) as BuildManifest;
}

export function verifyBuild(
  paths: WorkspacePaths,
  build: BuildRecord,
  acceptAsset?: (file: string, bytes: Buffer) => void,
) {
  const manifest = readManifest(paths, build);
  const files = bundlePaths(paths, build.id);
  const html = readFileSync(files.html);
  const markdown = readFileSync(files.markdown);
  const fingerprint = bundleFingerprint({
    ...manifest, platform: build.platform, title: build.title, summary: build.summary,
    htmlSha256: sha256(html), markdownSha256: sha256(markdown),
  });
  if (fingerprint !== build.bundleSha256 || sha256(readFileSync(files.preview)) !== manifest.previewSha256) {
    throw new Error("Build files have changed. Rebuild before reviewing or syncing.");
  }
  for (const asset of manifest.assets) {
    const bytes = readAsset(paths, asset);
    acceptAsset?.(asset.file, bytes);
  }
  return { manifest, files, html };
}
