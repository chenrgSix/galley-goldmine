import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Mermaid } from "mermaid";

const resolve = createRequire(import.meta.url).resolve;

async function launchChromium() {
  resolve("mermaid/dist/mermaid.min.js");
  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true, timeout: 8_000 });
}

export async function mermaidAvailable(): Promise<boolean> {
  try {
    const browser = await launchChromium();
    await browser.close();
    return true;
  } catch {
    return false;
  }
}

export async function openMermaidRenderer() {
  const script = readFileSync(resolve("mermaid/dist/mermaid.min.js"), "utf8");
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const browser = await launchChromium();
  return {
    close: () => browser.close(),
    async png(source: string): Promise<Buffer> {
      if (source.length > 20_000) throw new Error("Mermaid source is too long.");
      const page = await browser.newPage({
        offline: true, serviceWorkers: "block", deviceScaleFactor: 2, acceptDownloads: false,
      });
      const timeout = setTimeout(() => void page.close().catch(() => undefined), 15_000);
      try {
        await page.route("**/*", (route) => route.abort());
        await page.setContent(`<!doctype html><meta charset="utf-8">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
          <style>body { margin: 0 } #diagram { width: max-content }</style><div id="diagram"></div>`);
        await page.addScriptTag({ content: script });
        await page.evaluate(async (code) => {
          const { mermaid } = globalThis as typeof globalThis & { mermaid: Mermaid };
          mermaid.initialize({
            theme: "neutral",
            startOnLoad: false,
            securityLevel: "strict",
            htmlLabels: false,
            maxTextSize: 20_000,
            maxEdges: 200,
            secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "theme", "htmlLabels"],
          });
          const { svg } = await mermaid.render("goldmine-svg", code);
          const documentSvg = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
          if (documentSvg.localName !== "svg") throw new Error("Mermaid did not produce SVG.");
          document.querySelector("#diagram")?.replaceChildren(documentSvg);
          const element = documentSvg as unknown as SVGSVGElement;
          const { width, height } = element.viewBox.baseVal;
          if (!(width > 0 && height > 0)) throw new Error("Mermaid produced an invalid image size.");
          const scale = Math.min(1, 1200 / Math.max(width, height));
          element.setAttribute("width", String(Math.max(1, Math.ceil(width * scale))));
          element.setAttribute("height", String(Math.max(1, Math.ceil(height * scale))));
          element.style.maxWidth = "none";
        }, source);
        return await page.locator("#diagram > svg").screenshot({ animations: "disabled", omitBackground: true });
      } finally {
        clearTimeout(timeout);
        await page.context().close();
      }
    },
  };
}
