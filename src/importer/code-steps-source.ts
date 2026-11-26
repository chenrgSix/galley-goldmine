import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import { clientModuleIds } from "./flight-data.js";

export const codeStepsSelector = "figure.galley-codesteps:not(.galley-scene)";

export type CodeStepGroup = {
  title: string;
  language: string;
  steps: { file: string; code: string; note: string }[];
};

export function visibleCodeStep($: CheerioAPI, figure: ReturnType<CheerioAPI>) {
  const lines = figure.find(".galley-codesteps-code code .galley-codesteps-line").toArray();
  return {
    title: figure.find(".galley-codesteps-file").first().text().trim(),
    count: Number(/\/\s*(\d+)\s*$/u.exec(figure.find(".galley-codesteps-count").text())?.[1]),
    code: lines.length ? lines.map((line) => $(line).text()).join("\n") : figure.find("pre code").first().text(),
    note: figure.find(".galley-codesteps-note-inner").first().text().trim(),
  };
}

const codeStepsProps = z.object({
  title: z.string().optional(),
  lang: z.string().optional(),
  steps: z.array(z.object({
    file: z.string().optional(),
    lines: z.array(z.object({ node: z.unknown() })),
  })).min(1),
  texts: z.array(z.string()).optional(),
});

function flightString(value = ""): string | undefined {
  if (value === "$undefined") return "";
  if (value.startsWith("$$")) return value.slice(1);
  return value.startsWith("$") ? undefined : value;
}

function lineText(value: unknown): string | undefined {
  const pending = [value];
  const parts: string[] = [];
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node === "string") {
      const literal = flightString(node);
      if (literal === undefined) return undefined;
      parts.push(literal);
    } else if (Array.isArray(node)) {
      if (node[0] === "$") {
        const props: unknown = node[3];
        if (!props || typeof props !== "object" || !("children" in props)) return undefined;
        pending.push(props.children);
      } else {
        for (let index = node.length - 1; index >= 0; index -= 1) pending.push(node[index]);
      }
    } else if (node !== null && node !== undefined && node !== false) {
      return undefined;
    }
  }
  return parts.join("");
}

function readGroup(value: unknown): CodeStepGroup | undefined {
  const parsed = codeStepsProps.safeParse(value);
  if (!parsed.success) return undefined;
  const { title, lang, steps, texts } = parsed.data;
  const normalized = steps.map(({ file, lines }, index) => ({
    file: flightString(file) ?? "",
    lines: lines.map(({ node }) => lineText(node)),
    note: flightString(texts?.[index]),
  }));
  if (normalized.some(({ lines, note }) => lines.includes(undefined) || note === undefined)) return undefined;
  return {
    title: flightString(title) ?? "",
    language: flightString(lang) ?? "",
    steps: normalized.map(({ file, lines, note }) => ({ file, code: lines.join("\n"), note: note ?? "" })),
  };
}

export function codeStepSources(data: string, figureCount: number): CodeStepGroup[] | undefined {
  const modules = clientModuleIds(data, "CodeStepsPlayer");
  if (modules.size === 0) return undefined;
  const groups = new Map<number, CodeStepGroup>();

  for (const row of data.split("\n")) {
    if (!row.includes('"galley-code-steps-')) continue;
    const json = /^[\da-f]+:([\[{].*)$/u.exec(row)?.[1];
    if (!json) continue;
    const pending: unknown[] = [];
    try {
      pending.push(JSON.parse(json));
    } catch {
      continue;
    }
    while (pending.length > 0) {
      const element = pending.pop();
      if (!element || typeof element !== "object") continue;
      if (Array.isArray(element) && element[0] === "$" && typeof element[1] === "string" &&
        element[1].startsWith("$L") && modules.has(element[1].slice(2)) && typeof element[2] === "string") {
        const key = /^galley-code-steps-(\d+)$/u.exec(element[2])?.[1];
        if (key) {
          const group = readGroup(element[3]);
          const index = Number(key);
          const previous = groups.get(index);
          if (!group || (previous && JSON.stringify(group) !== JSON.stringify(previous))) return undefined;
          groups.set(index, group);
        }
      }
      for (const child of Object.values(element)) pending.push(child);
    }
  }

  const ordered = Array.from({ length: figureCount }, (_, index) => groups.get(index));
  return groups.size === figureCount && ordered.every((group) => group !== undefined) ? ordered : undefined;
}
