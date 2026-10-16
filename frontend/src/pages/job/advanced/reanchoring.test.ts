// Seam D and Seam C (.scratch/keyframes/spec.md, ticket 07): trimming, splitting and rippling an
// item re-anchor its Keyframes so that it plays what it did at the moments it keeps; the Clipboard
// and duplicate carry them; the client merge takes them as part of their item.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Ease, Keyframe, Keys, MusicClip, Overlay } from "../../../api";
import { EASE_IN, EASE_IN_OUT, EASE_OUT, eased, easePart, LINEAR, rekeyed, rewindow, rewindowKeys, valueAt } from "../editor/keyframes";
import { mergeEdits } from "../editor/merge";
import { playedFrom } from "../editor/playback";
import { clipTrimmed, duplicate, layersOf, remove, retimed, retimer, rippleRemove, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const key = (at: number, value: number, ease = LINEAR): Keyframe => ({ at, value, ease });

// A slide across and back, and a fade, over 5 s.
const slide: Keyframe[] = [key(0, 200), key(2, 800, EASE_IN_OUT), key(4, 300, EASE_OUT), key(5, 500, EASE_IN)];
const fade: Keyframe[] = [key(1, 1), key(3, 0.2, EASE_IN)];

const overlay = (id: string, start: number, secs: number, keys: Keys = {}): Overlay => ({
  id,
  media: "logo",
  start,
  secs,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.3, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys,
});

const music = (id: string, start: number, secs: number, keys: Keys = {}): MusicClip => ({
  id,
  media: "song",
  start,
  secs,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys,
});

const segment = (id: string, start: number, end: number): ClipSegment => ({ id, start, end });

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
    text_layers: [],
    music: [],
    source_volume: 1,
    segments: [segment("s1", 100, 110)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

// What `item`'s property plays at Timeline `time`, when it shows then.
const playedAt = (item: { start: number; secs: number; keys: Keys }, property: keyof Keys, time: number) =>
  valueAt(item.keys[property] ?? [], time - item.start, NaN);

// Timeline times every twentieth of a second from `from` to `to`.
const times = (from: number, to: number) => Array.from({ length: Math.round((to - from) * 20) + 1 }, (_, i) => from + i / 20);

describe("re-anchoring a property's Keyframes to a kept window", () => {
  test("trimming 1 s off the start moves every Keyframe 1 s earlier and adds one at 0 with the value there, Linear", () => {
    expect(rewindow(slide, 1, 5)).toEqual([key(0, valueAt(slide, 1, 0)), key(1, 800, easePart(EASE_IN_OUT, 0.5, 1)), key(3, 300, EASE_OUT), key(4, 500, EASE_IN)]);
  });

  test("trimming the end adds one at the end with the value there and the Ease of the first one removed", () => {
    const linear = [key(0, 0), key(2, 100, EASE_IN), key(4, 300)];
    expect(rewindow(linear, 0, 3)).toEqual([key(0, 0), key(2, 100, EASE_IN), key(3, 200)]);
    // Eased, it is the part of that Ease the span kept.
    expect(rewindow(slide, 0, 3)).toEqual([key(0, 200), key(2, 800, EASE_IN_OUT), key(3, valueAt(slide, 3, 0), easePart(EASE_OUT, 0, 0.5))]);
  });

  test("the part of an Ease eases as the whole did between its ends", () => {
    for (const ease of [EASE_IN, EASE_OUT, EASE_IN_OUT, [0.3, -0.6, 0.7, 1.6] as Ease]) {
      expect(easePart(ease, 0, 1).map((value, i) => value - ease[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
      const part = easePart(ease, 0.2, 0.7);
      const [y0, y1] = [eased(ease, 0.2), eased(ease, 0.7)];
      for (let x = 0; x <= 1; x += 0.05) expect(y0 + (y1 - y0) * eased(part, x)).toBeCloseTo(eased(ease, 0.2 + 0.5 * x), 5);
    }
    expect(easePart(LINEAR, 0.2, 0.7)).toBe(LINEAR);
  });

  test("the kept piece plays what the whole did there", () => {
    const piece = rewindow(slide, 1.3, 4.6);
    for (const time of times(1.3, 4.6)) expect(valueAt(piece, time - 1.3, 0)).toBeCloseTo(valueAt(slide, time, 0), 3);
  });

  test("lengthening changes nothing: a later end keeps them, an earlier start keeps them on the same moments", () => {
    expect(rewindow(slide, 0, 8)).toEqual(slide);
    expect(rewindow(slide, -1, 5)).toEqual(slide.map((one) => ({ ...one, at: one.at + 1 })));
  });

  test("a Keyframe within a frame of the new edge stands for the edge: no second one beside it", () => {
    const kept = rewindow([key(0, 0), key(1.01, 10), key(3, 30)], 1, 3);
    expect(kept.map((one) => one.at)).toEqual([0.01, 2]);
  });

  test("every keyed property of an item, and none added to an unkeyed one", () => {
    expect(rewindowKeys({ x: slide, opacity: fade }, 2, 4)).toEqual({ x: rewindow(slide, 2, 4), opacity: rewindow(fade, 2, 4) });
    expect(rekeyed({ id: "t", start: 0, secs: 3 }, 1, 3)).toEqual({ id: "t", start: 0, secs: 3 });
  });
});

describe("trimming a keyed item on the Timeline or in the inspector", () => {
  const whole = overlay("o", 2, 5, { x: slide });

  test("its start trimmed 1 s later: every Keyframe 1 s earlier, one added at 0", () => {
    expect(retimed(whole, { ...whole, start: 3, secs: 4 }, "start").keys).toEqual({ x: rewindow(slide, 1, 5) });
  });

  test("its end trimmed: one added at the end", () => {
    expect(retimed(whole, { ...whole, secs: 3 }, "end").keys).toEqual({ x: rewindow(slide, 0, 3) });
  });

  test("moved, or lengthened at the end, it keeps them", () => {
    expect(retimed(whole, { ...whole, start: 4 }, "move").keys).toBe(whole.keys);
    expect(retimed(whole, { ...whole, secs: 8 }, "end").keys).toEqual(whole.keys);
  });

  test("a drag in and back out again gets them back: each step is made from the item as the drag began", () => {
    const retime = retimer();
    const shorter = retime(whole, { ...whole, secs: 1.5 }, "end", "drag:1");
    const back = retime(shorter, { ...shorter, secs: 5 }, "end", "drag:1");
    expect(shorter.keys).toEqual({ x: rewindow(slide, 0, 1.5) });
    expect(back.keys).toEqual(whole.keys);
    // A new gesture starts from the item as it is.
    expect(retime(shorter, { ...shorter, secs: 5 }, "end", "drag:2").keys).toEqual(shorter.keys);
  });

  test("an item changed since the last step (an undo, another editor) starts the gesture again from it", () => {
    const retime = retimer();
    retime(whole, { ...whole, secs: 1.5 }, "end", "key:end");
    const other = overlay("o", 2, 5, { x: [key(0, 1)] });
    expect(retime(other, { ...other, secs: 4 }, "end", "key:end").keys).toEqual(other.keys);
  });
});

describe("splitting a keyed item", () => {
  test("its two pieces play the same values at the same Timeline times as the whole", () => {
    const whole = overlay("o", 1, 5, { x: slide, opacity: fade });
    const before = edits({ overlays: [whole] });
    const [head, tail] = split(scene(before, picked({ kind: "overlay", id: "o" })), 3.5)!.edits.overlays;
    for (const property of ["x", "opacity"] as const) {
      for (const time of times(1, 3.5)) expect(playedAt(head, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
      for (const time of times(3.5, 6)) expect(playedAt(tail, property, time)).toBeCloseTo(playedAt(whole, property, time), 3);
    }
    expect(head.keys.x?.at(-1)?.at).toBe(2.5);
    expect(tail.keys.x?.[0]).toEqual(key(0, valueAt(slide, 2.5, 0)));
  });

  test("a keyed Music Clip's halves each have their own part of its volume, not a copy of the whole", () => {
    const volume = [key(0, 1), key(2, 0.3, EASE_IN_OUT), key(4, 1)];
    const before = edits({ music: [music("m", 0, 5, { volume })] });
    const [head, tail] = split(scene(before, picked({ kind: "music", id: "m" })), 2.5)!.edits.music;
    expect(head.keys).toEqual({ volume: rewindow(volume, 0, 2.5) });
    expect(tail.keys).toEqual({ volume: rewindow(volume, 2.5, 5) });
  });
});

describe("a keyed layer that follows a ripple", () => {
  // Three Segments of 4 s: the middle one, from 4 s to 8 s, is deleted.
  const three = [segment("s1", 100, 104), segment("s2", 200, 204), segment("s3", 300, 304)];
  const middle = picked({ kind: "segment", id: "s2" });

  test("an Overlay from inside the deleted Segment keeps its motion at the moments that remain", () => {
    const across = overlay("o", 6, 5, { x: slide });
    const after = remove(scene(edits({ segments: three, overlays: [across] }), middle, { magnetic: true }))!.edits.overlays[0];
    // Its part from 8 s now plays from 4 s.
    expect(after).toMatchObject({ start: 4, secs: 3 });
    for (const time of times(8, 11)) expect(playedAt(after, "x", time - 4)).toBeCloseTo(playedAt(across, "x", time), 3);
  });

  test("one that runs into the deleted Segment loses its end there, with a Keyframe at its new end", () => {
    const into = overlay("o", 1, 5, { x: slide });
    const after = remove(scene(edits({ segments: three, overlays: [into] }), middle, { magnetic: true }))!.edits.overlays[0];
    expect(after).toMatchObject({ start: 1, secs: 3, keys: { x: rewindow(slide, 0, 3) } });
  });

  test("one over the whole deleted Segment plays on as its picture does, losing its last seconds", () => {
    // Its video (or image) goes on without a jump, so its Keyframes stay with it, as an end trimmed.
    const over = overlay("o", 1, 10, { x: [key(0, 0), key(10, 1000)] });
    const after = remove(scene(edits({ segments: three, overlays: [over] }), middle, { magnetic: true }))!.edits.overlays[0];
    expect(after).toMatchObject({ start: 1, secs: 6, keys: { x: [key(0, 0), key(6, 600)] } });
  });

  test("a locked Track's items still re-anchor", () => {
    const across = overlay("o", 6, 5, { x: slide });
    const locked = scene(edits({ segments: three, overlays: [across] }), middle, { magnetic: true, locked: ["overlay"] });
    expect(remove(locked)!.edits.overlays[0].keys).toEqual({ x: rewindow(slide, 2, 5) });
  });

  test("Ripple delete of a Segment, and the clip editor's trim, re-anchor too", () => {
    const across = overlay("o", 6, 5, { x: slide });
    expect(rippleRemove(scene(edits({ segments: three, overlays: [across] }), middle))!.edits.overlays[0].keys).toEqual({ x: rewindow(slide, 2, 5) });
    const trimmed = clipTrimmed(layersOf(edits({ overlays: [overlay("o", 0, 5, { x: slide })] })), { start: 100, end: 110 }, { start: 101, end: 110 });
    expect(trimmed.layers.overlays[0]).toMatchObject({ start: 0, secs: 4, keys: { x: rewindow(slide, 1, 5) } });
  });

  test("items wholly after the cut move with their Keyframes as they are", () => {
    const later = music("m", 9, 3, { volume: fade });
    const after = remove(scene(edits({ segments: three, music: [later] }), middle, { magnetic: true }))!.edits.music[0];
    expect(after).toMatchObject({ start: 5, secs: 3, keys: { volume: fade } });
  });
});

describe("copying, pasting and duplicating keyed items", () => {
  const here = { job: "j", candidate: "c" };
  const keyed = overlay("o", 1, 5, { x: slide, opacity: fade });

  test("a pasted item has its Keyframes", () => {
    const state = edits({ overlays: [keyed] });
    const clipboard = copy(scene(state, picked({ kind: "overlay", id: "o" })), here)!;
    const pasted = paste(scene(state, null), clipboard, 2, here).edits.overlays[1];
    expect(pasted).toMatchObject({ start: 2, secs: 5, keys: keyed.keys });
  });

  test("one pasted too near the Clip's end, cut short there, has a Keyframe at its new end", () => {
    const state = edits({ overlays: [keyed] });
    const clipboard = copy(scene(state, picked({ kind: "overlay", id: "o" })), here)!;
    const pasted = paste(scene(state, null), clipboard, 7, here).edits.overlays[1];
    expect(pasted).toMatchObject({ start: 7, secs: 3, keys: { x: rewindow(slide, 0, 3), opacity: rewindow(fade, 0, 3) } });
  });

  test("a duplicate has its Keyframes", () => {
    const state = edits({ overlays: [overlay("o", 1, 3, { x: [key(0, 100), key(3, 900)] })] });
    const copied = duplicate(scene(state, picked({ kind: "overlay", id: "o" })))!.edits.overlays[1];
    expect(copied.keys).toEqual({ x: [key(0, 100), key(3, 900)] });
  });
});

describe("merging Keyframes with another editor's change", () => {
  const base = { overlays: [overlay("a", 0, 5), overlay("b", 0, 5)] };

  test("a remote change to one Overlay's Keyframes and a local change to another Overlay both survive", () => {
    const theirs = { overlays: [overlay("a", 0, 5, { x: slide }), overlay("b", 0, 5)] };
    const mine = { overlays: [overlay("a", 0, 5), { ...overlay("b", 0, 5), secs: 3 }] };
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { overlays: [overlay("a", 0, 5, { x: slide }), { ...overlay("b", 0, 5), secs: 3 }] }, collisions: [] });
  });

  test("on one Overlay, the owner's wins", () => {
    const theirs = { overlays: [overlay("a", 0, 5, { x: slide }), overlay("b", 0, 5)] };
    const mine = { overlays: [overlay("a", 0, 5, { opacity: fade }), overlay("b", 0, 5)] };
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: mine, collisions: [{ field: "overlays", item: "a" }] });
  });
});
