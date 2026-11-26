import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { renderAsync, type ResvgRenderOptions } from "@resvg/resvg-js";
import type { SceneData, SceneNode } from "../importer/scene-source.js";
import { escapeHtml } from "./formats.js";

export const sceneRendererVersion = "3";
const { GIFEncoder, applyPalette, quantize } = createRequire(import.meta.url)("gifenc") as typeof import("gifenc").default;
const width = 1000;
const titleHeight = 46;
const canvasHeight = 470;
const captionHeight = 66;
const height = titleHeight + canvasHeight + captionHeight;
const resizeThreshold = 2 * 1024 * 1024;
const maxGifBytes = 10_000_000;

const red = "#D43A2F";
const ink = "#20242A";
const soft = "#6E7681";
const border = "#C4CBD4";
const dim = { fill: "#F0F1F3", ink: "#9AA0A6", sub: "#A6ABB3" };
const tones: Record<string, string> = {
  c2: "#DCE9F7", c3: "#FBEED3", c4: "#E7E2F7", c5: "#DFF2E2", soft: "#EFF1F4", accent: "#FDECEC",
};
const colors: Record<string, string> = {
  ink, soft, accent: red, paper: "#FFFFFF", none: "none", c1: "#407C78", c2: "#4B79AE", c3: "#A4742A",
  c4: "#6E5DA3", c5: "#4F825B", c6: "#9C5A69", c7: "#506F85", c8: "#887168",
};

const notoRegular = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc";
const notoBold = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc";
const notoFonts = [notoRegular, notoBold].filter((file) => existsSync(file));
const fontOptions: ResvgRenderOptions = {
  font: { fontFiles: notoFonts, defaultFontFamily: "Noto Sans CJK SC" },
  languages: ["zh-CN", "en"],
};
const fontStack = "'Noto Sans CJK SC','PingFang SC','Hiragino Sans GB','Microsoft YaHei','Songti SC',sans-serif";

type PacketLabels = ReadonlyMap<string, string>;
type Frame = { nodes: SceneNode[]; caption: string; sent: ReadonlyMap<string, PacketLabels>; delay: number };
type Point = { x: number; y: number };
type Box = Extract<SceneNode, { kind: "box" }>;
type Text = Extract<SceneNode, { kind: "text" }>;
type Link = Extract<SceneNode, { kind: "link" }>;
type Packet = Extract<SceneNode, { kind: "packet" }>;
type Endpoint = Box | Text;
type Scale = { x: number; y: number };

