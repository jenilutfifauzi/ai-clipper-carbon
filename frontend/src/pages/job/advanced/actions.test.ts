// Seam D (.scratch/multi-select-clipboard/spec.md): what is done to a Pick (remove, duplicate, split,
// move, select all, copy and paste), as worked examples of the edits before and after.
import { describe, expect, test } from "vitest";
import type { ClipSegment, MusicClip, Overlay, TextLayer } from "../../../api";
import { playedFrom } from "../editor/playback";
import { duplicate, move, nudge, remove, restyle, selectAll, shared, split, type Scene } from "./actions";
import { copy, cut, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { bandPick, picked, prunedPick, type Pick } from "./pick";

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

describe("duplicating a Pick", () => {
  test("a group of layer items is copied right after itself, keeping its shape, and the copies are picked", () => {
    // From 1 s to 4 s: the copies go 3 s later.
    const before = edits({ text_layers: [layer("a", 1, 2)], music: [music("m", 2, 2)] });

    expect(duplicate(scene(before, picked(text("a"), { kind: "music", id: "m" })))).toEqual({
      edits: { ...before, text_layers: [layer("a", 1, 2), layer("n1", 4, 2, { text: "a" })], music: [music("m", 2, 2), music("n2", 5, 2)] },
      pick: picked(text("n1"), { kind: "music", id: "n2" }),
    });
  });

  test("a group that wouldn't fit before the Clip's end is copied where each item's kind puts it aside", () => {
    const before = edits({ text_layers: [layer("a", 5, 2), layer("b", 6, 2)] });

    expect(duplicate(scene(before, picked(text("a"), text("b"))))?.edits.text_layers).toEqual([
      layer("a", 5, 2),
      layer("b", 6, 2),
      layer("n1", 5, 2, { text: "a", y: 1040 }),
      layer("n2", 6, 2, { text: "b", y: 1040 }),
    ]);
  });

  test("picked Segments are copied as a block, in order, after the last picked one", () => {
    const before = edits({ segments: [segment("s1", 100, 102), segment("s2", 200, 202), segment("s3", 300, 302)] });

    expect(duplicate(scene(before, picked(seg("s3"), seg("s1"))))).toEqual({
      edits: {
        ...before,
        segments: [segment("s1", 100, 102), segment("s2", 200, 202), segment("s3", 300, 302), segment("n1", 100, 102), segment("n2", 300, 302)],
      },
      pick: picked(seg("n1"), seg("n2")),
    });
  });
});

describe("splitting a Pick", () => {
  test("cuts only the picked items the playhead is inside, and picks their second parts", () => {
    const before = edits({
      segments: [segment("s1", 100, 106), segment("s2", 200, 204)],
      text_layers: [layer("a", 3, 4), layer("b", 0, 2)],
    });

    expect(split(scene(before, picked(text("a"), text("b"), seg("s1"), seg("s2"))), 5)).toEqual({
      edits: {
        ...before,
        segments: [segment("s1", 100, 105), segment("n1", 105, 106), segment("s2", 200, 204)],
        text_layers: [layer("a", 3, 2), layer("n2", 5, 2, { text: "a" }), layer("b", 0, 2)],
      },
      pick: picked(seg("n1"), text("n2")),
    });
  });
});

describe("the rubber band", () => {
  // Items as drawn on the Timeline, in screen pixels: a row of texts over the video's row.
  const drawn = [
    { key: "text:a", left: 0, right: 100, top: 0, bottom: 40 },
    { key: "text:b", left: 150, right: 250, top: 0, bottom: 40 },
    { key: "segment:s1", left: 0, right: 300, top: 50, bottom: 100 },
    { key: "hook", left: 0, right: 80, top: 110, bottom: 140 },
  ];

  test("picks every item it touches, even partly, across rows", () => {
    expect(bandPick(null, drawn, { left: 90, right: 160, top: 20, bottom: 60 }, false)).toEqual(picked(text("a"), text("b"), seg("s1")));
  });

  test("leaves out items it doesn't reach, and the hook", () => {
    expect(bandPick(null, drawn, { left: 10, right: 60, top: 60, bottom: 130 }, false)).toEqual(picked(seg("s1")));
  });

  test("replaces the Pick, or adds to it with Shift", () => {
    const band = { left: 160, right: 200, top: 10, bottom: 30 };

    expect(bandPick(picked(text("a")), drawn, band, false)).toEqual(picked(text("b")));
    expect(bandPick(picked(text("a"), text("b")), drawn, band, true)).toEqual(picked(text("a"), text("b")));
    expect(bandPick(picked(seg("s1")), drawn, band, true)).toEqual(picked(seg("s1"), text("b")));
  });

  test("touching nothing picks nothing, or keeps the Pick with Shift", () => {
    const band = { left: 400, right: 450, top: 0, bottom: 100 };

    expect(bandPick(picked(text("a")), drawn, band, false)).toBeNull();
    expect(bandPick(picked(text("a")), drawn, band, true)).toEqual(picked(text("a")));
  });
});

describe("moving a Pick", () => {
  test("moves its Text Layers, Music Clips and Overlays by the same time, and not its Segments", () => {
    const before = edits({ text_layers: [layer("a", 1, 2)], music: [music("m", 2, 2)], overlays: [overlay("o", 0.5, 1)] });
    const pick = picked(text("a"), { kind: "music", id: "m" }, { kind: "overlay", id: "o" }, seg("s1"));

    expect(move(scene(before, pick), 2)).toEqual({
      edits: { ...before, text_layers: [layer("a", 3, 2)], music: [music("m", 4, 2)], overlays: [overlay("o", 2.5, 1)] },
      pick,
    });
  });

  test("stops at the Clip's end, keeping the group's shape", () => {
    const before = edits({ text_layers: [layer("a", 1, 2), layer("b", 6, 3)] });

    expect(move(scene(before, picked(text("a"), text("b"))), 3)?.edits.text_layers).toEqual([layer("a", 2, 2), layer("b", 7, 3)]);
  });

  test("stops at the Clip's start", () => {
    const before = edits({ text_layers: [layer("a", 1, 2), layer("b", 6, 3)] });

    expect(move(scene(before, picked(text("a"), text("b"))), -5)?.edits.text_layers).toEqual([layer("a", 0, 2), layer("b", 5, 3)]);
  });

  test("leaves the items that aren't picked", () => {
    const before = edits({ text_layers: [layer("a", 1, 2), layer("b", 6, 2)] });

    expect(move(scene(before, picked(text("a"))), 1)?.edits.text_layers).toEqual([layer("a", 2, 2), layer("b", 6, 2)]);
  });

  test("does nothing without Text Layers, Music Clips or Overlays picked", () => {
    expect(move(scene(edits(), picked(seg("s1"))), 1)).toBeNull();
  });
});

describe("moving a Pick on the preview", () => {
  test("moves its Text Layers and Overlays by the same offset, in output pixels", () => {
    const before = edits({ text_layers: [layer("a", 0, 2), layer("b", 0, 2, { x: 200 })], overlays: [overlay("o", 0, 2)] });
    const pick = picked(text("a"), { kind: "overlay", id: "o" });

    expect(nudge(scene(before, pick), 100, -50)).toEqual({
      edits: { ...before, text_layers: [layer("a", 0, 2, { x: 640, y: 910 }), layer("b", 0, 2, { x: 200 })], overlays: [{ ...overlay("o", 0, 2), x: 640, y: 350 }] },
      pick,
    });
  });

  test("keeps every middle in the frame, keeping their places relative to one another", () => {
    const before = edits({ text_layers: [layer("a", 0, 2, { x: 1000 }), layer("b", 0, 2, { x: 500 })] });

    expect(nudge(scene(before, picked(text("a"), text("b"))), 200, 0)?.edits.text_layers).toEqual([
      layer("a", 0, 2, { x: 1080 }),
      layer("b", 0, 2, { x: 580 }),
    ]);
  });
});

describe("editing several Text Layers", () => {
  const a = layer("a", 0, 2, { font: "anton", colour: "#FF0000" });
  const b = layer("b", 3, 2, { font: "anton", colour: "#00FF00" });

  test("a field they all have the same shows its value, one they differ in shows as mixed", () => {
    expect(shared([a, b], "font")).toBe("anton");
    expect(shared([a, b], "colour")).toBeUndefined();
  });

  test("setting a field sets it on every picked Text Layer, and changes nothing else", () => {
    const c = layer("c", 6, 2);
    const before = edits({ text_layers: [a, b, c] });
    const pick = picked(text("a"), text("b"));

    expect(restyle(scene(before, pick), "colour", "#0000FF")).toEqual({
      edits: { ...before, text_layers: [{ ...a, colour: "#0000FF" }, { ...b, colour: "#0000FF" }, c] },
      pick,
    });
  });
});

describe("copy and paste", () => {
  const here = { job: "j1", candidate: "c1" };

  test("a group without Segments pastes at the playhead, keeping its spacing, with new ids, picked", () => {
    const before = edits({ segments: [segment("s1", 100, 120)], text_layers: [layer("a", 2, 2)], music: [music("m", 3, 4)] });
    const held = copy(scene(before, picked(text("a"), { kind: "music", id: "m" })), here)!;

    expect(paste(scene(before, null), held, 10, here)).toEqual({
      edits: { ...before, text_layers: [layer("a", 2, 2), layer("n1", 10, 2, { text: "a" })], music: [music("m", 3, 4), music("n2", 11, 4)] },
      pick: picked(text("n1"), { kind: "music", id: "n2" }),
    });
  });

  test("Segments are inserted at the join nearest the playhead, and the layers placed from there", () => {
    // s1 plays 0–5 s, s2 5–15 s, s3 15–20 s.
    const before = edits({
      segments: [segment("s1", 100, 105), segment("s2", 200, 210), segment("s3", 300, 305)],
      text_layers: [layer("a", 6, 2)],
    });
    // s2 with its title, 1 s into it.
    const held = copy(scene(before, picked(seg("s2"), text("a"))), here)!;

    // The playhead at 14 s is nearest the join at 15 s, after s2.
    expect(paste(scene(before, null), held, 14, here)).toEqual({
      edits: {
        ...before,
        segments: [segment("s1", 100, 105), segment("s2", 200, 210), segment("n1", 200, 210), segment("s3", 300, 305)],
        text_layers: [layer("a", 6, 2), layer("n2", 16, 2, { text: "a" })],
      },
      pick: picked(seg("n1"), text("n2")),
    });
  });

  test("Segments paste at the Clip's start and at its end", () => {
    const before = edits({ segments: [segment("s1", 100, 105), segment("s2", 200, 210)] });
    const held = copy(scene(before, picked(seg("s1"))), here)!;

    expect(paste(scene(before, null), held, 1, here)?.edits.segments.map((s) => s.id)).toEqual(["n1", "s1", "s2"]);
    expect(paste(scene(before, null), held, 14, here)?.edits.segments.map((s) => s.id)).toEqual(["s1", "s2", "n1"]);
  });

  test("Transitions between copied neighbours come along; one into a Segment that wasn't copied doesn't", () => {
    const before = edits({
      segments: [segment("s1", 100, 105), segment("s2", 200, 210), segment("s3", 300, 305)],
      transitions: [
        { after: "s1", kind: "fade", secs: 0.5 },
        { after: "s2", kind: "fadeblack", secs: 0.4 },
      ],
    });
    const held = copy(scene(before, picked(seg("s1"), seg("s2"))), here)!;

    const pasted = paste(scene(before, null), held, 20, here)!.edits;

    expect(pasted.segments.map((s) => s.id)).toEqual(["s1", "s2", "s3", "n1", "n2"]);
    expect(pasted.transitions).toEqual([...before.transitions, { after: "n1", kind: "fade", secs: 0.5 }]);
  });

  test("what would run past the Clip's end is cut short, or left out when it would start there, and the owner is told", () => {
    const before = edits({ segments: [segment("s1", 100, 110)], text_layers: [layer("a", 0, 3), layer("b", 4, 2), layer("c", 2, 0.5)] });
    const held = copy(scene(before, picked(text("a"), text("b"), text("c"))), here)!;

    // At 7 s: a runs 7–10 s and c 9–9.5 s; b would start at 11 s.
    const at7 = paste(scene(before, null), held, 7, here)!;
    expect(at7.edits.text_layers.slice(3)).toEqual([layer("n1", 7, 3, { text: "a" }), layer("n2", 9, 0.5, { text: "c" })]);
    expect(at7.notice).toBe("1 item left out, falling outside the clip.");

    // At 8 s: a is cut short to 8–10 s; c would start at 10 s and b at 12 s.
    const at8 = paste(scene(before, null), held, 8, here)!;
    expect(at8.edits.text_layers.slice(3)).toEqual([layer("n1", 8, 2, { text: "a" })]);
    expect(at8.notice).toBe("1 item cut short to fit; 2 items left out, falling outside the clip.");
  });

  test("cut is a copy and a removal in one change", () => {
    const before = edits({ text_layers: [layer("a", 0, 2), layer("b", 3, 2)] });

    const { clipboard, outcome } = cut(scene(before, picked(text("a"))), here)!;

    expect(outcome).toEqual({ edits: { ...before, text_layers: [layer("b", 3, 2)] }, pick: null });
    expect(paste(scene(outcome.edits, null), clipboard, 6, here)?.edits.text_layers).toEqual([layer("b", 3, 2), layer("n1", 6, 2, { text: "a" })]);
  });
});

describe("pasting into another Candidate or Job", () => {
  const here = { job: "j1", candidate: "c1" };
  // The Source's Words around 200–210 s.
  const words = [
    { start: 201, end: 201.5 },
    { start: 202, end: 202.6 },
    { start: 207, end: 207.4 },
  ];
  const source = edits({
    segments: [segment("s1", 100, 105), segment("s2", 200, 210)],
    word_edits: [
      { at: 201.2, text: "Gojek", break_before: false },
      { at: 202.1, text: "", break_before: false },
      { at: 101, text: "elsewhere", break_before: false },
    ],
    layout_overrides: [
      { at: 205, layout: "split" },
      { at: 102, layout: "blur" },
    ],
  });
  const held = copy(scene(source, picked(seg("s2"))), here)!;

  test("Segments of the Source bring their range's Word Edits and Layout Overrides to another Candidate", () => {
    const target = edits({ segments: [segment("t1", 300, 306)] });

    const pasted = paste(scene(target, null), held, 6, { job: "j1", candidate: "c2" }, words).edits;

    expect(pasted.word_edits).toEqual([
      { at: 201.2, text: "Gojek", break_before: false },
      { at: 202.1, text: "", break_before: false },
    ]);
    expect(pasted.layout_overrides).toEqual([{ at: 205, layout: "split" }]);
  });

  test("the other Candidate's own Word Edits on the same Words, and its own Layout Overrides in the range, are kept", () => {
    const target = edits({
      segments: [segment("t1", 300, 306)],
      word_edits: [{ at: 201.4, text: "GoJek", break_before: true }],
      layout_overrides: [{ at: 208, layout: "track" }],
    });

    const pasted = paste(scene(target, null), held, 6, { job: "j1", candidate: "c2" }, words).edits;

    expect(pasted.word_edits).toEqual([
      { at: 201.4, text: "GoJek", break_before: true },
      { at: 202.1, text: "", break_before: false },
    ]);
    expect(pasted.layout_overrides).toEqual([{ at: 208, layout: "track" }]);
  });

  test("pasting into the Candidate copied from brings nothing more: its edits already show there", () => {
    const pasted = paste(scene(source, null), held, 15, here, words).edits;

    expect(pasted.word_edits).toBe(source.word_edits);
    expect(pasted.layout_overrides).toBe(source.layout_overrides);
  });

  test("in another Job, Segments of the Source and their Transitions are left out, and the rest pasted", () => {
    const before = edits({
      segments: [segment("s1", 100, 105), segment("v1", 0, 4, { media: "clip" }), segment("s2", 200, 205)],
      transitions: [{ after: "s1", kind: "fade", secs: 0.5 }],
      text_layers: [layer("a", 6, 2)],
    });
    const mixed = copy(scene(before, picked(seg("s1"), seg("v1"), text("a"))), here)!;
    const target = edits({ segments: [segment("t1", 300, 310)] });

    const outcome = paste(scene(target, null), mixed, 9, { job: "j2", candidate: "c9" }, []);

    // v1 goes in at the end (10 s); the title, 6 s after s1's start, 1 s after v1's.
    expect(outcome.edits.segments).toEqual([segment("t1", 300, 310), segment("n1", 0, 4, { media: "clip" })]);
    expect(outcome.edits.transitions).toEqual([]);
    expect(outcome.edits.text_layers).toEqual([layer("n2", 11, 2, { text: "a" })]);
    expect(outcome.notice).toBe("1 Segment of this episode left out: another Job's clips can't show it.");
  });
});
