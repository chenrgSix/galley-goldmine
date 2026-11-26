import { readFileSync } from "node:fs";
import { assetReference, findAsset, readAsset, saveAsset } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import { sha256 } from "../core/files.js";
import type { openMermaidRenderer } from "./mermaid.js";

const { dependencies, optionalDependencies } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string>; optionalDependencies: Record<string, string> };

export const rendererVersion = "1";

export function staticImages(paths: WorkspacePaths) {
  let mermaid: ReturnType<typeof openMermaidRenderer> | undefined;

  return {
    async render(kind: "katex" | "mermaid", source: string, display = true) {
      const versions = kind === "katex"
        ? [dependencies["@mathjax/src"], dependencies["@mathjax/mathjax-newcm-font"], dependencies["@resvg/resvg-js"]]
        : [optionalDependencies.mermaid, optionalDependencies.playwright];
      const cacheKey = sha256(JSON.stringify([rendererVersion, kind, versions, "neutral", display, source]));
      const cached = findAsset(paths, `${kind}:${cacheKey}`);
      if (cached) {
        readAsset(paths, assetReference(cached));
        return cached;
      }

      let bytes: Buffer;
      if (kind === "katex") {
        const { formulaPng } = await import("./math.js");
        bytes = await formulaPng(source, display);
      } else {
        mermaid ??= import("./mermaid.js").then(({ openMermaidRenderer }) => openMermaidRenderer());
        bytes = await (await mermaid).png(source);
      }
      return saveAsset(paths, bytes, kind, null, cacheKey);
    },
    async close() {
      if (mermaid) await mermaid.then((renderer) => renderer.close(), () => undefined);
    },
  };
}
