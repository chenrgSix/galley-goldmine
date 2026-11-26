import { readFileSync } from "node:fs";
import { assetReference, findAsset, readAsset, saveAsset } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import { sha256 } from "../core/files.js";
import type { openMermaidRenderer } from "./mermaid.js";

const { dependencies, optionalDependencies } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string>; optionalDependencies: Record<string, string> };

export const rendererVersion = "2";
const staticImageVersion = "1";

export function staticImages(paths: WorkspacePaths) {
  let mermaid: ReturnType<typeof openMermaidRenderer> | undefined;

  return {
    async render(kind: "katex" | "mermaid" | "flow", source: string, display = true) {
      const versions = {
        katex: [dependencies["@mathjax/src"], dependencies["@mathjax/mathjax-newcm-font"], dependencies["@resvg/resvg-js"]],
        mermaid: [optionalDependencies.mermaid, optionalDependencies.playwright],
        flow: [dependencies["@resvg/resvg-js"]],
      };
      const assetKind = kind === "flow" ? "image" : kind;
      const cacheKey = sha256(JSON.stringify([staticImageVersion, kind, versions[kind], "neutral", display, source]));
      const cached = findAsset(paths, `${assetKind}:${cacheKey}`);
      if (cached) {
        readAsset(paths, assetReference(cached));
        return cached;
      }

      let bytes: Buffer;
      if (kind === "katex") {
        const { formulaPng } = await import("./math.js");
        bytes = await formulaPng(source, display);
      } else if (kind === "flow") {
        const { flowPng } = await import("./flow.js");
        bytes = flowPng(source);
      } else {
        mermaid ??= import("./mermaid.js").then(({ openMermaidRenderer }) => openMermaidRenderer());
        bytes = await (await mermaid).png(source);
      }
      return saveAsset(paths, bytes, assetKind, null, cacheKey);
    },
    async close() {
      if (mermaid) await mermaid.then((renderer) => renderer.close(), () => undefined);
    },
  };
}
