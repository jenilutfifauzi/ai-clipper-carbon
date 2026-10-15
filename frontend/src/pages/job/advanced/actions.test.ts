// Seam D (.scratch/multi-select-clipboard/spec.md): what is done to a Pick (remove, duplicate, split,
// move, select all, copy and paste), as worked examples of the edits before and after.
import { describe, expect, test } from "vitest";
import type { ClipSegment, MusicClip, Overlay, TextLayer } from "../../../api";
import { playedFrom } from "../editor/playback";
import { duplicate, remove, selectAll, split, type Scene } from "./actions";
import type { AdvancedEdits } from "./edits";
import { picked, prunedPick, type Pick } from "./pick";

function layer(id: string, start: number, secs: number, changes: Partial<TextLayer> = {}): TextLayer {
  return {
    id,
    text: id,
    start,
    secs,
    x: 540,
    y: 960,
    font: "Montserrat ExtraBold",
    size: 56,
    colour: "#FFFFFF",
    outline: 0,
    outline_colour: "#000000",
    box: false,
    box_colour: "#000000",
    box_opacity: 0.6,
    align: "center",
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
    ...changes,
  };
}

const music = (id: string, start: number, secs: number, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "song",
  start,
  secs,
  offset: 0,
  volume: 1,
  fade_in: 1,
  fade_out: 1,
  ...changes,
});

// A Segment of the Source from `start` to `end` seconds.
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [],
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

// The scene of `edits` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, gap = (time: number) => time): Scene {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap, ids: () => `n${++n}` };
}

const overlay = (id: string, start: number, secs: number): Overlay => ({
  id,
  media: "logo",
  start,
  secs,
  offset: 0,
  x: 540,
  y: 400,
  size: 300,
  opacity: 1,
  volume: 0,
});

const text = (id: string) => ({ kind: "text", id }) as const;
const seg = (id: string) => ({ kind: "segment", id }) as const;

describe("one item, as before the Pick", () => {
  test("removing a Text Layer leaves the others and nothing picked", () => {
    const before = edits({ text_layers: [layer("a", 0, 2), layer("b", 3, 2)] });

    expect(remove(scene(before, picked(text("a"))))).toEqual({ edits: { ...before, text_layers: [layer("b", 3, 2)] }, pick: null });
  });

  test("the only Segment isn't removed", () => {
    const before = edits();

    expect(remove(scene(before, picked(seg("s1"))))?.edits).toBe(before);
  });

  test("a Text Layer is duplicated right after itself when there is room, and the copy is picked", () => {
    const before = edits({ text_layers: [layer("a", 1, 2)] });

    expect(duplicate(scene(before, picked(text("a"))))).toEqual({
      edits: { ...before, text_layers: [layer("a", 1, 2), layer("n1", 3, 2, { text: "a" })] },
      pick: picked(text("n1")),
    });
  });

  test("without room after it, a Text Layer's copy goes a little lower at the same time", () => {
    const before = edits({ text_layers: [layer("a", 7, 2)] });

    expect(duplicate(scene(before, picked(text("a"))))?.edits.text_layers).toEqual([layer("a", 7, 2), layer("n1", 7, 2, { text: "a", y: 1040 })]);
  });

  test("a Segment is duplicated right after itself", () => {
    const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205)] });

    expect(duplicate(scene(before, picked(seg("s1"))))).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110), segment("n1", 100, 110), segment("s2", 200, 205)] },
      pick: picked(seg("n1")),
    });
  });

  test("a Music Clip split at 4 s goes on in its song from there, with no fades at the cut", () => {
    const before = edits({ music: [music("m", 2, 6, { offset: 10 })] });

    expect(split(scene(before, picked({ kind: "music", id: "m" })), 4)).toEqual({
      edits: { ...before, music: [music("m", 2, 2, { offset: 10, fade_out: 0 }), music("n1", 4, 4, { offset: 12, fade_in: 0 })] },
      pick: picked({ kind: "music", id: "n1" }),
    });
  });

  test("a Segment of the Source is split in the silence between Words nearest the playhead", () => {
    const before = edits({ segments: [segment("s1", 100, 110)] });
    // The playhead at 3 s is 103 s into the Source, inside a Word: the silence nearest it is at 103.2.
    const gap = (time: number) => (time === 103 ? 103.2 : time);

    expect(split(scene(before, picked(seg("s1")), gap), 3)).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 103.2), segment("n1", 103.2, 110)] },
      pick: picked(seg("n1")),
    });
  });

  test("nothing is split where the playhead isn't inside the item", () => {
    const before = edits({ text_layers: [layer("a", 1, 2)] });

    expect(split(scene(before, picked(text("a"))), 5)).toBeNull();
  });
});

describe("pruning the Pick", () => {
  test("keeps the picked items that are still there", () => {
    const now = edits({ text_layers: [layer("a", 0, 2)] });

    expect(prunedPick(picked(text("a"), text("gone")), now)).toEqual(picked(text("a")));
  });

  test("picks nothing when none are left", () => {
    expect(prunedPick(picked(text("gone")), edits())).toBeNull();
  });

  test("drops a join whose Segment is gone or now last", () => {
    const now = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205)] });

    expect(prunedPick({ kind: "join", after: "s1" }, now)).toEqual({ kind: "join", after: "s1" });
    expect(prunedPick({ kind: "join", after: "s2" }, now)).toBeNull();
  });

  test("keeps the hook and the captions", () => {
    expect(prunedPick({ kind: "hook" }, edits())).toEqual({ kind: "hook" });
  });
});

describe("removing a Pick", () => {
  test("removes items of every kind in one change, and picks nothing", () => {
    const before = edits({
      segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
      text_layers: [layer("a", 0, 2), layer("b", 3, 2)],
      music: [music("m", 0, 5)],
      overlays: [overlay("o", 1, 1)],
    });

    expect(remove(scene(before, picked(seg("s2"), text("a"), { kind: "music", id: "m" }, { kind: "overlay", id: "o" })))).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110)], text_layers: [layer("b", 3, 2)], music: [], overlays: [] },
      pick: null,
    });
  });

  test("with every Segment picked, the first stays, picked, and the owner is told", () => {
    const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205)], text_layers: [layer("a", 0, 2)] });

    const outcome = remove(scene(before, picked(seg("s2"), seg("s1"), text("a"))));

    expect(outcome?.edits).toEqual({ ...before, segments: [segment("s1", 100, 110)], text_layers: [] });
    expect(outcome?.pick).toEqual(picked(seg("s1")));
    expect(outcome?.notice).toMatch(/first Segment/);
  });
});

describe("select all", () => {
  test("picks every Segment, Text Layer, Music Clip and Overlay, and not the hook or captions", () => {
    const now = edits({
      segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
      text_layers: [layer("a", 0, 2)],
      music: [music("m", 0, 5)],
      overlays: [overlay("o", 1, 1)],
    });

    expect(selectAll(now)).toEqual(
      picked(seg("s1"), seg("s2"), text("a"), { kind: "music", id: "m" }, { kind: "overlay", id: "o" }),
    );
  });

  test("picks the one Segment of a Clip that has nothing else", () => {
    expect(selectAll(edits())).toEqual(picked(seg("s1")));
  });
});
