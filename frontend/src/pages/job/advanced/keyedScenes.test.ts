// Seam D (.scratch/keyframes/issues/05-keyed-manual-scene.md): a Manual Scene's Keyframes, in
// seconds from its Scene's start on the Source's timeline (the plan's `keys_from`), set at the
// playhead's Source time minus that start, and never re-anchored by a trim or split.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Framing, Keyframe, LayoutOverride, RenderPlan, ScenePlan, SegmentPlan } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { LINEAR, PICTURE_KEYS, valueAt } from "../editor/keyframes";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { dragSegment, split, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { heldTransform, keyableOf, keyedInPick, keyedItem, manualSceneAt, pickedKeyed, sceneRef, toggleItemKey, withSceneTransform, writeItemKey, writeItemTransform } from "./keying";
import { picked } from "./pick";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });
const pan = [key(0, 300), key(4, 800)];
const framing: Framing = { transform: { ...IDENTITY, scale: 0.5 }, crop: NO_CROP, background: BLURRED };
// Framing by hand the shot from 12 s of the Source on: shown from 10 s to 20 s (cut at 12 s), then again from 14 s.
const override: LayoutOverride = { at: 15, layout: "manual", framing, keys: { x: pan } };
const whole: ClipSegment = { id: "a", start: 10, end: 20 };
const later: ClipSegment = { id: "b", start: 14, end: 18 };

const sceneOf = (start: number, end: number, keys_from: number | null): ScenePlan => ({
  start, end, layout: keys_from === null ? "track" : "manual", panels: [], picture: null, colour: null, framing, keys_from, ignored: {},
});
const segmentOf = (start: number, end: number, source_start: number, scenes: number): SegmentPlan =>
  ({ start, end, source_start, source_end: source_start + end - start, media: null, volume: 1, silent: false, scenes }) as SegmentPlan;
const plan = {
  start: 10,
  end: 20,
  segments: [segmentOf(0, 10, 10, 2), segmentOf(10, 14, 14, 1)],
  // Its Keyframes count from 2 s into the Clip, and in the later Segment from 8 s: 2 s before it.
  scenes: [sceneOf(0, 2, null), sceneOf(2, 10, 2), sceneOf(10, 14, 8)],
} as unknown as RenderPlan;

function edits(overrides: LayoutOverride[] = [override]): AdvancedEdits {
  return {
    hook_start: 0, hook_secs: 3, hook_text: "Hook", hook_kicker: "", preset_id: "default", style_overrides: { caption: {}, hook: {}, watermark: {} }, word_edits: [],
    layout: "auto", framing: null, layout_overrides: overrides, text_layers: [], shapes: [], music: [], source_volume: 1,
    segments: [whole, later], overlays: [], transitions: [],
  };
}

const FIRST = sceneRef(1);
const AGAIN = sceneRef(2);
const keying = (state = edits(), locked: ("video" | "text")[] = []) => ({ edits: state, pick: picked({ kind: "segment", id: "b" }), locked, plan });

