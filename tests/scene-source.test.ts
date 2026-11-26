import { load } from "cheerio";
import { describe, expect, it } from "vitest";
import { flightData } from "../src/importer/flight-data.js";
import { sceneSelector, sceneSources } from "../src/importer/scene-source.js";

const beat = "demo123";
const box = {
  x: 190, y: 150, w: 220, h: 76, opacity: 1, ox: 0, oy: 0, rotate: 0, scale: 1, radius: 10,
  text: "问题", sub: "", size: 15, color: "ink", fill: "c2/14", stroke: "c2", dashed: 0,
};
const props = {
  beat, title: "请求示意", ratio: "16:9", source: "$undefined",
  scene: {
    w: 800, h: 450,
    nodes: [
      { id: "b2", kind: "box", props: box },
      { id: "b3", kind: "box", props: { ...box, x: 610, text: "资料", opacity: 0 } },
    ],
    steps: [{
      duration: 520, text: "找到资料",
      tweens: [
        { id: "b3", prop: "sub", at: 520, dur: 0, to: "$$23" },
        { id: "b3", prop: "opacity", at: 0, dur: 416, from: 0, to: 1 },
      ],
    }],
  },
};

function figure(count = 1, target = "b2") {
  return `<figure class="galley-codesteps galley-scene">
    <header class="galley-codesteps-head">
      <span class="galley-codesteps-file">请求示意</span>
      <span class="galley-codesteps-count">0 / ${count}</span>
    </header>
    <div class="galley-scene-stage"><svg viewBox="0 0 800 450">
      <g data-galley-target="${beat}:${target}" data-guide-visible="true"></g>
    </svg></div>
  </figure>`;
}

function record(index: number, value: unknown, rowId = "29") {
  return rowId + ":" + JSON.stringify(["$", "$L54", `galley-scene-${index},${beat}`, value]);
}

function recover(figures: string, ...rows: string[]) {
  const wire = ['54:I[731007,["$1f"],"ScenePlayer"]', ...rows, ""].join("\n");
  const middle = Math.floor(wire.length / 2);
  const scripts = [wire.slice(0, middle), wire.slice(middle)]
    .map((chunk) => "<script>self.__next_f.push(" + JSON.stringify([1, chunk]) + ")</script>").join("");
  const $ = load(figures + scripts);
  return sceneSources(flightData($), $, $(sceneSelector));
}

describe("public scene source recovery", () => {
  it("decodes ScenePlayer records and orders the property changes from each step", () => {
    const scenes = recover(figure(), record(0, props));
    expect(scenes).toEqual([{
      title: "请求示意", width: 800, height: 450, nodes: props.scene.nodes,
      steps: [{
        caption: "找到资料",
        changes: [
          { id: "b3", property: "opacity", value: 1 },
          { id: "b3", property: "sub", value: "$23" },
        ],
      }],
    }]);
  });

  it("keeps verified figures aligned when another figure does not match its source", () => {
    const scenes = recover(figure(2) + figure(), record(0, props), record(1, props, "2d"));
    expect(scenes?.[0]).toBeNull();
    expect(scenes?.[1]?.title).toBe(props.title);
    expect(recover(figure(1, "b3"), record(0, props))).toBeUndefined();
  });

  it("rejects conflicting records and changes targeting an unsupported property", () => {
    const different = structuredClone(props);
    different.scene.steps[0]!.text = "另一条字幕";
    expect(recover(figure(), record(0, props), record(0, different, "2d"))).toBeUndefined();
    different.scene.steps[0]!.tweens[0]!.prop = "__proto__";
    expect(recover(figure(), record(0, different))).toBeUndefined();
  });
});
