// .scratch/speed/issues/11-freeze-frame-in-the-advanced-edit.md: Freeze frame (Shift+F) in the
// Advanced Edit (docs/adr/0009): the Segment under the playhead split into a head, a held Segment of
// the frame shown there and a tail, the Main Track rippled; its hold changed by its edges and its
// Duration.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { LINEAR } from "../editor/keyframes";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import { playedSourceAt, segmentLength, sourceAt } from "../editor/segmentTime";
import { canFreezeAt, canSplit, dragSegment, freezeFrame, setHold, type PickContext } from "./actions";
import type { AdvancedEdits } from "./edits";
import { keyNames, resolveShortcut, SHORTCUTS, shortcutSheet } from "./keymap";
import { picked, type Pick } from "./pick";
import { filmstripTiles } from "./timelineView";

const key = (at: number, value: number): Keyframe => ({ at, value, ease: LINEAR });

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, start, end, { media: "clip", framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });
const held = (id: string, at: number, hold: number, changes: Partial<ClipSegment> = {}): ClipSegment => segment(id, at, at, { hold, ...changes });

const layer = (id: string, start: number, secs: number) => ({ id, start, secs, text: id }) as unknown as TextLayer;

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
    segments: [segment("s1", 100, 106)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

// The scene of `state`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, changes: Partial<PickContext> = {}, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

describe("Freeze frame", () => {
  test("at 3 s into a 6 s Segment gives 3 s, 1 s held and 3 s; the layers after it follow on the Magnetic timeline", () => {
    const before = edits({ text_layers: [layer("early", 1, 1), layer("later", 5, 1)] });

    const frozen = freezeFrame(scene(before, { magnetic: true }), 3)!;
    expect(frozen.edits.segments).toEqual([segment("s1", 100, 103), held("n2", 103, 1), segment("n1", 103, 106)]);
    expect(playedFrom(frozen.edits.segments).map((shown) => [shown.start, shown.end])).toEqual([
      [0, 3],
      [3, 4],
      [4, 7],
    ]);
    expect(frozen.edits.text_layers).toEqual([layer("early", 1, 1), layer("later", 6, 1)]);
    // The Freeze frame is picked.
    expect(frozen.pick).toEqual(picked({ kind: "segment", id: "n2" }));
    // Off, the layers stay.
    expect(freezeFrame(scene(before), 3)!.edits.text_layers).toEqual(before.text_layers);
  });

  test("of the Source cuts at the frame shown at the playhead, not between Words as Split does", () => {
    const frozen = freezeFrame(scene(edits(), { gap: () => 103.2 }), 3.25)!;
    expect(frozen.edits.segments).toEqual([segment("s1", 100, 103.25), held("n2", 103.25, 1), segment("n1", 103.25, 106)]);
    // The Clip is a second longer exactly at the playhead: nothing played twice or skipped.
    const played = playedFrom(frozen.edits.segments);
    expect(played.map((shown) => [shown.start, shown.end])).toEqual([
      [0, 3.25],
      [3.25, 4.25],
      [4.25, 7],
    ]);
    expect(playedSourceAt(played[0], 3.25)).toBe(103.25);
    expect(playedSourceAt(played[2], 4.25)).toBe(103.25);
  });

  test("of a reversed 2× Source Segment, head and tail meet at the held frame", () => {
    const before = edits({ segments: [segment("s1", 100, 112, { speed: 2, reverse: true })] });
    const frozen = freezeFrame(scene(before, { gap: () => 105 }), 2.5)!.edits.segments;
    expect(frozen.map(({ start, end, hold }) => ({ start, end, hold }))).toEqual([
      { start: 107, end: 112, hold: undefined },
      { start: 107, end: 107, hold: 1 },
      { start: 100, end: 107, hold: undefined },
    ]);
    expect(frozen.map(segmentLength)).toEqual([2.5, 1, 3.5]);
  });

  test("on a 2× Segment holds the Source frame shown at the playhead", () => {
    const before = edits({ segments: [segment("s1", 100, 112, { speed: 2 })] });
    const shown = playedFrom(before.segments)[0];

    const frozen = freezeFrame(scene(before), 3)!.edits.segments;
    expect(frozen[1]).toEqual(held("n2", playedSourceAt(shown, 3), 1));
    expect(frozen[1].start).toBe(106);
    // Head and tail keep the Speed: 3 s, 1 s, 3 s.
    expect(frozen.map(segmentLength)).toEqual([3, 1, 3]);
    expect([frozen[0].speed, frozen[2].speed]).toEqual([2, 2]);
  });

  test("on a reversed video holds the frame shown there, the head the later part of its range", () => {
    const before = edits({ segments: [video("v", 0, 6, { reverse: true })] });

    const frozen = freezeFrame(scene(before), 2)!.edits.segments;
    expect(frozen[1].start).toBe(sourceAt(before.segments[0], 2));
    expect(frozen.map(({ start, end, reverse }) => ({ start, end, reverse }))).toEqual([
      { start: 4, end: 6, reverse: true },
      { start: 4, end: 4, reverse: undefined },
      { start: 0, end: 4, reverse: true },
    ]);
  });

  test("on a keyed video takes the picture shown at the playhead as constants, its head and tail keyed as before", () => {
    const keys = { scale: [key(0, 1), key(6, 2)], x: [key(0, 100), key(6, 700)], volume: [key(0, 1), key(6, 0)] };
    const before = edits({ segments: [video("v", 10, 16, { keys })] });

    const [head, frame, tail] = freezeFrame(scene(before), 3)!.edits.segments;
    expect(frame).toEqual({
      id: "n2",
      start: 13,
      end: 13,
      hold: 1,
      media: "clip",
      volume: 1,
      framing: { transform: { ...IDENTITY, scale: 1.5, x: 400 }, crop: NO_CROP, background: BLURRED },
    });
    expect(head.keys!.scale).toEqual([key(0, 1), key(3, 1.5)]);
    expect(tail.keys!.scale).toEqual([key(0, 1.5), key(3, 2)]);
  });

  test("keeps a Transition after the Segment after its tail, and adds none inside", () => {
    const before = edits({ segments: [video("v", 0, 6), segment("s2", 200, 210)], transitions: [{ after: "v", kind: "fade", secs: 0.5 }] });

    const frozen = freezeFrame(scene(before), 3)!.edits;
    expect(frozen.transitions).toEqual([{ after: "n1", kind: "fade", secs: 0.5 }]);
    expect(frozen.segments.map((one) => one.id)).toEqual(["v", "n2", "n1", "s2"]);
  });

  test("does nothing within 0.3 s of a Segment's edge, on a Freeze frame, or on a locked Track", () => {
    const before = edits({ segments: [segment("s1", 100, 106), held("f", 50, 2), segment("s2", 200, 206)] });
    for (const time of [0.2, 5.8, 6.5, 7, 8.1]) {
      expect(canFreezeAt(scene(before), time)).toBe(false);
      expect(freezeFrame(scene(before), time)).toBeNull();
    }
    expect(canFreezeAt(scene(before), 3)).toBe(true);
    expect(freezeFrame(scene(before, { locked: ["video"] }), 3)).toBeNull();
    // A Freeze frame isn't split either.
    expect(canSplit(scene(before, {}, picked({ kind: "segment", id: "f" })), 7)).toBe(false);
  });

  test("is refused past the longest clip, with the owner told", () => {
    const before = edits();
    expect(freezeFrame(scene(before), 3, { longest: 6.5 })).toEqual({ edits: before, pick: null, notice: "A clip can last at most 6.5 s: a Freeze frame would make this one 7 s." });
    expect(freezeFrame(scene(before), 3, { longest: 7 })!.notice).toBeUndefined();
  });

  test("is one change: undone, the Segment and every rippled item are as they were", () => {
    const before = edits({ text_layers: [layer("later", 5, 1)] });
    const frozen = freezeFrame(scene(before, { magnetic: true }), 3)!;
    // The edits it was made from are untouched, so that the history's one step back restores them.
    expect(before.segments).toEqual([segment("s1", 100, 106)]);
    expect(before.text_layers).toEqual([layer("later", 5, 1)]);
    expect(frozen.edits).not.toBe(before);
  });
});

describe("a Freeze frame's hold", () => {
  const frozen = () => freezeFrame(scene(edits({ text_layers: [layer("later", 5, 1)] }), { magnetic: true }), 3)!.edits;

  test("follows its right edge dragged to 2.5 s, rippling by 1.5 s; the frame stays", () => {
    const state = frozen();
    const played = playedFrom(state.segments);
    const origin = { edits: state, shown: played, planned: played };
    const dragged = dragSegment(scene(state, { magnetic: true }), origin, "n2", { start: 3, end: 5.5, edge: "end" }, () => Infinity);
    expect(dragged.edits.segments[1]).toEqual(held("n2", 103, 2.5));
    expect(dragged.edits.text_layers).toEqual([layer("later", 7.5, 1)]);
    // Its left edge too, and no shorter than 0.1 s.
    expect(dragSegment(scene(state), origin, "n2", { start: 2.5, end: 4, edge: "start" }, () => Infinity).edits.segments[1].hold).toBe(1.5);
    expect(dragSegment(scene(state), origin, "n2", { start: 3, end: 3, edge: "end" }, () => Infinity).edits.segments[1].hold).toBe(0.1);
    // Nor longer than keeps the Clip within the longest.
    expect(dragSegment(scene(state), origin, "n2", { start: 3, end: 20, edge: "end" }, () => Infinity, 10).edits.segments[1].hold).toBe(4);
  });

  test("is set by its Duration, rippling the same way, within 0.1 s and the longest clip", () => {
    const state = frozen();
    const set = setHold(scene(state, { magnetic: true }), "n2", 2.5)!;
    expect(set.edits.segments[1].hold).toBe(2.5);
    expect(set.edits.text_layers).toEqual([layer("later", 7.5, 1)]);
    expect(setHold(scene(state), "n2", 0)!.edits.segments[1].hold).toBe(0.1);
    expect(setHold(scene(state), "n2", 60, { longest: 10 })!.edits.segments[1].hold).toBe(4);
    // Not a Segment that plays.
    expect(setHold(scene(state), "s1", 2)).toBeNull();
  });

  test("its Filmstrip repeats its frame", () => {
    const tiles = filmstripTiles({ width: 300, mediaStart: 103, speed: 0, frames: 200, tile: 50, pps: 100, view: { left: 0, right: 300 }, span: { left: 0, right: 300 } });
    expect(new Set(tiles.map((tile) => tile.frame))).toEqual(new Set([103]));
  });
});

describe("Shift+F", () => {
  test("is Freeze frame, in the shortcuts sheet; F stays full screen", () => {
    expect(resolveShortcut({ key: "F", shift: true })).toBe("freeze-frame");
    expect(resolveShortcut({ key: "f" })).toBe("fullscreen");
    const row = SHORTCUTS.find((shortcut) => shortcut.id === "freeze-frame")!;
    expect(keyNames(row, true)).toEqual(["⇧F"]);
    expect(shortcutSheet().find((group) => group.group === "editing")!.shortcuts).toContain(row);
  });
});
