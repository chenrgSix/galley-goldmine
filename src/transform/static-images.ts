import { readFileSync } from "node:fs";
import { assetReference, findAsset, readAsset, saveAsset, type Asset } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import { sha256 } from "../core/files.js";
import type { SceneData } from "../importer/scene-source.js";
import type { openMermaidRenderer } from "./mermaid.js";

const { dependencies, optionalDependencies } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string>; optionalDependencies: Record<string, string> };

export const rendererVersion = "3";
const staticImageVersion = "1";

export function staticImages(paths: WorkspacePaths) {
  let mermaid: ReturnType<typeof openMermaidRenderer> | undefined;

  async function renderCached(kind: Asset["kind"], cacheKey: string, render: () => Buffer | Promise<Buffer>) {
    const cached = findAsset(paths, `${kind}:${cacheKey}`);
    if (cached) {
      readAsset(paths, assetReference(cached));
      return cached;
    }
    return saveAsset(paths, await render(), kind, null, cacheKey);
  }

  return {
    async render(kind: "katex" | "mermaid" | "flow", source: string, display = true) {
      const versions = {
        katex: [dependencies["@mathjax/src"], dependencies["@mathjax/mathjax-newcm-font"], dependencies["@resvg/resvg-js"]],
        mermaid: [optionalDependencies.mermaid, optionalDependencies.playwright],
        flow: [dependencies["@resvg/resvg-js"]],
      };
      const assetKind = kind === "flow" ? "image" : kind;
      const cacheKey = sha256(JSON.stringify([staticImageVersion, kind, versions[kind], "neutral", display, source]));
      return renderCached(assetKind, cacheKey, async () => {
        if (kind === "katex") {
          const { formulaPng } = await import("./math.js");
          return formulaPng(source, display);
        }
        if (kind === "flow") {
          const { flowPng } = await import("./flow.js");
          return flowPng(source);
        }
        mermaid ??= import("./mermaid.js").then(({ openMermaidRenderer }) => openMermaidRenderer());
        return (await mermaid).png(source);
      });
    },
    async scene(source: SceneData) {
      const { sceneGif, sceneRendererVersion } = await import("./scene.js");
      const cacheKey = sha256(JSON.stringify([
        "scene", sceneRendererVersion, dependencies["@resvg/resvg-js"], dependencies.gifenc, source,
      ]));
      return renderCached("scene", cacheKey, () => sceneGif(source));
    },
    async close() {
      if (mermaid) await mermaid.then((renderer) => renderer.close(), () => undefined);
    },
  };
}
