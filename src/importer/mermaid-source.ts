import type { CheerioAPI } from "cheerio";

function flightData($: CheerioAPI): string {
  // Only read JSON arguments from the inert script nodes. Never run the page scripts.
  const chunks: string[] = [];
  $("script:not([src])").each((_index, script) => {
    const match = /^self\.__next_f\.push\((\[1,".*"\])\);?$/.exec($(script).html()?.trim() ?? "");
    if (!match?.[1]) return;
    try {
      const chunk: unknown = JSON.parse(match[1])[1];
      if (typeof chunk === "string") chunks.push(chunk);
    } catch {
      // An unsupported transport record leaves the figures without a source.
    }
  });
  return chunks.join("");
}

export function mermaidSources($: CheerioAPI, figureCount: number): Map<number, string> {
  const data = flightData($);
  const modules = new Set<string>();
  for (const [, id] of data.matchAll(/^([\da-f]+):I\[[^\n]*,"MermaidDiagram"\]$/gmu)) {
    if (id) modules.add(id);
  }

  const sources = new Map<number, string>();
  for (const [, id, index, code] of data.matchAll(
    /\["\$","\$L([\da-f]+)","galley-mermaid-(\d+)",\{"code":("(?:[^"\\]|\\.)*"),"review":false\}/gu,
  )) {
    if (!id || !modules.has(id) || !code) continue;
    try {
      const source: string = JSON.parse(code);
      const order = Number(index);
      if (sources.has(order) && sources.get(order) !== source) return new Map();
      sources.set(order, source);
    } catch {
      return new Map();
    }
  }
  // Only pair sources with article figures when every position has a match.
  if (sources.size !== figureCount || Array.from({ length: figureCount }, (_, index) => index)
    .some((index) => !sources.has(index))) return new Map();
  return sources;
}
