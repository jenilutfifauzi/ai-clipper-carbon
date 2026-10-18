// .scratch/text-advanced/issues/12-text-layer-keyframes.md: a Text Layer is keyed as an Overlay is
// (ADR 0008): the Keyframes pane, K and the ruler's diamonds work on it, the stage's Grips and its
// Transform fields write Keyframes at the playhead (auto-key), and splitting, trimming and moving it
// keep its motion on the same moments.
import { describe, expect, test } from "vitest";
import type { Keyframe, Keys, TextLayer } from "../../../api";
import { EASE_IN_OUT, EASE_OUT, LINEAR, PICTURE_KEYS, valueAt } from "../editor/keyframes";
import { playedFrom } from "../editor/playback";
import { IDENTITY } from "../editor/picture";
import { nudge, retimed, split, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import {
  activeKey,
  clearItemKeys,
  heldTransform,
  keyedInPick,
  keyedItem,
  keyRows,
  moveItemKeys,
  pickedKeyed,
  resetTextLayer,
  setItemKeys,
  toggleItemKey,
  writeItemTransform,
} from "./keying";
import { picked, type Pick } from "./pick";
import { textStyle } from "./textStyle";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

const title = (keys: Keys = {}, changes: Partial<TextLayer> = {}): TextLayer => ({
  id: "t",
  text: "Halo",
  start: 2,
  secs: 4,
  transform: { ...IDENTITY, x: 300, y: 500 },
  style: textStyle({ size: 80 }),
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
  keys,
  ...changes,
});

function edits(layers: TextLayer[]): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: layers,
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [{ id: "s", start: 0, end: 20 }],
    overlays: [],
    transitions: [],
  };
}

const T = { kind: "text", id: "t" } as const;
const scene = (state: AdvancedEdits, locked: "text"[] = []) => ({ edits: state, pick: picked(T), locked });

function pickContext(state: AdvancedEdits, pick: Pick): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

// A slide across and a fade, over its 4 s.
const slide = [key(0, 200), key(1, 880, EASE_OUT), key(4, 540, EASE_IN_OUT)];
const fade = [key(0.5, 1), key(3, 0.2)];

