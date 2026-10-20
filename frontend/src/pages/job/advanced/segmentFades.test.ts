// .scratch/audio-mixing/issues/05-segment-fades-in-the-advanced-edit.md: a Segment's fades in the
// Advanced Edit, set by its Fade Ramps or the inspector (setFade), and kept sensible as it is split,
// trimmed, sped up or frozen; and how its Waveform and Volume Line hear them (segmentHeard).
import { describe, expect, test } from "vitest";
import type { ClipSegment, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { dragSegment, freezeFrame, setFade, setSpeed, split, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { gainAt, segmentHeard, sourceHeard, volumeLine } from "./timelineView";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, start, end, { media: "clip", framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });
const held = (id: string, at: number, hold: number): ClipSegment => segment(id, at, at, { hold });
const layer = (id: string, start: number, secs: number) => ({ id, start, secs, text: id }) as unknown as TextLayer;
const seg = (id: string) => ({ kind: "segment", id }) as const;

function edits(segments: ClipSegment[], changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
    cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [],
    shapes: [],
    music: [],
    source_volume: 1,
    segments,
    overlays: [],
    transitions: [],
    ...changes,
  };
}

// The scene of `state`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick = null, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

describe("setting a Segment's fades", () => {
  test("a fade dragged past 10 s stops at 10, and below 0 at 0, rounded to a hundredth; the Pick stays", () => {
    const before = edits([segment("s1", 100, 130), video("v", 0, 5)]);
    const pick = picked(seg("v"));

    expect(setFade(scene(before, pick), "s1", "fade_in", 12.5)).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 130, { fade_in: 10, fade_out: 0 }), video("v", 0, 5)] },
      pick,
    });
    expect(setFade(scene(before, pick), "s1", "fade_out", 3.456)?.edits.segments[0].fade_out).toBe(3.46);
    expect(setFade(scene(before, pick), "v", "fade_out", -1)?.edits.segments[1]).toEqual(video("v", 0, 5, { fade_in: 0, fade_out: 0 }));
  });

  test("a fade in that would cross the fade out is cut to what is left of the Segment on the Timeline, and the other way round", () => {
    // 10 s of the Source at 2×: 5 s on the Timeline, fading out over its last 2 s.
    const before = edits([segment("s1", 100, 110, { speed: 2, fade_in: 1, fade_out: 2 })]);

    expect(setFade(scene(before), "s1", "fade_in", 9)?.edits.segments).toEqual([segment("s1", 100, 110, { speed: 2, fade_in: 3, fade_out: 2 })]);
    expect(setFade(scene(before), "s1", "fade_out", 9)?.edits.segments).toEqual([segment("s1", 100, 110, { speed: 2, fade_in: 1, fade_out: 4 })]);
  });

  test("as long as its Timeline drawing says it is heard (`heard`, a Transition's overlap included), when given", () => {
    const before = edits([segment("s1", 100, 104, { fade_in: 1 })]);

    expect(setFade(scene(before), "s1", "fade_out", 4, 4.2)?.edits.segments[0]).toEqual(segment("s1", 100, 104, { fade_in: 1, fade_out: 3.2 }));
  });

  test("a Freeze frame, which is silent, has none, nor a Segment that isn't there", () => {
    const before = edits([segment("s1", 100, 104), held("f", 102, 1)]);

    expect(setFade(scene(before), "f", "fade_in", 0.5)).toBeNull();
    expect(setFade(scene(before), "gone", "fade_in", 0.5)).toBeNull();
  });
});

