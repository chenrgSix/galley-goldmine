import type { CheerioAPI } from "cheerio";
import { z } from "zod";
import { clientModuleIds, flightString } from "./flight-data.js";

export const sceneSelector = "figure.galley-scene";

const identifier = z.string().regex(/^[\w-]{1,64}$/u);
const label = z.string().max(2048).transform((value, context) => {
  const literal = flightString(value);
  if (literal !== undefined) return literal;
  context.addIssue({ code: "custom", message: "Unresolved Flight text." });
  return z.NEVER;
});
const color = z.string().regex(/^(?:ink|soft|accent|paper|none|c[1-8]|#[a-f\d]{3}|#[a-f\d]{6})(?:\/(?:100|[1-9]?\d))?$/iu);
const coordinate = z.number().min(-16_000).max(16_000);
const dimension = z.number().positive().max(4096);
const opacity = z.number().min(0).max(1);
const size = z.number().positive().max(200);
const scale = z.number().positive().max(16);
const position = { x: coordinate, y: coordinate, ox: coordinate, oy: coordinate, rotate: coordinate, scale, opacity };

const props = {
  camera: z.object({ x: coordinate, y: coordinate, zoom: scale }),
  box: z.object({
    ...position, w: dimension, h: dimension, radius: z.number().min(0).max(2048),
    text: label, sub: label, size, color, fill: color, stroke: color, dashed: opacity,
  }),
  text: z.object({
    ...position, w: dimension, h: dimension, text: label, size, color, bold: opacity, mono: opacity,
    align: z.enum(["start", "middle", "end"]),
  }),
  link: z.object({
    opacity, draw: opacity, bend: coordinate, width: size, dashed: opacity, text: label, size, color, stroke: color,
    head: z.enum(["none", "start", "end", "both"]),
  }),
  packet: z.object({ opacity, pos: opacity, r: size, fill: color, text: label, size, color }),
};

const sceneNode = z.discriminatedUnion("kind", [
  z.object({ id: identifier, kind: z.literal("camera"), props: props.camera }),
  z.object({ id: identifier, kind: z.literal("box"), props: props.box }),
  z.object({ id: identifier, kind: z.literal("text"), props: props.text }),
  z.object({ id: identifier, kind: z.literal("link"), from: identifier, to: identifier, props: props.link }),
  z.object({ id: identifier, kind: z.literal("packet"), along: identifier, props: props.packet }),
]);
const milliseconds = z.number().nonnegative().max(1_000_000);
const sceneProps = z.object({
  title: label,
  beat: identifier,
  scene: z.object({
    w: dimension, h: dimension,
    nodes: z.array(sceneNode).min(1).max(256),
    steps: z.array(z.object({
      duration: milliseconds,
      text: label,
      tweens: z.array(z.object({
        id: identifier, prop: identifier, at: milliseconds, dur: milliseconds,
        to: z.union([z.number(), z.string().max(2048)]),
      })).max(1024),
    })).min(1).max(80),
  }),
});

export type SceneNode = z.infer<typeof sceneNode>;
type SceneChange = { id: string; property: string; value: number | string };
export type SceneData = {
  title: string;
  width: number;
  height: number;
  nodes: SceneNode[];
  steps: { caption: string; changes: SceneChange[] }[];
};

function endpoint(node: SceneNode | undefined) {
  return node?.kind === "box" || node?.kind === "text";
}

function readScene(value: unknown): { beat: string; data: SceneData } | undefined {
  const parsed = sceneProps.safeParse(value);
  if (!parsed.success) return undefined;
  const { title, beat, scene: { w, h, nodes, steps: sourceSteps } } = parsed.data;
  const index = new Map(nodes.map((node) => [node.id, node]));
  if (index.size !== nodes.length || nodes.some((node) =>
    (node.kind === "link" && (!endpoint(index.get(node.from)) || !endpoint(index.get(node.to))))
    || (node.kind === "packet" && index.get(node.along)?.kind !== "link"))) return undefined;

  const steps: SceneData["steps"] = [];
  for (const step of sourceSteps) {
    const changes: SceneChange[] = [];
    // At the end of the step the last tween started for each property is authoritative.
    for (const tween of step.tweens.toSorted((a, b) => a.at - b.at)) {
      const node = index.get(tween.id);
      if (!node || tween.at + tween.dur > step.duration) return undefined;
      const fields: Record<string, z.ZodType> = props[node.kind].shape;
      const result = Object.hasOwn(fields, tween.prop) && fields[tween.prop]?.safeParse(tween.to);
      if (!result || !result.success || (typeof result.data !== "string" && typeof result.data !== "number")) return undefined;
      changes.push({ id: tween.id, property: tween.prop, value: result.data });
    }
    steps.push({ caption: step.text, changes });
  }
  return { beat, data: { title, width: w, height: h, nodes, steps } };
}

function matchesFigure($: CheerioAPI, figure: ReturnType<CheerioAPI>, beat: string, scene: SceneData) {
  const header = figure.children(".galley-codesteps-head");
  const stage = figure.children(".galley-scene-stage").children("svg").first();
  const title = header.find(".galley-codesteps-file").first().text().trim();
  const count = /\/\s*(\d+)\s*$/u.exec(header.find(".galley-codesteps-count").text())?.[1];
  const viewBox = stage.attr("viewBox")?.trim().split(/\s+/u).map(Number);
  if (title !== scene.title.trim() || Number(count) !== scene.steps.length
    || viewBox?.join(" ") !== `0 0 ${scene.width} ${scene.height}`) return false;

  const expected = scene.nodes.filter((node) => node.kind !== "camera" && node.props.opacity > 0)
    .map((node) => `${beat}:${node.id}`).sort();
  const rendered = stage.find('[data-guide-visible="true"][data-galley-target]').toArray()
    .map((target) => $(target).attr("data-galley-target")).sort();
  return expected.length === rendered.length && expected.every((id, index) => id === rendered[index]);
}

export function sceneSources(data: string, $: CheerioAPI, figures: ReturnType<CheerioAPI>): (SceneData | null)[] | undefined {
  const modules = clientModuleIds(data, "ScenePlayer");
  if (modules.size === 0) return undefined;
  const sources = new Map<number, SceneData | null>();
  for (const row of data.split("\n")) {
    if (!row.includes('"galley-scene-')) continue;
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
      const [marker, module, key, value] = Array.isArray(element) ? element : [];
      if (marker !== "$" || typeof module !== "string" || !module.startsWith("$L")
        || !modules.has(module.slice(2)) || typeof key !== "string") {
        for (const child of Object.values(element)) pending.push(child);
        continue;
      }
      const match = /^galley-scene-(\d+),([\w-]+)$/u.exec(key);
      if (!match) continue;
      const index = Number(match[1]);
      if (index >= figures.length) continue;
      const scene = readScene(value);
      const recovered = scene && scene.beat === match[2] && matchesFigure($, figures.eq(index), scene.beat, scene.data)
        ? scene.data : null;
      const previous = sources.get(index);
      sources.set(index, previous !== undefined && JSON.stringify(previous) !== JSON.stringify(recovered) ? null : recovered);
    }
  }
  const ordered = Array.from({ length: figures.length }, (_, index) => sources.get(index) ?? null);
  return ordered.some((scene) => scene !== null) ? ordered : undefined;
}