describe("a Text Layer picked alone", () => {
  test("is the item K, the ruler's diamonds and the Keyframes pane work on, with a row for each Transform field", () => {
    expect(pickedKeyed(picked(T))).toEqual(T);
    expect(keyRows(edits([title()]), T, new Map())).toEqual([...PICTURE_KEYS]);
    expect(activeKey(PICTURE_KEYS, {}, null)).toBe("scale");
    const item = keyedItem(edits([title({ x: slide })]), T)!;
    expect([item.start, item.secs, item.constant("x"), item.constant("y")]).toEqual([2, 4, 300, 500]);
    expect(item.keys).toEqual({ x: slide });
  });

  test("toggles a Keyframe at the playhead in its own seconds, with the value shown there", () => {
    const toggled = toggleItemKey(scene(edits([title()])), T, "y", 3.5);
    expect(toggled?.edits.text_layers[0].keys).toEqual({ y: [key(1.5, 500)] });
    // Not outside it, nor on a locked Track.
    expect(toggleItemKey(scene(edits([title()])), T, "y", 7)).toBeNull();
    expect(toggleItemKey(scene(edits([title()]), ["text"]), T, "y", 3.5)).toBeNull();
  });

  test("moved on the stage, its keyed fields write Keyframes at the playhead and the others change its constants (auto-key)", () => {
    const keyed = edits([title({ x: slide })]);
    const layer = keyed.text_layers[0];
    // Where its Grips hold it at 4 s (2 s in): its eased x there.
    const held = heldTransform(layer.transform, layer.keys, layer, 4);
    expect(held.x).toBeCloseTo(valueAt(slide, 2, 300), 0);
    const moved = writeItemTransform(scene(keyed), T, { ...held, x: 700, y: 900, scale: 2 }, 4, held);
    const [written] = moved!.edits.text_layers;
    expect(written.keys.x?.map(({ at, value }) => [at, value])).toEqual([[0, 200], [1, 880], [2, 700], [4, 540]]);
    expect(written.transform).toEqual({ ...layer.transform, y: 900, scale: 2 });
    // Unkeyed, it moves as it did.
    const plain = writeItemTransform(scene(edits([title()])), T, { ...IDENTITY, x: 700, y: 900 }, 4);
    expect(plain?.edits.text_layers[0]).toEqual(title({}, { transform: { ...IDENTITY, x: 700, y: 900 } }));
  });

  test("its diamond dragged on the ruler retimes every Keyframe at that instant (the Dopesheet's drag), as one change", () => {
    const keyed = edits([title({ x: slide, opacity: [key(1, 0.5)] })]);
    const moved = moveItemKeys(scene(keyed), T, 3, 4.5, 30);
    expect(moved?.at).toBe(4.5);
    expect(moved?.edits.text_layers[0].keys).toEqual({ x: [key(0, 200), key(2.5, 880, EASE_OUT), key(4, 540, EASE_IN_OUT)], opacity: [key(2.5, 0.5)] });
  });

  test("its Keyframes of one property are replaced, or all cleared with each constant left at the playhead", () => {
    const keyed = edits([title({ x: slide, opacity: fade })]);
    const eased = setItemKeys(scene(keyed), T, "opacity", [key(0.5, 1), key(3, 0.2, EASE_IN_OUT)]);
    expect(eased?.edits.text_layers[0].keys).toEqual({ x: slide, opacity: [key(0.5, 1), key(3, 0.2, EASE_IN_OUT)] });
    const cleared = clearItemKeys(scene(keyed), T, 3)!.edits.text_layers[0];
    expect(cleared.keys).toEqual({});
    expect(cleared.transform.x).toBeCloseTo(880, 3);
    expect(cleared.transform.opacity).toBeCloseTo(valueAt(fade, 1, 1), 3);
  });

  test("Reset leaves it unscaled, unturned and opaque where it is: its centre's Keyframes stay, the others go", () => {
    const keyed = title({ x: slide, scale: [key(0, 2)], opacity: fade }, { transform: { ...IDENTITY, x: 300, y: 500, rotation: 20 } });
    expect(resetTextLayer(keyed)).toEqual(title({ x: slide }, { transform: { ...IDENTITY, x: 300, y: 500 } }));
  });

  test("among several picked, says they have Keyframes", () => {
    const other = title({}, { id: "u" });
    expect(keyedInPick(edits([title(), other]), picked(T, { kind: "text", id: "u" }))).toBe(false);
    expect(keyedInPick(edits([title({ x: slide }), other]), picked(T, { kind: "text", id: "u" }))).toBe(true);
  });
});

describe("a keyed Text Layer on the Timeline and the frame", () => {
  // What `layer`'s property plays at Timeline `time`.
  const playedAt = (layer: TextLayer, property: keyof Keys, time: number) => valueAt(layer.keys[property] ?? [], time - layer.start, NaN);
  const times = (from: number, to: number) => Array.from({ length: 11 }, (_, i) => from + ((to - from) * i) / 10);

  test("split, its two pieces play the same values at the same moments as the whole", () => {
    const whole = title({ x: slide, opacity: fade });
    const [head, tail] = split(pickContext(edits([whole]), picked(T)), 4.5)!.edits.text_layers;
    for (const property of ["x", "opacity"] as const) {
      for (const time of times(2, 4.5)) expect(playedAt(head, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
      for (const time of times(4.5, 6)) expect(playedAt(tail, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
    }
    expect([head.start, head.secs, tail.start, tail.secs]).toEqual([2, 2.5, 4.5, 1.5]);
  });

  test("trimmed at its start, it keeps playing what it did at the moments it keeps", () => {
    const whole = title({ x: slide });
    const trimmed = retimed(whole, { ...whole, start: 3, secs: 3 }, "start");
    for (const time of times(3, 6)) expect(playedAt(trimmed, "x", time)).toBeCloseTo(playedAt(whole, "x", time), 3);
  });

  test("moved on the frame with others, its x and y Keyframes move with it", () => {
    const keyed = edits([title({ x: slide }), title({}, { id: "u" })]);
    const moved = nudge(pickContext(keyed, picked(T, { kind: "text", id: "u" })), 10, 0)!.edits.text_layers[0];
    expect(moved.keys.x?.map((each) => each.value)).toEqual([210, 890, 550]);
  });
});
