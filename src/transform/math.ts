import { MathJaxNewcmFont } from "@mathjax/mathjax-newcm-font/js/svg.js";
import { liteAdaptor } from "@mathjax/src/js/adaptors/liteAdaptor.js";
import type { LiteElement } from "@mathjax/src/js/adaptors/lite/Element.js";
import { RegisterHTMLHandler } from "@mathjax/src/js/handlers/html.js";
import { TeX } from "@mathjax/src/js/input/tex.js";
import "@mathjax/src/js/input/tex/ams/AmsConfiguration.js";
import "@mathjax/src/js/input/tex/newcommand/NewcommandConfiguration.js";
import "@mathjax/src/js/input/tex/textmacros/TextMacrosConfiguration.js";
import { mathjax } from "@mathjax/src/js/mathjax.js";
import { SVG } from "@mathjax/src/js/output/svg.js";
import { Resvg } from "@resvg/resvg-js";

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);

export async function formulaPng(source: string, display: boolean): Promise<Buffer> {
  if (source.length > 8192) throw new Error("TeX source is too long.");
  // Each formula gets its own TeX environment so local macros cannot affect another cache entry.
  const document = mathjax.document("", {
    InputJax: new TeX({
      packages: ["base", "ams", "newcommand", "textmacros"],
      maxBuffer: 8192,
      maxMacros: 1000,
      formatError: (_jax: TeX<unknown, unknown, unknown>, error: unknown) => { throw error; },
    }),
    OutputJax: new SVG({ fontData: MathJaxNewcmFont, fontCache: "none" }),
  });
  const svg = await mathjax.handleRetriesFor(() => {
    const container = document.convert(source, { display, em: 16, ex: 8, containerWidth: 800 });
    return adaptor.firstChild(container as LiteElement) as LiteElement;
  });

  for (const attribute of ["width", "height"]) {
    const length = adaptor.getAttribute(svg, attribute) ?? "";
    const pixels = Math.ceil(Number.parseFloat(length) * 8);
    if (!length.endsWith("ex") || !(pixels > 0 && pixels <= 1600)) {
      throw new Error("MathJax produced an unsupported image size.");
    }
    adaptor.setAttribute(svg, attribute, String(pixels));
  }
  adaptor.setAttribute(svg, "color", "#202124");
  return new Resvg(adaptor.outerHTML(svg), { fitTo: { mode: "zoom", value: 2 } }).render().asPng();
}
