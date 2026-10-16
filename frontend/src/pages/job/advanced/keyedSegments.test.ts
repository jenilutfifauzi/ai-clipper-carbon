// Seam D (.scratch/keyframes/issues/04-keyed-media-segment.md): a video Segment's Keyframes, in
// seconds from where it starts on the Timeline, re-anchored by its trims and splits, and edited at
// the playhead as an Overlay's are.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, Keys } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { EASE_IN_OUT, LINEAR, valueAt } from "../editor/keyframes";
import { IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { dragSegment, split, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { rewindow } from "./keyActions";
import { keyedInPick, keyedItem, resetFraming, segmentSpan, toggleItemKey, writeItemKey, writeItemTransform } from "./keying";
import { picked } from "./pick";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

// A push in over its 4 s, and a dip in its sound.
const push: Keyframe[] = [key(0, 1), key(3, 1.6, EASE_IN_OUT), key(4, 1.8)];
const dip: Keyframe[] = [key(1, 1), key(2, 0.3)];

const episode: ClipSegment = { id: "e", start: 100, end: 110 };
const video = (keys: Keys = { scale: push, volume: dip }): ClipSegment => ({
  id: "v",
  start: 2,
  end: 6,
  media: "broll",
  framing: { transform: { ...IDENTITY, x: 500 }, crop: NO_CROP, background: { kind: "blur", colour: "#000000" } },
  volume: 0.8,
  keys,
});

function edits(segments: ClipSegment[] = [episode, video()]): AdvancedEdits {
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
    music: [],
    source_volume: 1,
    segments,
    overlays: [],
    transitions: [],
  };
}

function scene(state: AdvancedEdits): PickContext {
  const played = playedFrom(state.segments);
  return { edits: state, pick: picked({ kind: "segment", id: "v" }), played, duration: played.at(-1)!.end, gap: (time) => time, ids: () => "n1" };
}

const V = { kind: "segment", id: "v" } as const;

describe("trimming a keyed video Segment on the Main Track", () => {
  const before = edits();
  const origin = { edits: before, shown: playedFrom(before.segments), planned: playedFrom(before.segments) };
  const length = () => 20;

  test("its start trimmed 1 s later: its Keyframes 1 s earlier, one added at 0 with the value there", () => {
    // It plays from 10 s on the Timeline: its start dragged to 11 s.
    const [, trimmed] = dragSegment(scene(before), origin, "v", { start: 11, end: 14, edge: "start" }, length).edits.segments;
    expect([trimmed.start, trimmed.end]).toEqual([3, 6]);
    expect(trimmed.keys).toEqual({ scale: rewindow(push, 1, 4), volume: rewindow(dip, 1, 4) });
    expect(trimmed.keys?.scale?.[0]).toEqual(key(0, valueAt(push, 1, 0)));
  });

  test("its end trimmed: one added at the end; lengthened, they stay; and a drag back out gets them back", () => {
    const [, shorter] = dragSegment(scene(before), origin, "v", { start: 10, end: 12.5, edge: "end" }, length).edits.segments;
    expect(shorter.keys).toEqual({ scale: rewindow(push, 0, 2.5), volume: dip });
    const [, longer] = dragSegment(scene(before), origin, "v", { start: 10, end: 15, edge: "end" }, length).edits.segments;
    expect(longer.keys).toEqual(video().keys);
    // Each step of the drag is made from the Segment as it began.
    const [, back] = dragSegment(scene(edits([episode, shorter])), origin, "v", { start: 10, end: 14, edge: "end" }, length).edits.segments;
    expect(back.keys).toEqual(video().keys);
  });
});

describe("splitting a keyed video Segment", () => {
  test("its two pieces play what the whole did at the same Timeline times, in seconds from where each starts", () => {
    const whole = video();
    const [, head, tail] = split(scene(edits()), 11.5)!.edits.segments;
    expect([head.start, head.end, tail.start, tail.end]).toEqual([2, 3.5, 3.5, 6]);
    const played = playedFrom([episode, head, tail]);
    for (let time = 10; time <= 14; time += 0.05) {
      const [piece, start] = time < 11.5 ? [head, played[1].start] : [tail, played[2].start];
      expect(valueAt(piece.keys!.scale!, time - start, NaN)).toBeCloseTo(valueAt(whole.keys!.scale!, time - 10, NaN), 3);
    }
  });
});

describe("a Keyframe edit on a video Segment", () => {
  test("is in its seconds from where it starts on the Timeline, as planned", () => {
    const state = edits();
    expect(segmentSpan(state.segments, "v")).toEqual({ start: 10, secs: 4 });
    // A Transition into it starts it earlier: the plan has it.
    const track = [{ start: 0, end: 10, source_start: 100, source_end: 110 }, { start: 9.5, end: 13.5, source_start: 2, source_end: 6 }];
    expect(keyedItem(state, V, track)).toMatchObject({ start: 9.5, secs: 4 });
    const toggled = toggleItemKey({ edits: state, pick: picked(V), track }, V, "x", 10.5);
    expect(toggled?.edits.segments[1].keys?.x).toEqual([key(1, 500)]);
    // Its sound, at the playhead.
    const written = writeItemKey({ edits: state, pick: picked(V) }, V, "volume", 1.5, 11.5);
    expect(written?.edits.segments[1].keys?.volume).toEqual([...dip.slice(0, 1), key(1.5, 1.5), ...dip.slice(1)]);
  });

  test("its Volume Line drag sets its volume, and once its sound is keyed writes a Keyframe at the playhead", () => {
    const unkeyed = edits([episode, video({ scale: push })]);
    const set = writeItemKey({ edits: unkeyed, pick: picked(V) }, V, "volume", 0.5, 12);
    expect(set?.edits.segments[1]).toMatchObject({ volume: 0.5, keys: { scale: push } });
    // Keyed: a Keyframe at the playhead, from where a Transition into it starts it, and none outside it.
    const track = [{ start: 0, end: 10, source_start: 100, source_end: 110 }, { start: 9.5, end: 13.5, source_start: 2, source_end: 6 }];
    const written = writeItemKey({ edits: edits(), pick: picked(V), track }, V, "volume", 0.6, 12);
    expect(written?.edits.segments[1]).toMatchObject({ volume: 0.8, keys: { volume: [key(1, 1), key(2, 0.3), key(2.5, 0.6)] } });
    expect(writeItemKey({ edits: edits(), pick: picked(V), track }, V, "volume", 0.6, 14)).toBeNull();
  });

  test("a Segment of the episode has none, and a locked Video Track refuses them", () => {
    expect(keyedItem(edits(), { kind: "segment", id: "e" })).toBeNull();
    expect(toggleItemKey({ edits: edits(), pick: picked(V), locked: ["video"] }, V, "x", 11)).toBeNull();
  });

  test("its Grips write a keyed field at the playhead and set an unkeyed one's constant", () => {
    const state = edits();
    const moved = writeItemTransform({ edits: state, pick: picked(V) }, V, { ...IDENTITY, x: 300, scale: 2 }, 12)!.edits.segments[1];
    expect(moved.framing?.transform.x).toBe(300);
    expect(moved.framing?.transform.scale).toBe(1);
    expect(moved.keys?.scale).toContainEqual({ ...key(2, 2), ease: expect.any(Array) });
  });

  test("picked with others, it is one with Keyframes", () => {
    expect(keyedInPick(edits(), picked(V, { kind: "segment", id: "e" }))).toBe(true);
    expect(keyedInPick(edits([episode, video({})]), picked(V, { kind: "segment", id: "e" }))).toBe(false);
  });

  test("Reset of its Transform drops the Transform's Keyframes and keeps its sound's", () => {
    expect(resetFraming(video(), IDENTITY).keys).toEqual({ volume: dip });
  });
});
