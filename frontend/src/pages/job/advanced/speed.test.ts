// .scratch/speed/issues/05-speed-section-desktop.md: a Segment's or video Overlay's Speed in the
// Advanced Edit (docs/adr/0009): set as a trim of its end, its Keyframes scaled, and trims, splits,
// the Clipboard and the Filmstrip of a sped item read through the mapping.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, Overlay, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { LINEAR } from "../editor/keyframes";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { segmentLength, sourceAt } from "../editor/segmentTime";
import { dragSegment, gestureSpeed, remove, setSpeed, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { cutNote, speedAtOctave, speedLabel, speedOf } from "./speed";
import { chunksAcross, filmstripTiles } from "./timelineView";

const key = (at: number, value: number): Keyframe => ({ at, value, ease: LINEAR });

// A Segment of the Source from `start` to `end` seconds; one of a video, framed and keyed.
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, start, end, { media: "clip", framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });

const layer = (id: string, start: number, secs: number) => ({ id, start, secs, text: id }) as unknown as TextLayer;

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

// The scene of `state` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick = null, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const three = (changes: Partial<AdvancedEdits> = {}) => edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210), segment("s3", 300, 310)], ...changes });
const seg = (id: string) => ({ kind: "segment", id }) as const;

describe("a Speed", () => {
  test("is within 0.0625–16×, to three figures, shown as its badge", () => {
    expect([speedOf(0.01), speedOf(20), speedOf(1.23456), speedOf(0.0625)]).toEqual([0.0625, 16, 1.23, 0.0625]);
    expect([speedLabel(2), speedLabel(0.25), speedLabel(1.5)]).toEqual(["2×", "0.25×", "1.5×"]);
    // The slider runs over octaves.
    expect([speedAtOctave(-4), speedAtOctave(0), speedAtOctave(1), speedAtOctave(4)]).toEqual([0.0625, 1, 2, 16]);
  });

  test("the clip editor's note says how a one-Segment Clip plays: its Speed, its Reverse or both", () => {
    expect(cutNote([segment("s", 0, 10, { speed: 2 })])).toBe("This clip plays at a Speed of 2×");
    expect(cutNote([segment("s", 0, 10, { reverse: true })])).toBe("This clip plays in Reverse");
    expect(cutNote([segment("s", 0, 10, { speed: 1, reverse: true, pitch: true })])).toBe("This clip plays in Reverse");
    expect(cutNote([segment("s", 0, 10, { speed: 0.5, reverse: true })])).toBe("This clip plays in Reverse at a Speed of 0.5×");
    expect(cutNote([segment("s", 4, 4, { hold: 1 })])).toBe("This clip is a Freeze frame");
    expect(cutNote([video("v", 0, 4)])).toBe("This clip plays a video from the Media Library");
    expect(cutNote([segment("a", 0, 2), segment("b", 5, 8)])).toBe("This clip is cut into 2 Segments");
  });
});

describe("setting a Segment's Speed", () => {
  test("keeps its range and closes up the Main Track; the layers after it follow on the Magnetic timeline", () => {
    const before = three({ text_layers: [layer("later", 25, 2)] });

    const on = setSpeed(scene(before, null, { magnetic: true }), seg("s2"), 2)!;
    expect(on.edits.segments[1]).toEqual(segment("s2", 200, 210, { speed: 2 }));
    // 10 s of the Source in 5 s: the Main Track is 25 s, and the Text Layer 5 s earlier.
    expect(playedFrom(on.edits.segments).at(-1)!.end).toBe(25);
    expect(on.edits.text_layers).toEqual([layer("later", 20, 2)]);
    // Off, the layers stay.
    expect(setSpeed(scene(before), seg("s2"), 2)!.edits.text_layers).toEqual(before.text_layers);
    // Slower, the Main Track opens out and they play later.
    expect(setSpeed(scene(before, null, { magnetic: true }), seg("s2"), 0.5)!.edits.text_layers).toEqual([layer("later", 35, 2)]);
  });

  test("scales a video's Keyframes by the old Speed over the new, on the same frames", () => {
    const before = edits({ segments: [video("v", 0, 10, { keys: { scale: [key(2, 1.5), key(8, 1)] } })] });

    const sped = setSpeed(scene(before), seg("v"), 2)!.edits.segments[0];
    expect(sped.keys).toEqual({ scale: [key(1, 1.5), key(4, 1)] });
    // The picture at that moment is the same frame of the video.
    expect(sourceAt(sped, 1)).toBe(sourceAt(before.segments[0], 2));
  });

  test("is refused past the longest clip, or for a video's Segment under 0.1 s, with the owner told", () => {
    const before = three();
    // s2 at 0.25× plays 40 s: 60 s in all.
    expect(setSpeed(scene(before), seg("s2"), 0.25, { longest: 60 })!.notice).toBeUndefined();
    const slow = setSpeed(scene(before), seg("s2"), 0.25, { longest: 50 })!;
    expect(slow).toEqual({ edits: before, pick: null, notice: "A clip can last at most 50 s: at 0.25× this one would last 60 s." });
    const short = edits({ segments: [segment("s1", 100, 110), video("v", 0, 1)] });
    expect(setSpeed(scene(short), seg("v"), 16)).toEqual({
      edits: short,
      pick: null,
      notice: "A video's Segment lasts 0.1 s at least: at 16× this one would last 0.06 s.",
    });
  });

  test("leaves a Freeze frame as it is", () => {
    expect(setSpeed(scene(edits({ segments: [segment("s1", 100, 110), video("f", 3, 3, { hold: 1 })] })), seg("f"), 2)).toBeNull();
  });

  test("an Overlay keeps its start and shows as much of its video, its end kept within the video", () => {
    const keyed = overlay("o", 4, 4, { offset: 1, keys: { x: [key(0, 100), key(4, 900)] } });
    const before = three({ overlays: [keyed], text_layers: [layer("later", 25, 2)] });

    const sped = setSpeed(scene(before, null, { magnetic: true }), { kind: "overlay", id: "o" }, 2, { video: 10 })!.edits;
    expect(sped.overlays).toEqual([{ ...keyed, speed: 2, secs: 2, keys: { x: [key(0, 100), key(2, 900)] } }]);
    // Nothing else moves.
    expect(sped.text_layers).toEqual(before.text_layers);
    // Its end is kept within its video: from 1 s of a 10 s one, 4.5 s at most at 2×.
    const long = overlay("o", 0, 12, { offset: 1 });
    expect(setSpeed(scene(three({ overlays: [long] })), { kind: "overlay", id: "o" }, 2, { video: 10 })!.edits.overlays[0].secs).toBe(4.5);
  });
});

