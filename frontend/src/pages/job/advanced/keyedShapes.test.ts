// .scratch/shapes/issues/07-shape-motion.md: a Shape is keyed as a Text Layer is (ADR 0008): the
// Keyframes pane, K and the ruler's diamonds work on it, the stage's Grips write Keyframes at the
// playhead (auto-key), and splitting, trimming, moving and the Clipboard keep its motion on the same
// moments. It comes on and goes off with the Text Layer's animations, set in its inspector.
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Animation, Keyframe, Keys, Shape } from "../../../api";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { EASE_IN_OUT, EASE_OUT, LINEAR, PICTURE_KEYS, valueAt } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { nudge, retimed, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
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
  toggleItemKey,
  writeItemTransform,
} from "./keying";
import { picked, type Pick } from "./pick";
import { ShapeFields } from "./Shapes";
import { newShapeStyle } from "./shapeStyle";
import { MotionFields } from "./TextLayers";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

// A white 400×400 rectangle from 2 s for 4 s, keyed by `keys`.
const plate = (keys: Keys = {}, changes: Partial<Shape> = {}): Shape => ({
  id: "r",
  start: 2,
  secs: 4,
  transform: { ...IDENTITY, x: 300, y: 500 },
  style: newShapeStyle("rectangle"),
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
  keys,
  ...changes,
});

function edits(shapes: Shape[]): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes,
    music: [],
    source_volume: 1,
    segments: [{ id: "s", start: 0, end: 20 }],
    overlays: [],
    transitions: [],
  };
}

const R = { kind: "shape", id: "r" } as const;
const scene = (state: AdvancedEdits, locked: "shape"[] = []) => ({ edits: state, pick: picked(R), locked });

function pickContext(state: AdvancedEdits, pick: Pick): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

// A slide across and a fade, over its 4 s.
const slide = [key(0, 200), key(1, 880, EASE_OUT), key(4, 540, EASE_IN_OUT)];
const fade = [key(0.5, 1), key(3, 0.2)];

describe("a Shape picked alone", () => {
  test("is the item K, the ruler's diamonds and the Keyframes pane work on, with a row for each Transform field", () => {
    expect(pickedKeyed(picked(R))).toEqual(R);
    // Its position, scale, rotation and opacity: no colour nor size.
    expect(keyRows(edits([plate()]), R, new Map())).toEqual([...PICTURE_KEYS]);
    expect(activeKey(PICTURE_KEYS, {}, null)).toBe("scale");
    const item = keyedItem(edits([plate({ x: slide })]), R)!;
    expect([item.start, item.secs, item.constant("x"), item.constant("y")]).toEqual([2, 4, 300, 500]);
    expect(item.keys).toEqual({ x: slide });
  });

  test("toggles a Keyframe at the playhead in its own seconds, with the value shown there", () => {
    const toggled = toggleItemKey(scene(edits([plate()])), R, "opacity", 3.5);
    expect(toggled?.edits.shapes[0].keys).toEqual({ opacity: [key(1.5, 1)] });
    // Not outside it, nor on a locked Shape Track.
    expect(toggleItemKey(scene(edits([plate()])), R, "opacity", 7)).toBeNull();
    expect(toggleItemKey(scene(edits([plate()]), ["shape"]), R, "opacity", 3.5)).toBeNull();
  });

  test("keyed, its corner and rotate Grips write Keyframes at the playhead and its centre's constants change (auto-key)", () => {
    const keyed = edits([plate({ scale: [key(0, 1), key(4, 2)], rotation: [key(0, 0)] })]);
    const shape = keyed.shapes[0];
    // Where its Grips hold it at 4 s (2 s in): half way to twice its size.
    const held = heldTransform(shape.transform, shape.keys, shape, 4);
    expect(held.scale).toBeCloseTo(1.5, 3);
    const gripped = writeItemTransform(scene(keyed), R, { ...held, scale: 3, rotation: 45, x: 700 }, 4, held);
    const [written] = gripped!.edits.shapes;
    expect(written.keys.scale?.map(({ at, value }) => [at, value])).toEqual([[0, 1], [2, 3], [4, 2]]);
    expect(written.keys.rotation?.map(({ at, value }) => [at, value])).toEqual([[0, 0], [2, 45]]);
    expect(written.transform).toEqual({ ...shape.transform, x: 700 });
    // Unkeyed, the Grips change its Transform.
    const plain = writeItemTransform(scene(edits([plate()])), R, { ...IDENTITY, x: 300, y: 500, scale: 3 }, 4);
    expect(plain?.edits.shapes[0]).toEqual(plate({}, { transform: { ...IDENTITY, x: 300, y: 500, scale: 3 } }));
  });

  test("its diamond dragged on the ruler retimes every Keyframe at that instant, as one change", () => {
    const keyed = edits([plate({ x: slide, opacity: [key(1, 0.5)] })]);
    const moved = moveItemKeys(scene(keyed), R, 3, 4.5, 30);
    expect(moved?.at).toBe(4.5);
    expect(moved?.edits.shapes[0].keys).toEqual({ x: [key(0, 200), key(2.5, 880, EASE_OUT), key(4, 540, EASE_IN_OUT)], opacity: [key(2.5, 0.5)] });
  });

  test("Clear all leaves each constant at its value at the playhead; Reset its scale, turn and opacity's Keyframes", () => {
    const keyed = edits([plate({ x: slide, opacity: fade })]);
    const cleared = clearItemKeys(scene(keyed), R, 3)!.edits.shapes[0];
    expect(cleared.keys).toEqual({});
    expect(cleared.transform.x).toBeCloseTo(880, 3);
    expect(cleared.transform.opacity).toBeCloseTo(valueAt(fade, 1, 1), 3);
    expect(resetTextLayer(plate({ x: slide, opacity: fade }))).toEqual(plate({ x: slide }));
  });

  test("among several picked, says they have Keyframes", () => {
    const other = plate({}, { id: "q" });
    expect(keyedInPick(edits([plate(), other]), picked(R, { kind: "shape", id: "q" }))).toBe(false);
    expect(keyedInPick(edits([plate({ x: slide }), other]), picked(R, { kind: "shape", id: "q" }))).toBe(true);
  });
});