describe("a Keyframe edit on a Manual Scene", () => {
  test("is in seconds from its Scene's start, wherever a Segment shows it from", () => {
    expect(keyedItem(edits(), FIRST, undefined, plan)).toMatchObject({ start: 2, first: 0, secs: 8, keys: { x: pan } });
    expect(keyedItem(edits(), AGAIN, undefined, plan)).toMatchObject({ start: 8, first: 2, secs: 6 });
    // 1 s into the later Segment is 15 s of the Source: 3 s into the shot.
    const toggled = toggleItemKey(keying(), AGAIN, "x", 11);
    expect(toggled?.edits.layout_overrides[0].keys?.x).toEqual([key(0, 300), key(3, valueAt(pan, 3, 0)), key(4, 800)]);
    // Before the later Segment shows it, the playhead isn't on it there.
    expect(toggleItemKey(keying(), AGAIN, "x", 9.5)).toBeNull();
    // An unkeyed field is its constant, set as such.
    expect(writeItemKey(keying(), FIRST, "scale", 0.8, 4)?.edits.layout_overrides[0]).toMatchObject({ keys: { x: pan }, framing: { transform: { scale: 0.8 } } });
  });

  test("a Segment of the Source picked is its Manual Scene under the playhead, for K, [ ], the ruler and the pane", () => {
    const pick = picked({ kind: "segment", id: "b" });
    expect(manualSceneAt(edits(), plan, "b", 11)).toBe(2);
    expect(manualSceneAt(edits(), plan, "a", 1)).toBeNull();
    expect(pickedKeyed(pick, 2)).toEqual(AGAIN);
    expect(pickedKeyed(pick)).toEqual({ kind: "segment", id: "b" });
  });

  test("the Candidate's own Manual Framing, a stale plan and a locked Video Track have none", () => {
    const clipManual = { ...edits([]), layout: "manual" as const, framing };
    expect(keyedItem(clipManual, FIRST, undefined, plan)).toBeNull();
    expect(keyedItem(edits(), FIRST)).toBeNull();
    expect(keyedItem(edits(), sceneRef(0), undefined, plan)).toBeNull();
    expect(toggleItemKey(keying(edits(), ["video"]), FIRST, "x", 4)).toBeNull();
    expect(keyableOf(FIRST)).toEqual(PICTURE_KEYS);
  });

  test("a Segment of the Source picked with others has Keyframes when one of its Manual Scenes has some", () => {
    const both = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" });
    expect(keyedInPick(edits(), both, plan)).toBe(true);
    expect(keyedInPick(edits(), picked({ kind: "segment", id: "a" }), plan)).toBe(true);
    expect(keyedInPick(edits([{ ...override, keys: {} }]), both, plan)).toBe(false);
    // Without the plan, its Scenes aren't known.
    expect(keyedInPick(edits(), both)).toBe(false);
  });

  test("its Grips hold it where it is at the playhead and write a keyed field there", () => {
    const item = keyedItem(edits(), AGAIN, undefined, plan)!;
    // 2 s into the later Segment: 4 s into the shot, where it has reached 800.
    expect(heldTransform(framing.transform, item.keys, item, 12).x).toBe(800);
    // Before it shows: held at where it first shows, 2 s in.
    expect(heldTransform(framing.transform, item.keys, item, 0).x).toBe(550);
    const moved = writeItemTransform(keying(), FIRST, { ...framing.transform, x: 100, scale: 2 }, 3)!.edits.layout_overrides[0];
    expect(moved.keys?.x).toEqual([key(0, 300), key(1, 100), key(4, 800)]);
    expect(moved.framing?.transform).toEqual({ ...framing.transform, scale: 2 });
    // The inspector's, for the editors' edits whatever they are.
    expect(withSceneTransform(edits(), plan, 1, { ...framing.transform, x: 100 }, 3)?.edits.layout_overrides[0].keys?.x).toEqual(moved.keys?.x);
  });
});

describe("a Manual Scene in a sped Segment", () => {
  // The same Clip with its first Segment at 2×: 10 s of the Source in 5 s, the shot from 1 s on.
  const sped = {
    ...plan,
    segments: [{ ...segmentOf(0, 5, 10, 2), source_end: 20, speed: 2 }, segmentOf(5, 9, 14, 1)],
    scenes: [sceneOf(0, 1, null), sceneOf(1, 5, 1), sceneOf(5, 9, 3)],
  } as unknown as RenderPlan;
  const state = () => ({ ...edits(), segments: [{ ...whole, speed: 2 }, later] });

  test("shows its Keyframes in Timeline seconds, at half their seconds of the shot, and writes them back at twice", () => {
    expect(keyedItem(state(), FIRST, undefined, sped)).toMatchObject({ start: 1, secs: 4, keys: { x: [key(0, 300), key(2, 800)] } });
    // 1 s into the shot on the Timeline is 2 s of it on the Source.
    const toggled = toggleItemKey({ edits: state(), pick: null, plan: sped }, FIRST, "x", 2);
    expect(toggled?.edits.layout_overrides[0].keys?.x).toEqual([key(0, 300), key(2, valueAt(pan, 2, 0)), key(4, 800)]);
    // Unsped, the later Segment shows it at its seconds on the Source.
    expect(keyedItem(state(), AGAIN, undefined, sped)).toMatchObject({ keys: { x: pan } });
  });
});

describe("trimming or splitting a Segment that shows a keyed Manual Scene", () => {
  test("leaves its Keyframes as they are: they follow the Source", () => {
    const state = edits();
    const played = playedFrom(state.segments);
    const context: PickContext = { edits: state, pick: picked({ kind: "segment", id: "a" }), played, duration: 14, gap: (time) => time, ids: () => "n1" };
    expect(split(context, 5)!.edits.layout_overrides).toEqual([override]);
    const origin = { edits: state, shown: played, planned: played };
    expect(dragSegment(context, origin, "a", { start: 1, end: 10, edge: "start" }, () => 20).edits.layout_overrides).toEqual([override]);
  });
});
