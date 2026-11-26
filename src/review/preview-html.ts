import { load } from "cheerio";
import { relativeAssetPath, type AssetRef } from "../core/assets.js";
import type { BuildWarning, Platform } from "../core/db/schema.js";
import { escapeHtml } from "../transform/formats.js";

type PreviewDetails = {
  title: string;
  summary: string | null;
  platform: Platform;
  version: number;
  revision: number;
  cover: AssetRef | null;
  assets: AssetRef[];
  warnings: BuildWarning[];
};

export function renderPreview(body: string, info: PreviewDetails): string {
  const $ = load(body, {}, false);
  $("pre").attr({ tabindex: "0", role: "region", "aria-label": "代码块" });
  const { title, summary, platform, version, revision, cover, assets, warnings } = info;
  const warningList = warnings.map(({ severity, message }) =>
    `<li><strong>${severity === "blocking" ? "阻断" : "提示"}</strong> ${escapeHtml(message)}</li>`).join("");
  const assetList = assets.map(({ file, kind, width, height }) =>
    `<li><code>${file}</code> · ${kind} · ${width} × ${height}</li>`).join("");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' file:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 2rem auto; max-width: 46rem; padding-inline: 1.25rem; font: 1rem/1.7 system-ui, sans-serif; color: #202124; }
    header, footer { border-block-end: 1px solid #d8dedb; padding-block: 1rem; }
    footer { border-block: 1px solid #d8dedb; }
    article { padding-block: 1rem; }
    img { max-width: 100%; height: auto; }
    img.goldmine-display { display: block; margin: 1em auto; }
    img.goldmine-inline { vertical-align: middle; }
    pre { overflow-x: auto; }
    code { overflow-wrap: anywhere; }
    table { border-collapse: collapse; }
    th, td { padding: .25em .5em; border: 1px solid #d8dedb; }
    .cover { max-width: min(100%, 25rem); }
  </style>
</head>
<body>
<main>
  <header>
    <p>${platform === "wechat" ? "微信公众号" : "今日头条"} · 快照 v${version} · 构建 ${revision}</p>
    <h1>${escapeHtml(title)}</h1>
    ${summary === null ? "" : `<p>${escapeHtml(summary)}</p>`}
    ${cover ? `<img class="cover" src="${relativeAssetPath(cover)}" alt="文章封面" width="${cover.width}" height="${cover.height}">` : ""}
  </header>
  ${warningList ? `<aside><h2>构建提示</h2><ul>${warningList}</ul></aside>` : ""}
  <article aria-label="文章正文">${$.html()}</article>
  <footer>
    <h2>素材</h2>
    ${assetList ? `<ul>${assetList}</ul>` : "<p>无素材</p>"}
  </footer>
</main>
</body>
</html>
`;
}
