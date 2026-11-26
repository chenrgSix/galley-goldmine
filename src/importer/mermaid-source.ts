import { clientModuleIds } from "./flight-data.js";

export function mermaidSources(data: string, figureCount: number): Map<number, string> {
  const modules = clientModuleIds(data, "MermaidDiagram");

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
