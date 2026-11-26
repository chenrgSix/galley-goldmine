import { lookup } from "node:dns";
import { readFileSync, statSync } from "node:fs";
import type { LookupFunction } from "node:net";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { imageSize } from "image-size";
import ipaddr from "ipaddr.js";
import { Agent, fetch as fetchImage } from "undici";
import type { WorkspacePaths } from "./config.js";
import { withDatabase } from "./db/client.js";
import { assets } from "./db/schema.js";
import { sha256, writeNewFile } from "./files.js";
import { downloadTimeoutMs, httpUrl, maxDownloadBytes, readResponseBytes, redirectStatuses } from "./http.js";

export type Asset = typeof assets.$inferSelect;
export type AssetRef = Pick<Asset, "sha256" | "kind" | "width" | "height" | "bytes"> & { file: string };

export function relativeAssetPath(asset: AssetRef, occurrence?: number): string {
  const segment = occurrence === undefined ? "" : `image-${occurrence}/../`;
  return `../../assets/${segment}${asset.file}`;
}

const extensions = new Map([
  ["png", "png"], ["jpeg", "jpg"], ["jpg", "jpg"], ["gif", "gif"], ["webp", "webp"],
]);
const mimeByExtension = new Map([
  ["png", "image/png"], ["jpg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"],
]);

export function assetReference(asset: Asset): AssetRef {
  const extension = [...mimeByExtension].find(([, mime]) => mime === asset.mime)?.[0];
  if (!extension) throw new Error("Unsupported stored image format.");
  const { sha256, kind, width, height, bytes } = asset;
  return { file: `${sha256}.${extension}`, sha256, kind, width, height, bytes };
}

export function readAsset(paths: WorkspacePaths, asset: AssetRef): Buffer {
  const content = readFileSync(join(paths.assets, asset.file));
  if (sha256(content) !== asset.sha256) throw new Error(`Asset contents have changed: ${asset.file}`);
  return content;
}

export function findAsset(paths: WorkspacePaths, id: string): Asset | undefined {
  return withDatabase(paths, true, (db) => db.select().from(assets).where(eq(assets.id, id)).get());
}

export function saveAsset(
  paths: WorkspacePaths, content: Uint8Array, kind: Asset["kind"], source: string | null,
  cacheKey: string | null = null,
): Asset {
  if (content.length > maxDownloadBytes) throw new Error("The image exceeds the 12 MiB limit.");
  const { type, width, height } = imageSize(content);
  const mime = mimeByExtension.get(extensions.get(type ?? "") ?? "");
  if (!mime || !(width > 0 && height > 0)) throw new Error("Use a PNG, JPEG, GIF or WebP image.");
  const fingerprint = sha256(content);
  const entry = {
    id: `${kind}:${cacheKey ?? fingerprint}`,
    sha256: fingerprint, kind, source, cacheKey, mime, bytes: content.length, width, height,
  };
  const ref = assetReference(entry);
  if (!writeNewFile(join(paths.assets, ref.file), content)) readAsset(paths, ref);

  return withDatabase(paths, false, (db) => db.transaction((tx) => {
    tx.insert(assets).values(entry).onConflictDoNothing().run();
    const indexed = tx.select().from(assets).where(eq(assets.id, entry.id)).get();
    if (!indexed) throw new Error("The asset could not be indexed.");
    // A concurrent render may have published another valid asset for this input.
    if (indexed.sha256 !== entry.sha256) readAsset(paths, assetReference(indexed));
    return indexed;
  }, { behavior: "immediate" }));
}

const lookupPublic: LookupFunction = (hostname, options, callback) => {
  lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, "");
      return;
    }
    const publicAddresses = addresses.filter(({ address }) => ipaddr.process(address).range() === "unicast");
    const first = publicAddresses[0];
    if (!first) {
      callback(new Error("External images must resolve to a public address."), "");
      return;
    }
    if (options.all) callback(null, publicAddresses);
    else callback(null, first.address, first.family);
  });
};

export async function downloadImage(paths: WorkspacePaths, url: URL, sourceOrigin: string): Promise<Asset> {
  let location = url;
  const signal = AbortSignal.timeout(downloadTimeoutMs);
  let external: Agent | undefined;
  try {
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const crossOrigin = location.origin !== sourceOrigin;
      if (crossOrigin) {
        const host = location.hostname.replace(/^\[|\]$/g, "");
        if (ipaddr.isValid(host) && ipaddr.process(host).range() !== "unicast") {
          throw new Error("External images must use a public address.");
        }
        // Validate addresses at socket connection time, including after a redirect.
        external ??= new Agent({ connect: { lookup: lookupPublic } });
      }
      const response = await fetchImage(location, {
        headers: { accept: "image/png,image/jpeg,image/gif,image/webp" },
        credentials: "omit",
        redirect: "manual",
        signal,
        dispatcher: crossOrigin ? external : undefined,
      });
      if (response.ok) {
        const content = await readResponseBytes(response, "The image exceeds the 12 MiB download limit.");
        return saveAsset(paths, content, "image", url.href);
      }
      await response.body?.cancel();
      if (!redirectStatuses.has(response.status)) throw new Error(`Image returned HTTP ${response.status}.`);
      const next = httpUrl(response.headers.get("location") ?? "", location);
      if (!next || next.href === location.href) throw new Error("The image redirect has no valid destination.");
      location = next;
    }
    throw new Error("The image redirected too many times.");
  } finally {
    await external?.destroy();
  }
}

export function loadCover(paths: WorkspacePaths, file: string): Asset {
  const stats = statSync(file);
  if (!stats.isFile()) throw new Error("Choose a local image file for the cover.");
  if (stats.size > maxDownloadBytes) throw new Error("The cover exceeds the 12 MiB limit.");
  return saveAsset(paths, readFileSync(file), "cover", null);
}
