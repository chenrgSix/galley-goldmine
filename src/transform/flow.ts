import { Resvg } from "@resvg/resvg-js";
import { load } from "cheerio";
import sanitizeHtml from "sanitize-html";

const arrow = '<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,1 L9,5 L0,9 z" fill="#6e6257"/></marker></defs>';
const stylesheet = `<style>
  text { font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "Songti SC", sans-serif; }
  .galley-flow-node rect { fill: #faf3e7; stroke: #89796a; }
  .galley-flow-node text { fill: #29241e; font-size: 14px; }
  .galley-flow-edge path { fill: none; stroke: #6e6257; stroke-width: 1.3; }
  .galley-flow-label rect { fill: #fffdfa; stroke: #dcd3c0; }
  .galley-flow-label text { fill: #4b4137; font-size: 12px; }
</style>`;

export function prepareFlowSvg(markup: string): string {
  const safe = sanitizeHtml(markup, {
    allowedTags: ["svg", "g", "path", "rect", "text"],
    allowedAttributes: {
      svg: ["viewBox"], g: ["class", "transform"], path: ["d", "marker-end"],
      rect: ["x", "y", "width", "height", "rx"], text: ["x", "y", "text-anchor", "dy"],
    },
    allowedClasses: { g: ["galley-flow-edge", "galley-flow-label", "galley-flow-node"] },
    disallowedTagsMode: "completelyDiscard",
    parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
  });
  const $ = load(safe, { xml: true }, false);
  const svg = $("svg").first();
  const viewBox = svg.attr("viewBox")?.trim().split(/[\s,]+/u).map(Number) ?? [];
  const [, , width, height] = viewBox;
  if (viewBox.length !== 4 || viewBox.some((value) => !Number.isFinite(value)) ||
    !width || width <= 0 || width > 1600 || !height || height <= 0 || height > 1600 ||
    !svg.find(".galley-flow-node text").text().trim()) {
    throw new Error("Unsupported Galley flow diagram.");
  }
  // Replace document-local React IDs with a fixed marker and use only our own styles.
  svg.find("path[marker-end]").attr("marker-end", "url(#flow-arrow)");
  svg.attr({
    xmlns: "http://www.w3.org/2000/svg",
    width: String(Math.ceil(width)), height: String(Math.ceil(height)),
  });
  svg.prepend(arrow);
  svg.prepend(stylesheet);
  return svg.toString();
}

export function flowPng(svg: string): Buffer {
  return new Resvg(svg, { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
}
