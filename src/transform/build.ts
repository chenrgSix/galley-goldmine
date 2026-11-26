import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { assetReference, loadCover, readAsset, saveAsset } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import { withDatabase } from "../core/db/client.js";
import { assets, platformBuilds, type Platform } from "../core/db/schema.js";
import { sha256 } from "../core/files.js";
import { listArticles, matchArticle, readSnapshot } from "../importer/snapshots.js";
import {
  bundleFingerprint, bundlePaths, latestBuild, latestSnapshotVersion, readManifest, type BuildManifest,
} from "../review/bundle.js";
import { renderPreview } from "../review/preview-html.js";
import { transformBody } from "./body.js";
import { formatArticle } from "./formats.js";
import { rendererVersion } from "./static-images.js";

type BuildOptions = {
  platform: Platform;
  title?: string;
  summary?: string;
  cover?: string | Uint8Array;
};

export async function buildArticle(paths: WorkspacePaths, reference: string, options: BuildOptions) {
  const snapshot = matchArticle(listArticles(paths), reference);
  const article = readSnapshot(snapshot);
  const { platform } = options;
  const titleOverride = options.title?.replace(/\s+/gu, " ").trim();
  if (titleOverride === "") throw new Error("The title override cannot be empty.");
  const coverOverride = typeof options.cover === "string"
    ? loadCover(paths, options.cover)
    : options.cover === undefined ? null : saveAsset(paths, options.cover, "cover", null);
  const body = await transformBody(paths, article);

  return withDatabase(paths, false, (db) => db.transaction((tx) => {
    if (latestSnapshotVersion(tx, snapshot.sourceUrl) !== snapshot.version) {
      throw new Error("A newer snapshot was imported during this build. Run goldmine build again.");
    }
    const previous = latestBuild(tx, snapshot.sourceUrl, platform);
    const inherited = previous ? readManifest(paths, previous).overrides : null;
    const title = titleOverride ?? (previous && inherited?.title ? previous.title : article.title.replace(/\s+/gu, " ").trim());
    const summary = options.summary === undefined
      ? (previous && inherited?.summary ? previous.summary : article.summary)
      : options.summary.trim() || null;

    let cover = coverOverride;
    if (!cover && previous?.coverAssetId && inherited?.cover) {
      cover = tx.select().from(assets).where(eq(assets.id, previous.coverAssetId)).get() ?? null;
      if (!cover) throw new Error("The previous cover is missing. Choose a new cover.");
      readAsset(paths, assetReference(cover));
    }
    const warnings = body.warnings.slice();
    if (!cover && platform === "wechat") {
      cover = body.firstImage;
      warnings.push(cover ? {
        code: "cover-from-body", severity: "warning", message: "The first available source image is used as the cover.",
      } : {
        code: "cover-required", severity: "blocking", message: "WeChat requires a cover. Build again with --cover.",
      });
    }

    const coverRef = cover ? assetReference(cover) : null;
    const assetList = body.assets.slice();
    if (coverRef && !assetList.some(({ file }) => file === coverRef.file)) assetList.push(coverRef);
    assetList.sort((a, b) => a.file.localeCompare(b.file));
    const { html, markdown, formattedBody } = formatArticle(body.html, platform, title, summary);
    const id = randomUUID();
    const revision = (previous?.revision ?? 0) + 1;
    const content = {
      title, summary, platform, cover: coverRef, assets: assetList,
      htmlSha256: sha256(html), markdownSha256: sha256(markdown),
    };
    const preview = renderPreview(formattedBody, { ...content, version: snapshot.version, revision, warnings });
    const manifest: BuildManifest = {
      ...content,
      schemaVersion: 1, id, sourceUrl: snapshot.sourceUrl, version: snapshot.version,
      snapshotSha256: snapshot.sha256, revision, bundleSha256: bundleFingerprint(content),
      previewSha256: sha256(preview), warnings, rendererVersion, createdAt: new Date().toISOString(),
      overrides: {
        title: options.title !== undefined || inherited?.title === true,
        summary: options.summary !== undefined || inherited?.summary === true,
        cover: coverOverride !== null || inherited?.cover === true,
      },
    };

    const files = bundlePaths(paths, id);
    const staging = bundlePaths(paths, `.${id}.tmp`);
    const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;
    mkdirSync(staging.directory, { mode: 0o700 });
    try {
      for (const [file, data] of [
        [staging.html, html], [staging.markdown, markdown], [staging.manifest, manifestJson], [staging.preview, preview],
      ] as const) {
        writeFileSync(file, data, { mode: 0o600, flag: "wx" });
      }
      renameSync(staging.directory, files.directory);
    } finally {
      rmSync(staging.directory, { recursive: true, force: true });
    }
    tx.insert(platformBuilds).values({
      id, sourceUrl: manifest.sourceUrl, version: manifest.version, platform, revision, title, summary,
      coverAssetId: cover?.id ?? null, htmlSha256: manifest.htmlSha256, markdownSha256: manifest.markdownSha256,
      bundleSha256: manifest.bundleSha256, manifestSha256: sha256(manifestJson),
      warnings, rendererVersion, createdAt: manifest.createdAt,
    }).run();
    return { ...manifest, files };
  }, { behavior: "immediate" }));
}
