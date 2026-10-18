// .scratch/speed/issues/08-reverse-in-the-advanced-edit.md: Reverse in the Advanced Edit
// (docs/adr/0009): the switch and R, and a reversed Segment or Overlay trimmed, split, ripped, copied
// and drawn on the Timeline from its end.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Ease, Keyframe, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, valueAt } from "../editor/keyframes";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { segmentCopy, servedBy } from "../editor/retimedCopy";
import { segmentLength, sourceAt } from "../editor/segmentTime";
import { dragSegment, remove, reversible, setReverse, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { resolveShortcut, shortcutSheet } from "./keymap";
import { picked, type Pick } from "./pick";
import { chunksAcross, filmstripTiles } from "./timelineView";

const key = (at: number, value: number): Keyframe => ({ at, value, ease: LINEAR });

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, start, end, { media: "clip", framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });

const overlay = (id: string, start: number, secs: number, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "clip",
  start,
  secs,
  offset: 0,
  transform: IDENTITY,
  crop: NO_CROP,
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
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
    text_layers: [], shapes: [],
    music: [],
    source_volume: 1,
    segments: [segment("s1", 100, 110)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const three = (changes: Partial<AdvancedEdits> = {}) => edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210), segment("s3", 300, 310)], ...changes });
const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;
const videos = (media: string) => media === "clip";

describe("Reverse, by its switch or R", () => {
  test("turns on and off for one Segment or video Overlay, its range and place kept, its Keyframes mirrored", () => {
    const keyed = video("v", 2, 6, { keys: { scale: [key(1, 2)] } });
    const before = edits({ segments: [segment("s1", 100, 110), keyed], overlays: [overlay("o", 1, 2)] });
    const on = setReverse(scene(before), seg("v"), true)!.edits;
    expect(on.segments).toEqual([segment("s1", 100, 110), { ...keyed, reverse: true, keys: { scale: [key(3, 2)] } }]);
    expect(playedFrom(on.segments).at(-1)!.end).toBe(14);
    expect(setReverse(scene(on), seg("v"), false)!.edits.segments[1]).toEqual({ ...keyed, reverse: false });
    // Set again as it is, nothing moves.
    expect(setReverse(scene(on), seg("v"), true)!.edits.segments[1]).toEqual(on.segments[1]);
    expect(setReverse(scene(before), over("o"), true)!.edits.overlays).toEqual([overlay("o", 1, 2, { reverse: true })]);
    // An episode's Segment too; a Freeze frame holds one frame.
    expect(setReverse(scene(before), seg("s1"), true)!.edits.segments[0].reverse).toBe(true);
    const held = edits({ segments: [segment("s1", 100, 110), segment("f", 105, 105, { hold: 1 })] });
    expect(setReverse(scene(held), seg("f"), true)).toBeNull();
  });

  test("R acts on the one picked Segment or video Overlay, and on nothing with none or several picked", () => {
    const state = edits({
      segments: [segment("s1", 100, 110), segment("f", 105, 105, { hold: 1 })],
      overlays: [overlay("o", 0, 2), overlay("still", 0, 2, { media: "png" })],
    });
    const at = (pick: Pick) => reversible({ edits: state, pick }, videos);
    expect(at(picked(seg("s1")))).toEqual(seg("s1"));
    expect(at(picked(over("o")))).toEqual(over("o"));
    expect(at(null)).toBeNull();
    expect(at(picked(seg("s1"), over("o")))).toBeNull();
    expect(at(picked(seg("f")))).toBeNull();
    expect(at(picked(over("still")))).toBeNull();
    expect(at(picked({ kind: "text", id: "t" }))).toBeNull();

    expect(resolveShortcut({ key: "r" })).toBe("reverse");
    expect(resolveShortcut({ key: "R" })).toBe("reverse");
    expect(resolveShortcut({ key: "r" }, { typing: true })).toBeNull();
    const editing = shortcutSheet().find((group) => group.group === "editing")!;
    expect(editing.shortcuts.map((shortcut) => shortcut.id)).toContain("reverse");
  });
});