export function* sceneFrames(scene: SceneData): Generator<Frame> {
  const nodes = structuredClone(scene.nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  yield { nodes: structuredClone(nodes), caption: "", sent: new Map(), delay: 1000 };
  for (const [index, step] of scene.steps.entries()) {
    const packets = new Set<Packet>();
    for (const change of step.changes) {
      const node = byId.get(change.id);
      if (!node || !Object.hasOwn(node.props, change.property)) throw new Error("Invalid scene property change.");
      // A packet can advance and fade out in the same step.
      if (node.kind === "packet" && change.property === "pos"
        && typeof change.value === "number" && change.value > node.props.pos) packets.add(node);
      Object.assign(node.props, { [change.property]: change.value });
    }
    const sent = new Map<string, Map<string, string>>();
    for (const packet of packets) {
      const labels = sent.get(packet.along) ?? new Map<string, string>();
      labels.set(packet.id, packet.props.text);
      sent.set(packet.along, labels);
    }
    yield { nodes: structuredClone(nodes), caption: step.caption, sent, delay: index === scene.steps.length - 1 ? 2600 : 1500 };
  }
}

function paint(value: string) {
  const [tone = "ink", alpha] = value.toLowerCase().split("/");
  if (alpha === "14" && Object.hasOwn(tones, tone)) return tones[tone]!;
  const pigment = /^#[a-f\d]{3}(?:[a-f\d]{3})?$/u.test(tone) ? tone
    : Object.hasOwn(colors, tone) ? colors[tone]! : ink;
  if (alpha === undefined || pigment === "none") return pigment;
  const hex = pigment.length === 4 ? Array.from(pigment.slice(1), (digit) => digit.repeat(2)).join("") : pigment.slice(1);
  const opacity = Number(alpha) / 100;
  const channels = (hex.match(/../gu) ?? []).map((channel) => Math.round(255 + (parseInt(channel, 16) - 255) * opacity));
  return `rgb(${channels.join(",")})`;
}

function textUnits(value: string) {
  return Array.from(value).reduce((units, character) => units + (/^[\x20-\x7e]$/u.test(character) ? 0.65 : 1), 0);
}

function label(value: string, point: Point, size: number, fill: string, options: {
  bold?: boolean; anchor?: "start" | "middle" | "end"; maxWidth?: number; mono?: boolean; halo?: boolean;
} = {}) {
  if (!value) return "";
  const fontSize = Math.min(size, (options.maxWidth ?? 940) / textUnits(value));
  const family = options.mono ? "monospace" : fontStack;
  const halo = options.halo ? ' stroke="white" stroke-width="3" stroke-linejoin="round" paint-order="stroke"' : "";
  return `<text x="${point.x}" y="${point.y}" dy=".35em" text-anchor="${options.anchor ?? "middle"}"
    font-family="${family}" font-size="${fontSize}" font-weight="${options.bold ? 700 : 400}" fill="${fill}"${halo}>${escapeHtml(value)}</text>`;
}

function center(node: Endpoint, scale: Scale): Point {
  return { x: (node.props.x + node.props.ox) * scale.x, y: (node.props.y + node.props.oy) * scale.y };
}

function boxMarkup(node: Box, scale: Scale) {
  const { props } = node;
  const { x, y } = center(node, scale);
  const w = props.w * scale.x;
  const h = props.h * scale.y;
  const small = props.h <= 40;
  const dimmed = props.opacity < 1;
  const highlighted = props.stroke === "accent";
  const outline = /^c[1-8]$/u.test(props.stroke) || props.stroke === "soft" ? border : paint(props.stroke);
  const main = dimmed ? dim.ink : small && highlighted ? red : paint(props.color);
  const size = small ? props.size : props.size * (4 / 3);
  const maxWidth = Math.max(1, w - 16);
  const dash = props.dashed ? ' stroke-dasharray="9 6"' : "";
  return `<g transform="translate(${x} ${y}) rotate(${props.rotate}) scale(${props.scale})">
    <rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${props.radius}" fill="${dimmed ? dim.fill : paint(props.fill)}"
      stroke="${outline}" stroke-width="${highlighted ? 3 : 2}"${dash}/>
    ${label(props.text, { x: 0, y: props.sub ? -14 : 0 }, size, main, { bold: true, maxWidth })}
    ${label(props.sub, { x: 0, y: 14 }, props.size, dimmed ? dim.sub : soft, { maxWidth })}
  </g>`;
}

function textMarkup(node: Text, scale: Scale) {
  const { props } = node;
  const { x, y } = center(node, scale);
  return `<g transform="translate(${x} ${y}) rotate(${props.rotate}) scale(${props.scale})" opacity="${props.opacity}">
    ${label(props.text, { x: 0, y: 0 }, props.size * 1.15, paint(props.color), {
      anchor: props.align, bold: Boolean(props.bold), mono: Boolean(props.mono),
    })}
  </g>`;
}

function edgeDistance(node: Endpoint, direction: Point, scale: Scale) {
  const angle = node.props.rotate * Math.PI / 180;
  const x = direction.x * Math.cos(angle) + direction.y * Math.sin(angle);
  const y = direction.y * Math.cos(angle) - direction.x * Math.sin(angle);
  return Math.min(node.props.w * scale.x / Math.abs(x), node.props.h * scale.y / Math.abs(y)) * node.props.scale / 2;
}

function mix(a: Point, b: Point, factor: number): Point {
  return { x: a.x + (b.x - a.x) * factor, y: a.y + (b.y - a.y) * factor };
}

function headMarkup(tip: Point, from: Point, color: string) {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const base = { x: tip.x - 11 * Math.cos(angle), y: tip.y - 11 * Math.sin(angle) };
  const dx = 5.5 * Math.sin(angle);
  const dy = 5.5 * Math.cos(angle);
  return `<polygon points="${tip.x},${tip.y} ${base.x + dx},${base.y - dy} ${base.x - dx},${base.y + dy}" fill="${color}"/>`;
}

function linkGeometry(link: Link, a: Endpoint, b: Endpoint, scale: Scale) {
  const from = center(a, scale);
  const to = center(b, scale);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!length) throw new Error("Scene link endpoints share a center.");
  const direction = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
  const normal = { x: -direction.y, y: direction.x };
  const start = mix(from, to, Math.min(0.45, (edgeDistance(a, direction, scale) + 3) / length));
  const end = mix(to, from, Math.min(0.45, (edgeDistance(b, direction, scale) + 3) / length));
  const control = mix(start, end, 0.5);
  control.x += normal.x * link.props.bend * scale.x;
  control.y += normal.y * link.props.bend * scale.x;
  const at = (t: number) => mix(mix(start, control, t), mix(control, end, t), t);
  const cut = mix(start, control, link.props.draw);
  const tip = at(link.props.draw);
  return { start, cut, tip, at, normal, vertical: Math.abs(direction.y) > Math.abs(direction.x) };
}