describe("a faded Segment", () => {
  test("split keeps its fade in on the head and its fade out on the tail only", () => {
    const before = edits([segment("s1", 100, 110, { fade_in: 2, fade_out: 3 })]);

    expect(split(scene(before, picked(seg("s1"))), 4)?.edits.segments).toEqual([
      segment("s1", 100, 104, { fade_in: 2, fade_out: 0 }),
      segment("n1", 104, 110, { fade_in: 0, fade_out: 3 }),
    ]);
    // Cut 1 s in, the head is too short for its 2 s fade in: it fades in over all of it.
    expect(split(scene(before, picked(seg("s1"))), 1)?.edits.segments).toEqual([
      segment("s1", 100, 101, { fade_in: 1, fade_out: 0 }),
      segment("n1", 101, 110, { fade_in: 0, fade_out: 3 }),
    ]);
  });

  test("split without fades stays without them", () => {
    const before = edits([segment("s1", 100, 110)]);

    expect(split(scene(before, picked(seg("s1"))), 4)?.edits.segments).toEqual([segment("s1", 100, 104), segment("n1", 104, 110)]);
  });

  test("trimmed shorter than its two fades, has them shortened by the same share; dragged back, has them back", () => {
    const before = edits([segment("s1", 100, 110), segment("s2", 200, 206, { fade_in: 3, fade_out: 1 })]);
    const context = scene(before);
    const origin = { edits: before, shown: context.played, planned: context.played };
    // s2's end, drawn at 16 s, dragged to 12 s: 2 s left for 4 s of fades.
    const trimmed = dragSegment(context, origin, "s2", { start: 10, end: 12, edge: "end" }, () => Infinity);
    expect(trimmed.edits.segments[1]).toEqual(segment("s2", 200, 202, { fade_in: 1.5, fade_out: 0.5 }));
    // The same drag on to 15 s, from where it began: room for both again.
    const back = dragSegment(scene(trimmed.edits), origin, "s2", { start: 10, end: 15, edge: "end" }, () => Infinity);
    expect(back.edits.segments[1]).toEqual(segment("s2", 200, 205, { fade_in: 3, fade_out: 1 }));
  });

  test("trimmed on the Magnetic timeline, refits them as it moves the layers", () => {
    const before = edits([segment("s1", 100, 110, { fade_in: 4, fade_out: 4 })], { text_layers: [layer("later", 9, 1)] });
    const context = { ...scene(before), magnetic: true };
    const origin = { edits: before, shown: context.played, planned: context.played };
    // Its start dragged 6 s later: 4 s left for 8 s of fades.
    const trimmed = dragSegment(context, origin, "s1", { start: 6, end: 10, edge: "start" }, () => Infinity).edits;
    expect(trimmed.segments).toEqual([segment("s1", 106, 110, { fade_in: 2, fade_out: 2 })]);
    expect(trimmed.text_layers).toEqual([layer("later", 3, 1)]);
  });

  test("sped up shorter than its fades, has them refitted to its new length", () => {
    const before = edits([segment("s1", 100, 104, { fade_in: 2, fade_out: 2 })]);

    expect(setSpeed(scene(before), seg("s1"), 2)?.edits.segments).toEqual([segment("s1", 100, 104, { speed: 2, fade_in: 1, fade_out: 1 })]);
  });

  test("frozen, keeps its fade in on the head and its fade out on the tail; the Freeze frame has none", () => {
    const before = edits([video("v", 0, 6, { fade_in: 1, fade_out: 2 })]);

    expect(freezeFrame(scene(before), 3)?.edits.segments).toEqual([
      video("v", 0, 3, { fade_in: 1, fade_out: 0 }),
      { id: "n2", start: 3, end: 3, hold: 1, media: "clip", volume: 1, framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED } },
      video("n1", 3, 6, { fade_in: 0, fade_out: 2 }),
    ]);
  });
});

describe("how a faded Segment is heard on the Timeline", () => {
  test("its Waveform and Volume Line go through its fades, fitted to its length", () => {
    // 4 s on the Timeline, with 3 s fades: fitted to 2 s and 2 s, as the plan fits them.
    const heard = segmentHeard({ volume: 0.5, fade_in: 3, fade_out: 3 }, { start: 10, end: 14 });
    expect(heard).toMatchObject({ volume: 0.5, secs: 4, fade_in: 2, fade_out: 2 });
    expect(gainAt(1, heard)).toBeCloseTo(0.25);
    expect(gainAt(2, heard)).toBeCloseTo(0.5);
    expect(gainAt(3.5, heard)).toBeCloseTo(0.125);
    expect(gainAt(4, heard)).toBe(0);
  });

  test("under the Transition into the next one, its fade out ends where it stops being heard, past what is drawn of it", () => {
    // Drawn from 10 to 13.5 s, heard on for 0.5 s under the Transition: 4 s, fading out over its last 2 s.
    const heard = segmentHeard({ fade_out: 2 }, { start: 10, end: 13.5 }, 0.5);
    expect(heard).toMatchObject({ secs: 3.5, tail: 0.5, fade_in: 0, fade_out: 2 });
    expect(gainAt(2, heard)).toBe(1);
    expect(gainAt(3, heard)).toBeCloseTo(0.5);
    // Its drawn end is a quarter up the ramp.
    expect(gainAt(3.5, heard)).toBeCloseTo(0.25);
    // Its Volume Line bends where the fade out begins, and is drawn to what is drawn of it.
    expect(volumeLine(heard).map((point) => point.time)).toContain(2);
    expect(volumeLine(heard).at(-1)?.time).toBe(3.5);
  });

  test("a Source Segment's is under the Clip's own sound, through its fades", () => {
    const heard = sourceHeard({ source_volume: 0.5 }, { fade_in: 1 }, { start: 0, end: 4 });
    expect(gainAt(0.5, heard)).toBeCloseTo(0.25);
    expect(gainAt(2, heard)).toBeCloseTo(0.5);
  });
});
