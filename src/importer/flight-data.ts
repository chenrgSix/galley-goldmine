import type { CheerioAPI } from "cheerio";

export function flightData($: CheerioAPI): string {
  // Only read JSON arguments from the inert script nodes. Never run the page scripts.
  const chunks: string[] = [];
  $("script:not([src])").each((_index, script) => {
    const match = /^self\.__next_f\.push\((\[1,".*"\])\);?$/.exec($(script).html()?.trim() ?? "");
    if (!match?.[1]) return;
    try {
      const chunk: unknown = JSON.parse(match[1])[1];
      if (typeof chunk === "string") chunks.push(chunk);
    } catch {
      // Unsupported transport records leave their components without a source.
    }
  });
  return chunks.join("");
}

export function clientModuleIds(data: string, name: string): Set<string> {
  const ids = new Set<string>();
  const suffix = `,${JSON.stringify(name)}]`;
  for (const [row, id] of data.matchAll(/^([\da-f]+):I\[[^\n]*\]$/gmu)) {
    if (id && row.endsWith(suffix)) ids.add(id);
  }
  return ids;
}

export function flightString(value = ""): string | undefined {
  if (value === "$undefined") return "";
  if (value.startsWith("$$")) return value.slice(1);
  return value.startsWith("$") ? undefined : value;
}