describe("a Speed's gesture, one step of undo", () => {
  test("each step is made from the edits as it began, so that sliding back brings back what a step cut", () => {
    // A Text Layer at 18 s, in the second half of v (10 s to 20 s): faster, v ends before it.
    const crowded = video("v", 0, 10, { keys: { x: [key(0, 0), key(1 / 30, 10), key(2 / 30, 20)] } });
    const before = edits({ segments: [segment("s1", 100, 110), crowded, segment("s3", 300, 310)], text_layers: [layer("inside", 18, 1)] });
    const sped = gestureSpeed();
    const group = "segment:v:speed";

    const fast = sped(scene(before, null, { magnetic: true }), seg("v"), 4, group)!;
    expect(fast.edits.text_layers).toEqual([]);
    expect(fast.notice).toBe("1 Text Layer inside the cut was removed.");
    // Four times as fast, its Keyframes would be closer than a frame: those crowding are dropped.
    expect(fast.edits.segments[1].keys).toEqual({ x: [key(0, 0)] });

    // The Speed, the Keyframes and the rippled layers come back together.
    const back = sped(scene(fast.edits, null, { magnetic: true }), seg("v"), 1, group)!;
    expect(back.edits).toEqual({ ...before, segments: before.segments.map((s) => (s.id === "v" ? { ...s, speed: 1 } : s)) });
  });

  test("a refused step leaves the edits as they are; edits changed since begin it again", () => {
    const before = three();
    const sped = gestureSpeed();
    const first = sped(scene(before), seg("s2"), 2, "g")!;
    const refused = sped(scene(first.edits), seg("s2"), 0.0625, "g", { longest: 100 })!;
    expect(refused.edits).toBe(first.edits);
    expect(refused.notice).toMatch(/at most 100 s/);
    // Undone (the edits as before), the next step starts from them.
    expect(sped(scene(before), seg("s1"), 2, "g")!.edits.segments.map((s) => s.speed)).toEqual([2, undefined, undefined]);
  });
});

describe("trimming a sped Segment", () => {
  const trim = (state: AdvancedEdits, id: string, change: { start: number; end: number; edge: "start" | "end" }, longest?: number) => {
    const context = scene(state);
    return dragSegment(context, { edits: state, shown: context.played, planned: context.played }, id, change, () => Infinity, longest).edits.segments;
  };
  // s2 at 2× plays 200–210 from 10 s to 15 s.
  const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210, { speed: 2 })] });

  test("moves its range's edge by the drag's seconds times its Speed", () => {
    expect(trim(before, "s2", { start: 10, end: 16, edge: "end" })[1]).toEqual(segment("s2", 200, 212, { speed: 2 }));
    expect(trim(before, "s2", { start: 11, end: 15, edge: "start" })[1]).toEqual(segment("s2", 202, 210, { speed: 2 }));
  });

  test("keeps it 0.3 s long on the Timeline, and a range of the Source within the longest clip", () => {
    // 0.3 s at 2× is 0.6 s of the Source.
    expect(trim(before, "s2", { start: 15, end: 15, edge: "start" })[1]).toEqual(segment("s2", 209.4, 210, { speed: 2 }));
    expect(trim(before, "s2", { start: 10, end: 300, edge: "end" }, 180)[1]).toEqual(segment("s2", 200, 380, { speed: 2 }));
    expect(trim(before, "s2", { start: -200, end: 15, edge: "start" }, 60)[1]).toEqual(segment("s2", 150, 210, { speed: 2 }));
  });
});

