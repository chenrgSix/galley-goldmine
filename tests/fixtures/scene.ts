import type { SceneData } from "../../src/importer/scene-source.js";

const box = {
  x: 190, y: 150, w: 220, h: 76, opacity: 1, ox: 0, oy: 0, rotate: 0, scale: 1, radius: 10,
  text: "问题", sub: "", size: 15, color: "ink", fill: "c2/14", stroke: "c2", dashed: 0,
};
export const scene: SceneData = {
  title: "查找资料", width: 800, height: 450,
  nodes: [
    { id: "question", kind: "box", props: box },
    { id: "answer", kind: "box", props: { ...box, x: 610, opacity: 0, text: "资料", stroke: "c3", fill: "c3/14" } },
    { id: "lookup", kind: "link", from: "question", to: "answer", props: {
      opacity: 0, draw: 0, bend: 0, width: 1.6, dashed: 1, text: "查询", size: 12, color: "soft", stroke: "soft", head: "end",
    } },
    { id: "result", kind: "packet", along: "lookup", props: {
      opacity: 0, pos: 0, r: 5, text: "订单记录", size: 11, fill: "accent", color: "ink",
    } },
  ],
  steps: [
    { caption: "向资料库发送问题。", changes: [
      { id: "answer", property: "opacity", value: 1 },
      { id: "lookup", property: "opacity", value: 1 },
      { id: "lookup", property: "draw", value: 1 },
      { id: "result", property: "pos", value: 1 },
      { id: "answer", property: "stroke", value: "accent" },
    ] },
    { caption: "拿到这笔订单的资料。", changes: [
      { id: "answer", property: "stroke", value: "c3" },
      { id: "answer", property: "text", value: "订单" },
      { id: "question", property: "opacity", value: 0.4 },
    ] },
  ],
};
