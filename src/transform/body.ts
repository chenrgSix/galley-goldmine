import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { assetReference, downloadImage, relativeAssetPath, type Asset, type AssetRef } from "../core/assets.js";
import type { WorkspacePaths } from "../core/config.js";
import type { BuildWarning } from "../core/db/schema.js";
import { httpUrl } from "../core/http.js";
import type { GalleyArticle } from "../importer/galley.js";
import { flattenCodeSteps } from "./code-steps.js";
import { staticImages } from "./static-images.js";

const allowedTags = [
  "section", "div", "aside", "figure", "figcaption", "p", "span", "blockquote", "cite",
  "h1", "h2", "h3", "h4", "h5", "h6", "hr", "br", "a", "img", "strong", "em", "b", "i", "s",
  "u", "del", "mark", "sub", "sup", "kbd", "pre", "code", "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td",
];

const discarded = "script, style, template, iframe, object, embed, link, meta, base, noscript, galley-notes";
const interactive = [
  ".galley-algo", ".galley-chart", ".galley-codesteps", ".galley-compare", ".galley-flow",
  ".galley-quiz", ".galley-race", ".galley-scene", ".galley-scene3d", ".galley-steps", ".galley-tabs",
  "video", "audio", "canvas",
].join(", ");

export async function transformBody(paths: WorkspacePaths, article: GalleyArticle) {
  const $ = load(article.bodyHtml, {}, false);
  const warnings: BuildWarning[] = [];
  const usedAssets = new Map<string, AssetRef>();
  const downloads = new Map<string, Promise<Asset>>();
  const staticImage = staticImages(paths);
  const sourceOrigin = new URL(article.sourceUrl).origin;
  let firstImage: Asset | null = null;
  let repeatedImages = 0;

  function useImage(asset: Asset, alt: string, sizeScale = 1) {
    const ref = assetReference(asset);
    // Wechatsync replaces one occurrence per distinct src. A dot segment keeps the file the same.
    const occurrence = usedAssets.has(ref.file) ? ++repeatedImages : undefined;
    if (occurrence === undefined) usedAssets.set(ref.file, ref);
    return $("<img>").attr({
      src: relativeAssetPath(ref, occurrence),
      alt,
      width: String(Math.ceil(ref.width / sizeScale)),
      height: String(Math.ceil(ref.height / sizeScale)),
    });
  }

  $(discarded).remove();
  if (flattenCodeSteps($, article.codeSteps)) {
    warnings.push({
      code: "code-steps-source-missing", severity: "blocking",
      message: "Some code steps could not be recovered. Import the current public page before building again.",
    });
  }
  $("button, input, textarea, select, .galley-anchor, .galley-tabs-list, .galley-mermaid-placeholder").remove();
  $("details").each((_index, node) => {
    const details = $(node);
    const summary = details.children("summary").first();
    const section = $("<section>").addClass("goldmine-fold");
    if (summary.text().trim()) section.append($("<p>").append($("<strong>").text(summary.text())));
    summary.remove();
    details.replaceWith(section.append(details.contents()));
  });
  $("aside.galley-callout").each((_index, node) => {
    const callout = $(node);
    const label = callout.hasClass("galley-callout-tip") ? "提示"
      : callout.hasClass("galley-callout-warning") ? "注意" : "说明";
    callout.prepend($("<p>").append($("<strong>").text(label)));
    callout.addClass("goldmine-callout");
  });
  $("a[href], blockquote[cite]").each((_index, node) => {
    const element = $(node);
    const attribute = node.tagName === "a" ? "href" : "cite";
    const value = element.attr(attribute)?.trim();
    const url = value && httpUrl(value, article.sourceUrl);
    if (url) element.attr(attribute, url.href);
    else element.removeAttr(attribute);
  });

  // Work on source images first so generated diagrams and equations never become automatic covers.
  for (const node of $("img").not("svg img").toArray()) {
    const image = $(node);
    const alt = image.attr("alt") ?? "";
    const src = image.attr("src")?.trim();
    const url = src ? httpUrl(src, article.sourceUrl) : null;
    try {
      if (!url) throw new Error("The image address is invalid.");
      url.hash = "";
      let pending = downloads.get(url.href);
      if (!pending) {
        pending = downloadImage(paths, url, sourceOrigin);
        downloads.set(url.href, pending);
      }
      const asset = await pending;
      firstImage ??= asset;
      image.replaceWith(useImage(asset, alt));
    } catch {
      image.replaceWith($("<span>").text(alt || "[图片不可用]"));
      warnings.push({
        code: "image-unavailable", severity: "blocking",
        message: alt ? `Could not localize image “${alt.slice(0, 100)}”.` : "Could not localize a body image.",
      });
    }
  }

  function codeFallback(source: string, display: boolean, language: string) {
    const code = $("<code>").addClass(`language-${language}`).text(source);
    return display ? $("<pre>").append(code) : code;
  }

  async function render(
    element: ReturnType<typeof $>,
    kind: "katex" | "mermaid", source: string, display: boolean,
  ) {
    const name = kind === "katex" ? "TeX formula" : "Mermaid diagram";
    try {
      if (!source) throw new Error("Component source is missing.");
      const png = await staticImage.render(kind, source, display);
      const image = useImage(png, kind === "katex" ? source : name, 2);
      image.addClass(display ? "goldmine-display" : "goldmine-inline");
      element.replaceWith(image);
    } catch {
      const language = kind === "katex" ? "tex" : "mermaid";
      const fallback = source || element.text().trim() || `[${name} unavailable]`;
      element.replaceWith(codeFallback(fallback, display, language));
      warnings.push({
        code: source ? `${kind}-render-failed` : `${kind}-source-missing`, severity: "blocking",
        message: source ? `Could not render a ${name}. The source is shown as text.`
          : `No source was available for a ${name}. Try importing the current public page again.`,
      });
    }
  }

  try {
    for (const node of $("figure.galley-flow").toArray()) {
      const figure = $(node);
      const svg = figure.children("svg").first();
      const alt = svg.attr("aria-label")?.trim() || svg.find("text").toArray()
        .map((label) => $(label).text().trim()).filter(Boolean).join(" / ");
      try {
        const { prepareFlowSvg } = await import("./flow.js");
        const png = await staticImage.render("flow", prepareFlowSvg(svg.toString()));
        svg.replaceWith(useImage(png, alt || "流程图", 2).addClass("goldmine-display"));
      } catch {
        figure.children("svg").remove();
        figure.prepend($("<p>").text(alt || "[流程图暂不可用]"));
        warnings.push({
          code: "flow-render-failed", severity: "blocking",
          message: "Could not render a Galley flow diagram. The available labels are shown as text.",
        });
      }
      figure.removeClass("galley-flow");
    }
    for (const node of $(".katex-display, .katex").toArray()) {
      const formula = $(node);
      if (formula.parents(".katex-display, .katex").length > 0) continue;
      const source = formula.find('annotation[encoding="application/x-tex"]').first().text().trim();
      await render(formula, "katex", source, formula.hasClass("katex-display"));
    }
    for (const node of $("figure.galley-mermaid, pre > code.language-mermaid").toArray()) {
      const diagram = $(node);
      if (diagram.is("code") && diagram.parents("figure.galley-mermaid").length > 0) continue;
      const block = diagram.is("code") ? diagram.parent() : diagram;
      const source = diagram.is("code") ? diagram.text() : diagram.find("pre.galley-mermaid-source").first().text();
      await render(block, "mermaid", source.trim(), true);
    }
  } finally {
    await staticImage.close();
  }

  const unsupported = $(interactive).add($("*").filter((_index, element) =>
    element.type === "tag" && element.name.startsWith("galley-")));
  if (unsupported.length > 0 || $("svg, math").length > 0) {
    warnings.push({
      code: "static-fallback", severity: "warning",
      message: "Interactive or unsupported elements were flattened. Check the retained text and media.",
    });
  }
  $("svg").remove();

  const html = sanitizeHtml($.html(), {
    allowedTags,
    allowedAttributes: {
      a: ["href", "title"], blockquote: ["cite"], aside: ["class"], section: ["class"],
      img: ["src", "alt", "width", "height", "class"], code: ["class"],
      ol: ["start", "reversed"], li: ["value"], th: ["scope", "colspan", "rowspan"], td: ["colspan", "rowspan"],
    },
    allowedClasses: {
      aside: ["goldmine-callout"], section: ["goldmine-fold", "goldmine-code-steps"],
      img: ["goldmine-display", "goldmine-inline"], code: [/^language-[\w+-]+$/],
    },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
  });
  if (!load(html, {}, false).root().text().trim() && usedAssets.size === 0) {
    warnings.push({ code: "empty-body", severity: "blocking", message: "The converted body is empty." });
  }
  return { html, warnings, assets: [...usedAssets.values()], firstImage };
}