function linkMarkup(link: Link, geometry: ReturnType<typeof linkGeometry>, sent: PacketLabels | undefined) {
  const { props } = link;
  const { start, cut, tip, at, normal, vertical } = geometry;
  const stroke = sent !== undefined ? red : props.stroke === "soft" ? "#4A4A4A" : paint(props.stroke);
  const lineWidth = sent !== undefined ? 4 : Math.max(2, props.width);
  const dash = props.dashed ? ' stroke-dasharray="9 6"' : "";
  const endHead = props.head === "end" || props.head === "both" ? headMarkup(tip, cut, stroke) : "";
  const startHead = props.head === "start" || props.head === "both" ? headMarkup(start, cut, stroke) : "";
  const midpoint = at(props.draw / 2);
  const anchor = vertical ? "end" : "middle";
  const main = vertical ? { x: midpoint.x - 10, y: midpoint.y - 12 }
    : { x: midpoint.x - normal.x * 16, y: midpoint.y - normal.y * 16 };
  const tag = vertical ? { x: midpoint.x - 10, y: midpoint.y + 12 }
    : { x: midpoint.x + normal.x * 18, y: midpoint.y + normal.y * 18 };
  const packetText = sent ? [...sent.values()].filter(Boolean).join(" · ") : "";
  return {
    line: `<g opacity="${props.opacity}"><path d="M${start.x} ${start.y} Q${cut.x} ${cut.y} ${tip.x} ${tip.y}"
      fill="none" stroke="${stroke}" stroke-width="${lineWidth}"${dash}/>${startHead}${endHead}</g>`,
    labels: label(props.text, main, props.size * 1.15, paint(props.color), { anchor, maxWidth: 300, halo: true })
      + label(packetText, tag, props.size * 1.15, red, { anchor, bold: true, maxWidth: 300, halo: true }),
  };
}

function captionMarkup(value: string) {
  if (!value.trim()) return "";
  const maxWidth = 940;
  const chars = Array.from(value.trim().replace(/\s+/gu, " "));
  const size = Math.min(19, (maxWidth * 2 - 24) / textUnits(chars.join("")));
  if (size < 12) throw new Error("Scene caption exceeds the available space.");
  const lines = [""];
  let used = 0;
  for (const character of chars) {
    const units = textUnits(character);
    if (used + units > maxWidth / size) {
      lines.push("");
      used = 0;
    }
    lines[lines.length - 1] += character;
    used += units;
  }
  const centerY = titleHeight + canvasHeight + captionHeight / 2;
  return lines.map((line, index) =>
    label(line.trim(), { x: width / 2, y: centerY + (index - (lines.length - 1) / 2) * 26 }, size, red, { bold: true }),
  ).join("");
}

