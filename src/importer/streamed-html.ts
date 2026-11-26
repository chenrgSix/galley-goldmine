import type { CheerioAPI } from "cheerio";

export function restoreStreamedSegments($: CheerioAPI): void {
  // React streams some article elements into hidden containers and inserts them into these slots.
  // Read the slot IDs as data and move the parsed nodes without executing React's scripts.
  const slots = new Map<string, string>();
  $("script:not([src])").each((_index, element) => {
    const script = $(element).html() ?? "";
    for (const [, segment, slot] of script.matchAll(/\$RS\("(S:[\da-f]+)","(P:[\da-f]+)"\)/gu)) {
      if (segment && slot) slots.set(slot, segment);
    }
  });
  if (slots.size === 0) return;
  const containers = new Map($('div[hidden][id^="S:"]').toArray().map((element) => [element.attribs.id, element]));
  $('template[id^="P:"]').each((_index, element) => {
    const segment = slots.get(element.attribs.id ?? "");
    const container = segment ? containers.get(segment) : undefined;
    if (!container || !segment) return;
    containers.delete(segment);
    $(element).replaceWith($(container).contents());
    $(container).remove();
  });
}