describe("Reverse mirrors Keyframes", () => {
  const custom: Ease = [0.2, 0.9, 0.6, 0.1];
  const keys = {
    x: [{ at: 0.5, value: 100, ease: LINEAR }, { at: 2, value: 300, ease: EASE_IN }, { at: 3.5, value: 200, ease: custom }],
    scale: [{ at: 0, value: 1, ease: EASE_OUT }, { at: 4, value: 2, ease: EASE_IN_OUT }],
    volume: [{ at: 1, value: 0, ease: LINEAR }, { at: 3, value: 1, ease: [0.1, 1.4, 0.3, -0.5] as Ease }],
  };
  const times = Array.from({ length: 81 }, (_, i) => i * 0.05);

  test("a 2× video's Segment: each value is the one it had on the same frame of the video", () => {
    const forwards = video("v", 2, 10, { speed: 2, keys });
    const on = setReverse(scene(edits({ segments: [forwards] })), seg("v"), true)!.edits.segments[0];
    const length = segmentLength(forwards);
    expect(length).toBe(4);
    for (const t of times) {
      // The same frame, shown `t` into the Segment forwards and `length − t` into it in Reverse.
      expect(sourceAt(on, length - t)).toBeCloseTo(sourceAt(forwards, t), 9);
      for (const [prop, list] of Object.entries(keys)) expect(valueAt(on.keys![prop as "x"]!, length - t, 0)).toBeCloseTo(valueAt(list, t, 0), 5);
    }
    // In time order, each span's Ease turned end for end on the Keyframe that now ends it.
    expect(on.keys!.x).toEqual([
      { at: 0.5, value: 200, ease: LINEAR },
      { at: 2, value: 300, ease: [0.4, 0.9, 0.8, 0.1] },
      { at: 3.5, value: 100, ease: EASE_OUT },
    ]);
    expect(on.keys!.scale).toEqual([{ at: 0, value: 2, ease: EASE_OUT }, { at: 4, value: 1, ease: EASE_IN_OUT }]);
    // Back forwards, the Keyframes as they were.
    expect(setReverse(scene(edits({ segments: [on] })), seg("v"), false)!.edits.segments[0].keys).toEqual(keys);
  });

  test("a video Overlay, over its length on the Timeline; turned on twice it moves once", () => {
    const forwards = overlay("o", 1, 4, { speed: 0.5, keys });
    const on = setReverse(scene(edits({ overlays: [forwards] })), over("o"), true)!.edits.overlays[0];
    for (const t of times) {
      for (const [prop, list] of Object.entries(keys)) expect(valueAt(on.keys[prop as "x"]!, 4 - t, 0)).toBeCloseTo(valueAt(list, t, 0), 5);
    }
    expect(setReverse(scene(edits({ overlays: [on] })), over("o"), true)!.edits.overlays[0]).toEqual(on);
    expect(setReverse(scene(edits({ overlays: [on] })), over("o"), false)!.edits.overlays[0]).toEqual({ ...forwards, reverse: false });
  });

  test("a Manual Scene's Keyframes stay: they follow the Source", () => {
    const manual = { at: 104, layout: "manual" as const, framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, keys: { x: [key(1, 10), key(3, 20)] } };
    const state = edits({ layout_overrides: [manual] });
    expect(setReverse(scene(state), seg("s1"), true)!.edits.layout_overrides).toBe(state.layout_overrides);
  });
});