describe("splitting a sped item", () => {
  test("gives two halves at its Speed, whose playback joined is the whole's, their Keyframes re-anchored", () => {
    const whole = video("v", 0, 10, { speed: 2, pitch: true, keys: { scale: [key(0, 1), key(4, 2)] } });
    const before = edits({ segments: [segment("s1", 100, 110), whole] });
    // 2 s into it on the Timeline: 4 s into its video.
    const [, first, second] = split(scene(before, picked(seg("v"))), 12)!.edits.segments;

    expect([first, second].map(({ start, end, speed, pitch }) => ({ start, end, speed, pitch }))).toEqual([
      { start: 0, end: 4, speed: 2, pitch: true },
      { start: 4, end: 10, speed: 2, pitch: true },
    ]);
    expect(segmentLength(first) + segmentLength(second)).toBe(segmentLength(whole));
    for (const t of [0, 1, 1.99, 2, 3.5, 4.99]) {
      const played = t < 2 ? sourceAt(first, t) : sourceAt(second, t - 2);
      expect(played).toBeCloseTo(sourceAt(whole, t));
    }
    expect(second.keys).toEqual({ scale: [key(0, 1.5), key(2, 2)] });
  });

  test("of the Source, cuts in the gap between Words nearest the playhead's Source time", () => {
    const before = edits({ segments: [segment("s1", 100, 110, { speed: 2 })] });
    // 2.3 s in is 104.6 s of the Source; the nearest gap, here, the whole second.
    const outcome = split(scene(before, picked(seg("s1")), { gap: Math.round }), 2.3)!;
    expect(outcome.edits.segments).toEqual([segment("s1", 100, 105, { speed: 2 }), segment("n1", 105, 110, { speed: 2 })]);
  });

  test("an Overlay's second part goes on from where its first stops in its video", () => {
    const before = three({ overlays: [overlay("o", 0, 4, { offset: 1, speed: 2 })] });
    const parts = split(scene(before, picked({ kind: "overlay", id: "o" })), 1)!.edits.overlays;
    expect(parts.map(({ start, secs, offset, speed }) => ({ start, secs, offset, speed }))).toEqual([
      { start: 0, secs: 1, offset: 1, speed: 2 },
      { start: 1, secs: 3, offset: 3, speed: 2 },
    ]);
  });

  test("an Overlay cut by a ripple goes on as far into its video as it was cut", () => {
    // s1 removed on the Magnetic timeline: the Overlay from 8 s loses its first 2 s, 4 s of its video at 2×.
    const before = three({ overlays: [overlay("o", 8, 4, { offset: 1, speed: 2 })] });
    const after = remove(scene(before, picked(seg("s1")), { magnetic: true }))!.edits.overlays[0];
    expect(after).toMatchObject({ start: 0, secs: 2, offset: 5, speed: 2 });
  });
});

describe("the Clipboard and sped items", () => {
  const here = { job: "j", candidate: "one" };

  test("a Segment copied and pasted keeps its Speed and its length on the Timeline", () => {
    const from = edits({ segments: [segment("s1", 100, 110), segment("c", 500, 510, { speed: 2 })] });
    const clipboard = copy(scene(from, picked(seg("c"))), here)!;
    const before = three({ text_layers: [layer("later", 25, 2)] });

    // At 20 s, the join after s2: its 5 s go in there.
    const outcome = paste(scene(before, null, { magnetic: true }), clipboard, 20, here);
    expect(outcome.edits.segments[2]).toEqual(segment("n1", 500, 510, { speed: 2 }));
    expect(playedFrom(outcome.edits.segments).at(-1)!.end).toBe(35);
    expect(outcome.edits.text_layers).toEqual([layer("later", 30, 2)]);
  });

  test("an Overlay cut short at the Clip's start goes on as far into its video", () => {
    // From 1 s before s2, copied with it and pasted at the Clip's start: its first 1 s, 2 s of its video, cut.
    const from = three({ overlays: [overlay("o", 9, 4, { offset: 1, speed: 2 })] });
    const clipboard = copy(scene(from, picked(seg("s2"), { kind: "overlay", id: "o" })), here)!;
    const pasted = paste(scene(three()), clipboard, 0, here);
    expect(pasted.edits.overlays[0]).toMatchObject({ start: 0, secs: 3, offset: 3, speed: 2 });
  });
});

describe("a sped Segment's Filmstrip and Waveform", () => {
  test("show two seconds of its video for each of the Timeline's at 2×", () => {
    const all = { left: 0, right: 300 };
    // 5 px a second: a tile of 80 px is 16 s of the Timeline, 32 s of the video at 2×.
    const tiles = filmstripTiles({ width: 300, mediaStart: 10, speed: 2, frames: 200, tile: 80, pps: 5, view: all, span: all });
    expect(tiles.map((tile) => tile.frame)).toEqual([26, 58, 90, 118]);
    // 30 s of the Timeline at 10 px a second need 60 s of Peaks.
    expect(chunksAcross({ mediaStart: 0, speed: 2, pps: 10, width: 300, span: all, duration: 600 })).toEqual([0, 30]);
    expect(chunksAcross({ mediaStart: 0, pps: 10, width: 300, span: all, duration: 600 })).toEqual([0]);
  });
});