function frameSvg(scene: SceneData, frame: Frame) {
  const scale = { x: width / scene.width, y: canvasHeight / Math.max(canvasHeight, scene.height) };
  const nodes = new Map(frame.nodes.map((node) => [node.id, node]));
  const links = new Map<string, ReturnType<typeof linkGeometry>>();
  const lines: string[] = [];
  const boxes: string[] = [];
  const labels: string[] = [];
  for (const node of frame.nodes) {
    if (node.kind !== "link" || node.props.opacity === 0 || node.props.draw === 0) continue;
    const from = nodes.get(node.from);
    const to = nodes.get(node.to);
    if ((from?.kind !== "box" && from?.kind !== "text") || (to?.kind !== "box" && to?.kind !== "text")) {
      throw new Error("Scene link endpoints are missing.");
    }
    const geometry = linkGeometry(node, from, to, scale);
    links.set(node.id, geometry);
    const rendered = linkMarkup(node, geometry, frame.sent.get(node.id));
    lines.push(rendered.line);
    labels.push(rendered.labels);
  }
  for (const node of frame.nodes) {
    if (node.kind === "camera" || node.props.opacity === 0) continue;
    if (node.kind === "box") boxes.push(boxMarkup(node, scale));
    if (node.kind === "text") boxes.push(textMarkup(node, scale));
    if (node.kind === "packet") {
      const point = links.get(node.along)?.at(node.props.pos);
      const text = frame.sent.get(node.along)?.has(node.id) ? "" : node.props.text;
      if (point) labels.push(`<g opacity="${node.props.opacity}">
        <circle cx="${point.x}" cy="${point.y}" r="${node.props.r}" fill="${paint(node.props.fill)}"/>
        ${label(text, { x: point.x, y: point.y - node.props.r - 9 }, node.props.size, paint(node.props.color))}
      </g>`);
    }
  }
  const camera = frame.nodes.find((node) => node.kind === "camera")?.props;
  const initial = scene.nodes.find((node) => node.kind === "camera")?.props;
  const transform = camera && initial
    ? `translate(${initial.x * scale.x} ${initial.y * scale.y}) scale(${camera.zoom / initial.zoom})
      translate(${-camera.x * scale.x} ${-camera.y * scale.y})` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="white"/>
    ${label(scene.title, { x: 24, y: titleHeight / 2 }, 20, ink, { anchor: "start", bold: true })}
    <path d="M0 ${titleHeight - 1}H${width} M0 ${titleHeight + canvasHeight}H${width}" stroke="#E3E6EA"/>
    <defs><clipPath id="stage"><rect width="${width}" height="${canvasHeight}"/></clipPath></defs>
    <g transform="translate(0 ${titleHeight})" clip-path="url(#stage)">
      <g transform="${transform}">${lines.join("")}${boxes.join("")}${labels.join("")}</g>
    </g>
    ${captionMarkup(frame.caption)}
  </svg>`;
}

export function* sceneSvgFrames(scene: SceneData) {
  for (const frame of sceneFrames(scene)) {
    yield { svg: frameSvg(scene, frame), delay: frame.delay };
  }
}

async function encode(scene: SceneData, outputWidth: number, colors: number) {
  const gif = GIFEncoder();
  for (const { svg, delay } of sceneSvgFrames(scene)) {
    const raster = await renderAsync(svg, { ...fontOptions, fitTo: { mode: "width", value: outputWidth } });
    const pixels = raster.pixels;
    const palette = quantize(pixels, colors);
    gif.writeFrame(applyPalette(pixels, palette), raster.width, raster.height, { palette, delay, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

export async function sceneGif(scene: SceneData): Promise<Buffer> {
  if (scene.steps.length === 0) throw new Error("Scene has no animation steps.");
  let gif = await encode(scene, width, 256);
  if (gif.length > resizeThreshold) gif = await encode(scene, 800, 128);
  if (gif.length > maxGifBytes) throw new Error("Scene GIF exceeds the upload size limit.");
  return gif;
}
