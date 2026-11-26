import { load } from "cheerio";
import TurndownService from "turndown";
import type { Platform } from "../core/db/schema.js";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const wechatStyles: Record<string, string> = {
  p: "margin:0 0 1em;line-height:1.8",
  "h2,h3,h4,h5,h6": "margin:1.5em 0 0.6em;line-height:1.35;color:#202124",
  a: "color:#146747;text-decoration:underline",
  "blockquote,.goldmine-callout,.goldmine-fold": "margin:1em 0;padding:0.75em 1em;border-left:3px solid #489475;background:#f2f7f4",
  figure: "margin:1em 0",
  figcaption: "color:#545b57;font-size:0.9em",
  img: "max-width:100%;height:auto",
  "img.goldmine-display": "display:block;max-width:100%;height:auto;margin:1em auto",
  "img.goldmine-inline": "max-width:100%;height:auto;vertical-align:middle",
  pre: "overflow-x:auto;margin:1em 0;padding:0.8em 1em;background:#f3f5f4",
  table: "width:100%;border-collapse:collapse;margin:1em 0",
  "th,td": "border:1px solid #cad5ce;padding:0.45em;text-align:left",
};

export function formatArticle(body: string, platform: Platform, title: string, summary: string | null) {
  const $ = load(body, {}, false);
  if (platform === "wechat") {
    for (const [selector, style] of Object.entries(wechatStyles)) $(selector).attr("style", style);
  }
  const formattedBody = $.html();
  const description = summary === null ? "" : `<meta name="description" content="${escapeHtml(summary)}">\n`;
  const html = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${description}</head><body>
<section>${formattedBody}</section>
</body></html>
`;

  const markdownConverter = new TurndownService({
    headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-",
  });
  // Retain table markup so captions and cell spans survive Markdown export.
  markdownConverter.keep(["table"]);
  markdownConverter.addRule("caption", {
    filter: "figcaption",
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });
  const markdown = `${markdownConverter.turndown(`<h1>${escapeHtml(title)}</h1>${body}`)}\n`;
  return { html, markdown, formattedBody };
}