describe("trimming a reversed Segment", () => {
  const trim = (state: AdvancedEdits, id: string, change: { start: number; end: number; edge: "start" | "end" }, longest?: number) => {
    const context = scene(state, null, { magnetic: true });
    return dragSegment(context, { edits: state, shown: context.played, planned: context.played }, id, change, () => 220, longest).edits;
  };
  // s2 plays 210 down to 200, at 2×, from 10 s to 15 s.
  const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210, { speed: 2, reverse: true })] });

  test("moves its range's end by its left edge, and its start by its right edge, times its Speed", () => {
    expect(trim(before, "s2", { start: 11, end: 15, edge: "start" }).segments[1]).toEqual(segment("s2", 200, 208, { speed: 2, reverse: true }));
    expect(trim(before, "s2", { start: 9, end: 15, edge: "start" }).segments[1]).toEqual(segment("s2", 200, 212, { speed: 2, reverse: true }));
    expect(trim(before, "s2", { start: 10, end: 14, edge: "end" }).segments[1]).toEqual(segment("s2", 202, 210, { speed: 2, reverse: true }));
    expect(trim(before, "s2", { start: 10, end: 16, edge: "end" }).segments[1]).toEqual(segment("s2", 198, 210, { speed: 2, reverse: true }));
  });

  test("keeps it 0.3 s long on the Timeline, within its file and the longest clip, and ripples as a trim", () => {
    expect(trim(before, "s2", { start: 15, end: 15, edge: "start" }).segments[1]).toEqual(segment("s2", 200, 200.6, { speed: 2, reverse: true }));
    expect(trim(before, "s2", { start: 0, end: 15, edge: "start" }).segments[1]).toEqual(segment("s2", 200, 220, { speed: 2, reverse: true }));
    expect(trim(before, "s2", { start: 10, end: 300, edge: "end" }, 60).segments[1]).toEqual(segment("s2", 150, 210, { speed: 2, reverse: true }));
    // Its right edge 1 s later: the layers after it on the Magnetic timeline 1 s later too.
    const layered = { ...before, text_layers: [{ id: "t", start: 16, secs: 1 }] as AdvancedEdits["text_layers"] };
    expect(trim(layered, "s2", { start: 10, end: 16, edge: "end" }).text_layers[0].start).toBe(17);
  });

  test("of a video, re-anchors its Keyframes from where its left edge now shows", () => {
    const keyed = edits({ segments: [video("v", 0, 10, { reverse: true, keys: { scale: [key(0, 1), key(4, 2)] } })] });
    // Its left edge 2 s in: it now starts at 8 s of its video, with its Keyframes 2 s earlier.
    const trimmed = trim(keyed, "v", { start: 2, end: 10, edge: "start" }).segments[0];
    expect(trimmed).toMatchObject({ start: 0, end: 8, reverse: true });
    expect(trimmed.keys).toEqual({ scale: [key(0, 1.5), key(2, 2)] });
  });
});

describe("splitting a reversed Segment", () => {
  test("gives the later part of its range first, both reversed, whose playback joined is the whole's, from the whole's copy", () => {
    const whole = video("v", 0, 10, { speed: 2, reverse: true, keys: { scale: [key(0, 1), key(4, 2)] } });
    const before = edits({ segments: [segment("s1", 100, 110), whole] });
    // 2 s into it on the Timeline: 6 s into its video.
    const [, first, second] = split(scene(before, picked(seg("v"))), 12)!.edits.segments;
    expect([first, second].map(({ start, end, speed, reverse }) => ({ start, end, speed, reverse }))).toEqual([
      { start: 6, end: 10, speed: 2, reverse: true },
      { start: 0, end: 6, speed: 2, reverse: true },
    ]);
    expect(segmentLength(first) + segmentLength(second)).toBe(segmentLength(whole));
    for (const t of [0, 1, 1.99, 2, 3.5, 4.99]) {
      const played = t < 2 ? sourceAt(first, t) : sourceAt(second, t - 2);
      expect(played).toBeCloseTo(sourceAt(whole, t));
    }
    expect(second.keys).toEqual({ scale: [key(0, 1.5), key(2, 2)] });

    // The whole's preview copy, made, serves both halves: no copy is asked for them.
    const [, ...plans] = playedFrom([segment("s1", 100, 110), whole, first, second]).map(
      (played) => ({ ...played, media: "clip", pitch: false }) as unknown as Parameters<typeof segmentCopy>[0],
    );
    const made = [{ ask: { media: "clip", range: segmentCopy(plans[0])! }, copy: { progress: 1, url: "/copy.mp4", at: 0, error: null } }];
    expect(made[0].ask.range).toEqual({ start: 0, end: 10, reverse: true });
    expect(servedBy({ media: "clip", range: segmentCopy(plans[1])! }, made)).toEqual({ progress: 1, url: "/copy.mp4", at: 0, error: null });
    // The second half shows 6..0, 4 s into the copy.
    expect(servedBy({ media: "clip", range: segmentCopy(plans[2])! }, made)?.at).toBe(4);
    // Another item's, or a range reaching outside it, isn't served.
    expect(servedBy({ media: "other", range: { start: 0, end: 6, reverse: true } }, made)).toBeUndefined();
    expect(servedBy({ media: "clip", range: { start: 0, end: 11, reverse: true } }, made)).toBeUndefined();
  });

  test("of the Source, cuts in the gap between Words, the first half from the cut to its end", () => {
    const before = edits({ segments: [segment("s1", 100, 110, { reverse: true })] });
    // 2.3 s in is 107.7 s of the Source; the nearest gap, here, the whole second.
    const outcome = split(scene(before, picked(seg("s1")), { gap: Math.round }), 2.3)!;
    expect(outcome.edits.segments).toEqual([segment("s1", 108, 110, { reverse: true }), segment("n1", 100, 108, { reverse: true })]);
  });
});