describe("a keyed Shape on the Timeline and the frame", () => {
  // What `shape`'s property plays at Timeline `time`.
  const playedAt = (shape: Shape, property: keyof Keys, time: number) => valueAt(shape.keys[property] ?? [], time - shape.start, NaN);
  const times = (from: number, to: number) => Array.from({ length: 11 }, (_, i) => from + ((to - from) * i) / 10);

  test("split, its two pieces play the same values at the same moments as the whole", () => {
    const whole = plate({ x: slide, opacity: fade });
    const [head, tail] = split(pickContext(edits([whole]), picked(R)), 4.5)!.edits.shapes;
    for (const property of ["x", "opacity"] as const) {
      for (const time of times(2, 4.5)) expect(playedAt(head, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
      for (const time of times(4.5, 6)) expect(playedAt(tail, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
    }
    expect([head.start, head.secs, tail.start, tail.secs]).toEqual([2, 2.5, 4.5, 1.5]);
  });

  test("trimmed at its start, it keeps playing what it did at the moments it keeps", () => {
    const whole = plate({ x: slide });
    const trimmed = retimed(whole, { ...whole, start: 3, secs: 3 }, "start");
    for (const time of times(3, 6)) expect(playedAt(trimmed, "x", time)).toBeCloseTo(playedAt(whole, "x", time), 3);
  });

  test("copied and pasted, its motion comes with it, from its new start", () => {
    const whole = plate({ x: slide, opacity: fade });
    const from = { job: "j", candidate: "c" };
    const clipboard = copy(pickContext(edits([whole]), picked(R)), from)!;
    const [, pasted] = paste(pickContext(edits([whole]), null), clipboard, 10, from).edits.shapes;
    expect([pasted.start, pasted.secs, pasted.keys]).toEqual([10, 4, whole.keys]);
    // Pasted near the Clip's end, cut short there with the Keyframes of what it keeps.
    const [, short] = paste(pickContext(edits([whole]), null), clipboard, 18, from).edits.shapes;
    for (const time of times(18, 20)) expect(playedAt(short, "x", time)).toBeCloseTo(playedAt(pasted, "x", time - 8), 3);
  });

  test("moved on the frame with others, its x and y Keyframes move with it", () => {
    const keyed = edits([plate({ x: slide }), plate({}, { id: "q" })]);
    const moved = nudge(pickContext(keyed, picked(R, { kind: "shape", id: "q" })), 10, 0)!.edits.shapes[0];
    expect(moved.keys.x?.map((each) => each.value)).toEqual([210, 890, 550]);
  });
});

// The first element of `node`'s tree (its own elements, not those its components render) of `type` labelled `label`.
function found(node: ReactNode, type: unknown, label: string): ReactElement<{ onChange: (value: never) => void }> | null {
  if (!isValidElement(node)) return Array.isArray(node) ? (node.map((each) => found(each, type, label)).find(Boolean) ?? null) : null;
  const props = node.props as { label?: string; children?: ReactNode };
  if (node.type === type && props.label === label) return node as ReactElement<{ onChange: (value: never) => void }>;
  return found(props.children, type, label);
}

describe("a Shape's in and out animations", () => {
  test("are the Text Layer's Motion fields in its inspector", () => {
    const markup = (changes: Partial<Shape>) =>
      renderToStaticMarkup(createElement(ShapeFields, { shape: plate({}, changes), duration: 10, onChange: () => {}, onDuplicate: () => {}, onDelete: () => {} }));
    for (const label of ["Motion", "Comes on", "Goes off"]) expect(markup({})).toContain(label);
    // Their length is set once one of them animates.
    expect(markup({})).not.toContain("Animation length");
    expect(markup({ animation_out: "pop", animation_ms: 500 })).toContain("0.50 s");
  });

  test("each change is stored on the Shape as a step of its own field", () => {
    const changed: [Shape, string][] = [];
    const fields = MotionFields({ item: plate({}, { animation_in: "fade" }), kind: "shape", onChange: (shape, group) => changed.push([shape, group]) });
    found(fields, Select, "Comes on")!.props.onChange("pop" satisfies Animation as never);
    found(fields, Select, "Goes off")!.props.onChange("slide" satisfies Animation as never);
    found(fields, Slider, "Animation length")!.props.onChange(600 as never);
    expect(changed).toEqual([
      [plate({}, { animation_in: "pop" }), "shape:r:animation_in"],
      [plate({}, { animation_in: "fade", animation_out: "slide" }), "shape:r:animation_out"],
      [plate({}, { animation_in: "fade", animation_ms: 600 }), "shape:r:animation_ms"],
    ]);
  });
});