describe("a reversed Overlay", () => {
  // From 0 s for 4 s, 1..9 s of its video backwards at 2×: 9 s at its left edge, 1 s at its right.
  const reversed = overlay("o", 0, 4, { offset: 1, speed: 2, reverse: true });

  test("split, the first part shows the later part of its video, the second goes on to its offset", () => {
    const parts = split(scene(three({ overlays: [reversed] }), picked(over("o"))), 1)!.edits.overlays;
    expect(parts.map(({ start, secs, offset, reverse }) => ({ start, secs, offset, reverse }))).toEqual([
      { start: 0, secs: 1, offset: 7, reverse: true },
      { start: 1, secs: 3, offset: 1, reverse: true },
    ]);
  });

  test("cut by a ripple at its head keeps its offset; at its tail it ends later in its video", () => {
    // s1 removed on the Magnetic timeline, the Overlay from 8 s losing its first 2 s: 9..5 s of the video, cut.
    const head = remove(scene(three({ overlays: [overlay("o", 8, 4, { offset: 1, speed: 2, reverse: true })] }), picked(seg("s1")), { magnetic: true }))!;
    expect(head.edits.overlays[0]).toMatchObject({ start: 0, secs: 2, offset: 1 });
    // s2 removed: the Overlay from 8 s loses its last 2 s, 3..1 s of the video.
    const tail = remove(scene(three({ overlays: [overlay("o", 8, 4, { offset: 1, speed: 2, reverse: true })] }), picked(seg("s2")), { magnetic: true }))!;
    expect(tail.edits.overlays[0]).toMatchObject({ start: 8, secs: 2, offset: 5 });
  });

  test("pasted cut short at the Clip's end ends later in its video; the Clipboard carries Reverse", () => {
    const here = { job: "j", candidate: "one" };
    const from = three({ overlays: [reversed], segments: [video("v", 0, 4, { reverse: true, speed: 2 })] });
    const clipboard = copy(scene(from, picked(over("o"), seg("v"))), here)!;
    expect(clipboard.segments[0].segment.reverse).toBe(true);
    // Into a Clip of 3 s, at its start: the Segment (2 s) then the Overlay cut to the Clip's 5 s.
    const pasted = paste(scene(edits({ segments: [segment("s1", 100, 103)] })), clipboard, 0, here);
    expect(pasted.edits.segments[0]).toMatchObject({ start: 0, end: 4, reverse: true, speed: 2 });
    expect(pasted.edits.overlays[0]).toMatchObject({ start: 0, secs: 4, offset: 1, reverse: true });
    const short = paste(scene(edits({ segments: [segment("s1", 100, 103)] })), copy(scene(from, picked(over("o"))), here)!, 0, here);
    expect(short.edits.overlays[0]).toMatchObject({ start: 0, secs: 3, offset: 3, reverse: true });
  });
});

describe("a reversed Segment's Filmstrip and Waveform", () => {
  test("are counted from its end: its last frame at its left edge, mirrored", () => {
    const all = { left: 0, right: 300 };
    // 210 down to 200 at 2× over 5 s, at 60 px a second: tiles of 60 px are a second each, 2 s of the video.
    const tiles = filmstripTiles({ width: 300, mediaStart: 210, speed: 2, reverse: true, frames: 400, tile: 60, pps: 60, view: all, span: all });
    expect(tiles.map((tile) => tile.frame)).toEqual([209, 207, 205, 203, 201]);
    // 30 s of the Timeline at 10 px a second, backwards from 70 s: 70 down to 40 s, chunks 30 and 60.
    expect(chunksAcross({ mediaStart: 70, reverse: true, pps: 10, width: 300, span: all, duration: 600 })).toEqual([30, 60]);
    // Never before the media's start.
    expect(chunksAcross({ mediaStart: 10, reverse: true, pps: 10, width: 300, span: all, duration: 600 })).toEqual([0]);
  });
});
