// Seam D (.scratch/multi-select-clipboard/spec.md): what is done to a Pick (remove, duplicate, split,
// move, select all, copy and paste), as worked examples of the edits before and after.
import { describe, expect, test } from "vitest";
import type { ClipSegment, LayoutOverride, MusicClip, Overlay, TextLayer } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom } from "../editor/playback";
import {
  changeMusic,
  dragSegment,
  duplicate,
  insertSegment,
  move,
  nudge,
  placeAfter,
  placeDropped,
  remove,
  restyle,
  rippleRemove,
  setFade,
  setVolume,
  canSplitAt,
  clipTrimmed,
  pickAll,
  shared,
  split,
  splitAt,
  type PickContext,
} from "./actions";
import { copy, cut, paste } from "./clipboard";
import { fadesWithin, type AdvancedEdits } from "./edits";
import { bandPick, picked, prunedPick, unlockedPick, type Pick } from "./pick";

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

// The scene of `edits` with `pick`: its Main Track played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, gap = (time: number) => time): PickContext {
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
  transform: { x: 540, y: 400, scale: 0.3, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
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

describe("removing every Segment", () => {
  test("keeps the first, picked, and removes the others", () => {
    const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 305)] });

    const outcome = remove(scene(before, picked(seg("s1"), seg("s2"), seg("s3"))));

    expect(outcome?.edits).toEqual({ ...before, segments: [segment("s1", 100, 110)] });
    expect(outcome?.pick).toEqual(picked(seg("s1")));
    expect(outcome?.notice).toMatch(/first Segment/);
  });
});

describe("pick all", () => {
  test("picks every Segment, Text Layer, Music Clip and Overlay, and not the hook or captions", () => {
    const now = edits({
      segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
      text_layers: [layer("a", 0, 2)],
      music: [music("m", 0, 5)],
      overlays: [overlay("o", 1, 1)],
    });

    expect(pickAll(now)).toEqual(
      picked(seg("s1"), seg("s2"), text("a"), { kind: "music", id: "m" }, { kind: "overlay", id: "o" }),
    );
  });

  test("picks the one Segment of a Clip that has nothing else", () => {
    expect(pickAll(edits())).toEqual(picked(seg("s1")));
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
      edits: { ...before, text_layers: [layer("a", 0, 2, { x: 640, y: 910 }), layer("b", 0, 2, { x: 200 })], overlays: [{ ...overlay("o", 0, 2), transform: { ...overlay("o", 0, 2).transform, x: 640, y: 350 } }] },
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

describe("setting an item's volume", () => {
  test("a Music Clip's volume is rounded to a hundredth and kept within 0–200%, and the Pick stays", () => {
    const before = edits({ music: [music("m1", 0, 5), music("m2", 2, 5)] });
    const pick = picked({ kind: "music", id: "m1" }, { kind: "music", id: "m2" });

    expect(setVolume(scene(before, pick), { kind: "music", id: "m2" }, 0.614)).toEqual({
      edits: { ...before, music: [music("m1", 0, 5), music("m2", 2, 5, { volume: 0.61 })] },
      pick,
    });
    expect(setVolume(scene(before, pick), { kind: "music", id: "m1" }, 2.4)?.edits.music[0].volume).toBe(2);
    expect(setVolume(scene(before, pick), { kind: "music", id: "m1" }, -0.1)?.edits.music[0].volume).toBe(0);
  });

  test("a media Segment's volume is rounded and kept within 0–200% too", () => {
    const video = segment("v1", 0, 4, { media: "clip", volume: 1 });
    const before = edits({ segments: [segment("s1", 100, 110), video] });

    expect(setVolume(scene(before, null), { kind: "segment", id: "v1" }, 1.256)).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110), { ...video, volume: 1.26 }] },
      pick: null,
    });
    expect(setVolume(scene(before, null), { kind: "segment", id: "v1" }, 7)?.edits.segments[1].volume).toBe(2);
  });

  test("a Source Segment has no volume of its own to set here, and an item that isn't there has none", () => {
    const before = edits({ segments: [segment("s1", 100, 110), segment("v1", 0, 4, { media: "clip" })] });

    expect(setVolume(scene(before, null), { kind: "segment", id: "s1" }, 0.5)).toBeNull();
    expect(setVolume(scene(before, null), { kind: "music", id: "gone" }, 0.5)).toBeNull();
  });
});

describe("setting a Music Clip's fades", () => {
  test("a fade dragged past 10 s stops at 10, and below 0 at 0, rounded to a hundredth; the Pick stays", () => {
    const before = edits({ music: [music("m1", 0, 30, { fade_in: 0, fade_out: 0 }), music("m2", 2, 5)] });
    const pick = picked({ kind: "music", id: "m2" });

    expect(setFade(scene(before, pick), "m1", "fade_in", 12.5)).toEqual({
      edits: { ...before, music: [music("m1", 0, 30, { fade_in: 10, fade_out: 0 }), music("m2", 2, 5)] },
      pick,
    });
    expect(setFade(scene(before, pick), "m1", "fade_out", 3.456)?.edits.music[0].fade_out).toBe(3.46);
    expect(setFade(scene(before, pick), "m2", "fade_out", -1)?.edits.music[1]).toEqual(music("m2", 2, 5, { fade_out: 0 }));
  });

  test("a fade in that would cross the fade out is cut to what is left of the Clip, and the other way round", () => {
    // 10 s long, fading out over the last 3 s.
    const before = edits({ music: [music("m", 0, 10, { fade_in: 1, fade_out: 3 })] });

    expect(setFade(scene(before, null), "m", "fade_in", 9)?.edits.music).toEqual([music("m", 0, 10, { fade_in: 7, fade_out: 3 })]);
    expect(setFade(scene(before, null), "m", "fade_out", 9.5)?.edits.music).toEqual([music("m", 0, 10, { fade_in: 1, fade_out: 9 })]);
  });

  test("on a Music Clip cut short by the Clip's end, a fade is set within what is heard, and the other kept as heard", () => {
    // 10 s long, but the Clip ends 6 s into it: its 4 s fades are heard as 3 s each.
    const before = edits({ music: [music("m", 0, 10, { fade_in: 4, fade_out: 4 })] });

    expect(setFade(scene(before, null), "m", "fade_in", 2, 6)?.edits.music).toEqual([music("m", 0, 10, { fade_in: 2, fade_out: 3 })]);
    expect(setFade(scene(before, null), "m", "fade_in", 5, 6)?.edits.music).toEqual([music("m", 0, 10, { fade_in: 3, fade_out: 3 })]);
  });

  test("fades are heard as the planner hears them (its worked examples in backend/tests/test_music.py)", () => {
    // Fitting: as they are. Twice as long as the Music Clip: halved. A 4 s Clip cut to 3 s: 3/4 each.
    expect(fadesWithin({ fade_in: 3, fade_out: 0.5 }, 4)).toEqual({ fade_in: 3, fade_out: 0.5 });
    expect(fadesWithin({ fade_in: 3, fade_out: 3 }, 2)).toEqual({ fade_in: 1, fade_out: 1 });
    expect(fadesWithin({ fade_in: 3, fade_out: 1 }, 3)).toEqual({ fade_in: 2.25, fade_out: 0.75 });
  });

  test("a Music Clip that isn't there has no fades to set", () => {
    expect(setFade(scene(edits(), null), "gone", "fade_in", 2)).toBeNull();
  });

  test("trimming a Music Clip below the sum of its fades shortens them, keeping their shares", () => {
    const before = edits({ music: [music("m", 0, 10, { fade_in: 6, fade_out: 2 })] });

    // Trimmed to 4 s: the 8 s of fades become 3 s and 1 s.
    expect(changeMusic(scene(before, null), music("m", 0, 4, { fade_in: 6, fade_out: 2 })).edits.music).toEqual([
      music("m", 0, 4, { fade_in: 3, fade_out: 1 }),
    ]);
    // Moved, or trimmed with room for them, its fades stay.
    expect(changeMusic(scene(before, null), music("m", 5, 8, { fade_in: 6, fade_out: 2 })).edits.music).toEqual([
      music("m", 5, 8, { fade_in: 6, fade_out: 2 }),
    ]);
  });

  test("a Music Clip cut short by the Main Track, or split, keeps its fades within it", () => {
    // s1 plays 0–10 s, s2 10–15 s; the song from 6 to 14 s fades in over 3 s and out over 3 s.
    const before = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205)], music: [music("song", 6, 8, { fade_in: 3, fade_out: 3 })] });

    // s2 removed: the song keeps 6–10 s, 4 s for the 6 s of fades.
    expect(remove({ ...scene(before, picked(seg("s2"))), magnetic: true })?.edits.music).toEqual([music("song", 6, 4, { fade_in: 2, fade_out: 2 })]);
    // Split at 7 s: its first second can't fade in for 3.
    expect(split(scene(before, picked({ kind: "music", id: "song" })), 7)?.edits.music).toEqual([
      music("song", 6, 1, { fade_in: 1, fade_out: 0 }),
      music("n1", 7, 7, { offset: 1, fade_in: 0, fade_out: 3 }),
    ]);
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
  // A Scene of 200–210 s framed by hand.
  const byHand: LayoutOverride = { at: 205, layout: "manual", framing: { transform: { ...IDENTITY, x: 300, scale: 2 }, crop: NO_CROP, background: BLURRED } };
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
    layout_overrides: [byHand, { at: 102, layout: "blur" }],
  });
  const held = copy(scene(source, picked(seg("s2"))), here)!;

  test("Segments of the Source bring their range's Word Edits and Layout Overrides, with their Framings, to another Candidate", () => {
    const target = edits({ segments: [segment("t1", 300, 306)] });

    const pasted = paste(scene(target, null), held, 6, { job: "j1", candidate: "c2" }, words).edits;

    expect(pasted.word_edits).toEqual([
      { at: 201.2, text: "Gojek", break_before: false },
      { at: 202.1, text: "", break_before: false },
    ]);
    expect(pasted.layout_overrides).toEqual([byHand]);
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

describe("the magnetic timeline", () => {
  // Three Segments played back to back: s1 from 0 to 10 s, s2 from 10 to 15 s and s3 from 15 to 25 s.
  const three = (changes: Partial<AdvancedEdits> = {}) =>
    edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)], ...changes });
  const magnetic = (context: PickContext): PickContext => ({ ...context, magnetic: true });

  test("removing a Segment moves the layers after it up by its length, and cuts those across it", () => {
    const before = three({
      hook_start: 11,
      hook_secs: 3,
      text_layers: [layer("before", 2, 3), layer("after", 16, 2), layer("across", 8, 4), layer("inside", 11, 2), layer("sliver", 9.95, 1)],
      music: [music("song", 13, 4, { offset: 20 })],
    });

    const outcome = remove(magnetic(scene(before, picked(seg("s2")))));

    expect(outcome?.edits).toEqual({
      ...before,
      segments: [segment("s1", 100, 110), segment("s3", 300, 310)],
      // The hook was wholly inside the cut: it starts at the join, as long as it was.
      hook_start: 10,
      hook_secs: 3,
      text_layers: [layer("before", 2, 3), layer("after", 11, 2), layer("across", 8, 2)],
      // Its start was cut: it starts at the join, 2 s further into its song.
      music: [music("song", 10, 2, { offset: 22 })],
    });
    expect(outcome?.notice).toBe("2 Text Layers inside the cut were removed.");
  });

  test("off, removing a Segment leaves the layers where they are", () => {
    const before = three({ text_layers: [layer("after", 16, 2)] });

    expect(remove(scene(before, picked(seg("s2"))))?.edits.text_layers).toEqual([layer("after", 16, 2)]);
  });

  test("removing several Segments moves each layer by what was cut before it", () => {
    const before = three({ text_layers: [layer("in s3", 16, 2), layer("in s2", 12, 1)] });

    const outcome = remove(magnetic(scene(before, picked(seg("s1"), seg("s3")))));

    // s1's 10 s are cut from before both; the one in s3 went with it.
    expect(outcome?.edits.text_layers).toEqual([layer("in s2", 2, 1)]);
    expect(outcome?.notice).toBe("1 Text Layer inside the cut was removed.");
  });

  test("a Segment that hands over through a Transition cuts out only what it played", () => {
    const before = three({ transitions: [{ after: "s2", kind: "fade", secs: 1 }], text_layers: [layer("after", 20, 2)] });
    // s3 starts 1 s early, under the Transition: s2 plays from 10 to 14 s.
    const played = [
      { start: 0, end: 10, source_start: 100, source_end: 110, media: null, volume: 1 },
      { start: 10, end: 14, source_start: 200, source_end: 204, media: null, volume: 1 },
      { start: 14, end: 24, source_start: 300, source_end: 310, media: null, volume: 1 },
    ];

    const outcome = remove({ ...magnetic(scene(before, picked(seg("s2")))), played, duration: 24 });

    expect(outcome?.edits.text_layers).toEqual([layer("after", 16, 2)]);
  });

  test("the hook across a cut keeps at least its shortest length", () => {
    const before = three({ hook_start: 9.8, hook_secs: 3 });

    expect(remove(magnetic(scene(before, picked(seg("s2")))))?.edits).toMatchObject({ hook_start: 9.8, hook_secs: 0.5 });
  });
});

describe("inserting and trimming Segments", () => {
  const three = () => edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)] });
  const lengthOf = () => Infinity;

  test("a Segment added at the playhead goes after the one playing there, picked", () => {
    const before = three();
    const context = scene(before, null);

    expect(insertSegment(context, segment("x", 400, 402), placeAfter(context.played, 12))).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("x", 400, 402), segment("s3", 300, 310)] },
      pick: picked(seg("x")),
    });
  });

  test("a Segment added past the Clip's end goes last, and one dropped goes where its time falls", () => {
    const context = scene(three(), null);

    expect(placeAfter(context.played, 30)).toBe(3);
    // Dropped at 6 s: after s1, whose middle is at 5 s; before s2, whose middle is at 12.5 s.
    expect(placeDropped(context.played, 6)).toBe(1);
    expect(insertSegment(context, segment("x", 400, 402), 0).edits.segments.map((s) => s.id)).toEqual(["x", "s1", "s2", "s3"]);
  });

  test("a trim drag's steps are each made from where the drag began", () => {
    const before = three();
    const context = scene(before, null);
    const origin = { edits: before, shown: context.played, planned: context.played };
    // s2's end, drawn at 15 s, dragged to 14 s and then to 13 s.
    const first = dragSegment(context, origin, "s2", { start: 10, end: 14, edge: "end" }, lengthOf);
    const second = dragSegment(scene(first.edits, null), origin, "s2", { start: 10, end: 13, edge: "end" }, lengthOf);

    expect(second.edits.segments).toEqual([segment("s1", 100, 110), segment("s2", 200, 203), segment("s3", 300, 310)]);
    expect(second.edits).toEqual(dragSegment(context, origin, "s2", { start: 10, end: 13, edge: "end" }, lengthOf).edits);
  });
});

describe("the magnetic timeline, as Segments are trimmed or put in", () => {
  const three = (changes: Partial<AdvancedEdits> = {}) =>
    edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)], ...changes });
  const magnetic = (context: PickContext): PickContext => ({ ...context, magnetic: true });
  const lengthOf = () => Infinity;
  const trim = (context: PickContext, change: { start: number; end: number; edge: "move" | "start" | "end" }) =>
    dragSegment(context, { edits: context.edits, shown: context.played, planned: context.played }, "s2", change, lengthOf).edits;

  test("trimming a Segment's end shorter moves the later layers up, and longer moves them back", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });
    const context = magnetic(scene(before, null));

    // s2's end from 15 s to 13 s, then to 17 s.
    expect(trim(context, { start: 10, end: 13, edge: "end" }).text_layers).toEqual([layer("later", 14, 2)]);
    expect(trim(context, { start: 10, end: 17, edge: "end" }).text_layers).toEqual([layer("later", 18, 2)]);
  });

  test("trimming a Segment's start later cuts out what it no longer shows", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });

    expect(trim(magnetic(scene(before, null)), { start: 11, end: 15, edge: "start" }).text_layers).toEqual([layer("later", 15, 2)]);
  });

  test("a trim drag's steps move the layers from where they were when it began", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });
    const context = magnetic(scene(before, null));
    const origin = { edits: before, shown: context.played, planned: context.played };
    const first = dragSegment(context, origin, "s2", { start: 10, end: 14, edge: "end" }, lengthOf);
    const second = dragSegment(magnetic(scene(first.edits, null)), origin, "s2", { start: 10, end: 13, edge: "end" }, lengthOf);

    expect(second.edits.text_layers).toEqual([layer("later", 14, 2)]);
  });

  test("reordering a Segment moves no layer", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });

    expect(trim(magnetic(scene(before, null)), { start: 20, end: 25, edge: "move" }).text_layers).toEqual([layer("later", 16, 2)]);
  });

  test("a Segment put in moves the layers after it back, and leaves those across it", () => {
    const before = three({ text_layers: [layer("later", 16, 2), layer("across", 14, 2)] });
    const context = magnetic(scene(before, null));

    // After s2, at 15 s, 2 s long.
    expect(insertSegment(context, segment("x", 400, 402), 2).edits.text_layers).toEqual([layer("later", 18, 2), layer("across", 14, 2)]);
  });

  test("duplicated Segments move the layers after them back by the copies' length", () => {
    const before = three({ text_layers: [layer("later", 16, 2)], hook_start: 20 });

    const outcome = duplicate(magnetic(scene(before, picked(seg("s2")))));

    expect(outcome?.edits).toMatchObject({ text_layers: [layer("later", 21, 2)], hook_start: 25 });
  });

  test("pasted Segments move the layers after their join back; the pasted layers land as pasted", () => {
    const source = edits({ segments: [segment("c", 500, 505)], text_layers: [layer("t", 1, 1)] });
    const clipboard = copy(scene(source, picked(seg("c"), text("t"))), { job: "j", candidate: "one" })!;
    const before = three({ text_layers: [layer("early", 2, 1), layer("later", 16, 2)] });

    // At 15 s, the join after s2: the 5 s pasted go in there.
    const outcome = paste(magnetic(scene(before, null)), clipboard, 15, { job: "j", candidate: "two" });

    expect(outcome.edits.segments.map((s) => s.id)).toEqual(["s1", "s2", "n1", "s3"]);
    expect(outcome.edits.text_layers).toEqual([layer("early", 2, 1), layer("later", 21, 2), layer("n2", 16, 1, { text: "t" })]);
  });

  test("off, trimming, putting in, duplicating and pasting Segments leave the layers where they are", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });
    const context = scene(before, picked(seg("s2")));
    const clipboard = copy(scene(edits({ segments: [segment("c", 500, 505)] }), picked(seg("c"))), { job: "j", candidate: "one" })!;

    expect(trim(context, { start: 10, end: 13, edge: "end" }).text_layers).toEqual(before.text_layers);
    expect(insertSegment(context, segment("x", 400, 402), 2).edits.text_layers).toEqual(before.text_layers);
    expect(duplicate(context)?.edits.text_layers).toEqual(before.text_layers);
    expect(paste(context, clipboard, 15, { job: "j", candidate: "two" }).edits.text_layers).toEqual(before.text_layers);
  });
});

describe("ripple delete", () => {
  const three = (changes: Partial<AdvancedEdits> = {}) =>
    edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)], ...changes });

  test("closes the gap after a Segment even with the Magnetic timeline off", () => {
    const before = three({ text_layers: [layer("later", 16, 2)] });

    expect(rippleRemove(scene(before, picked(seg("s2"))))?.edits.text_layers).toEqual([layer("later", 11, 2)]);
  });

  test("closes a Text Layer's Track behind it, leaving those over it and the other kinds where they are", () => {
    const before = three({
      text_layers: [layer("gone", 2, 3), layer("over it", 4, 3), layer("next", 6, 1), layer("last", 20, 2)],
      music: [music("song", 8, 2)],
    });

    const outcome = rippleRemove(scene(before, picked(text("gone"))));

    expect(outcome).toEqual({
      edits: { ...before, text_layers: [layer("over it", 4, 3), layer("next", 3, 1), layer("last", 17, 2)] },
      pick: null,
    });
  });

  test("a mixed Pick closes each Track and the layers follow the Segments, in one change", () => {
    const before = three({ music: [music("gone", 0, 2), music("later", 18, 2)], text_layers: [layer("title", 16, 1)] });

    const outcome = rippleRemove(scene(before, picked(seg("s2"), { kind: "music", id: "gone" })));

    // The song after it moves up 2 s for the song and 5 s for s2; the title only for s2.
    expect(outcome?.edits).toMatchObject({ music: [music("later", 11, 2)], text_layers: [layer("title", 11, 1)] });
    expect(outcome?.edits.segments.map((s) => s.id)).toEqual(["s1", "s3"]);
  });

  test("does nothing to the hook alone, as Delete doesn't", () => {
    expect(rippleRemove(scene(three(), { kind: "hook" }))).toBeNull();
  });
});

describe("split all", () => {
  const before = edits({
    segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
    hook_start: 0,
    hook_secs: 6,
    text_layers: [layer("under", 3, 4), layer("away", 8, 1)],
    music: [music("song", 0, 12, { offset: 5 })],
    overlays: [overlay("pip", 4, 2)],
  });

  test("with nothing picked, cuts every Segment, Text Layer, Music Clip and Overlay under the playhead, and picks their second parts", () => {
    // The playhead at 5 s, 105 s into the Source, inside a Word: the silence nearest it is at 105.2.
    const gap = (time: number) => (time === 105 ? 105.2 : time);

    const outcome = splitAt(scene(before, null, gap), 5);

    expect(outcome?.edits).toEqual({
      ...before,
      segments: [segment("s1", 100, 105.2), segment("n1", 105.2, 110), segment("s2", 200, 205)],
      text_layers: [layer("under", 3, 2), layer("n2", 5, 2, { text: "under" }), layer("away", 8, 1)],
      music: [music("song", 0, 5, { offset: 5, fade_out: 0 }), music("n3", 5, 7, { offset: 10, fade_in: 0 })],
      overlays: [overlay("pip", 4, 1), { ...overlay("n4", 5, 1), offset: 1 }],
    });
    // The hook isn't cut.
    expect(outcome?.edits.hook_secs).toBe(6);
    expect(outcome?.pick).toEqual(picked(seg("n1"), text("n2"), { kind: "music", id: "n3" }, { kind: "overlay", id: "n4" }));
  });

  test("with something picked, cuts only that", () => {
    const outcome = splitAt(scene(before, picked(text("under"))), 5);

    expect(outcome?.edits.segments).toEqual(before.segments);
    expect(outcome?.pick).toEqual(picked(text("n1")));
  });

  test("can split with nothing picked wherever something is under the playhead, but not with the hook picked", () => {
    expect(canSplitAt(scene(before, null), 5)).toBe(true);
    expect(canSplitAt(scene(edits({ segments: [segment("s1", 100, 110)] }), null), 10)).toBe(false);
    expect(canSplitAt(scene(before, { kind: "hook" }), 5)).toBe(false);
  });
});

describe("locked Tracks", () => {
  const before = edits({
    segments: [segment("s1", 100, 110), segment("s2", 200, 205)],
    text_layers: [layer("title", 3, 4)],
    music: [music("song", 0, 12)],
  });

  test("their items drop out of any Pick: select all, a rubber band or a lock while picked", () => {
    expect(unlockedPick(pickAll(before), ["text", "video"])).toEqual(picked({ kind: "music", id: "song" }));
    const band = bandPick(null, [{ key: "text:title", left: 0, right: 10, top: 0, bottom: 10 }], { left: 0, right: 20, top: 0, bottom: 20 }, false);
    expect(unlockedPick(band, ["text"])).toBeNull();
  });

  test("the hook, the captions and a join are dropped when their Track is locked", () => {
    expect(unlockedPick({ kind: "hook" }, ["hook"])).toBeNull();
    expect(unlockedPick({ kind: "captions" }, ["hook"])).toEqual({ kind: "captions" });
    expect(unlockedPick({ kind: "join", after: "s1" }, ["video"])).toBeNull();
  });

  test("split all skips them, but not hidden ones", () => {
    const outcome = splitAt({ ...scene(before, null), locked: ["video", "music"] }, 5);

    expect(outcome?.edits.segments).toEqual(before.segments);
    expect(outcome?.edits.music).toEqual(before.music);
    expect(outcome?.pick).toEqual(picked(text("n1")));
  });

  test("a paste leaves out their items, and says so", () => {
    const clipboard = copy(scene(before, picked(seg("s2"), text("title"), { kind: "music", id: "song" })), { job: "j", candidate: "one" })!;

    const outcome = paste({ ...scene(before, null), locked: ["text", "video"] }, clipboard, 2, { job: "j", candidate: "one" });

    expect(outcome.edits.segments).toEqual(before.segments);
    expect(outcome.edits.text_layers).toEqual(before.text_layers);
    expect(outcome.edits.music).toHaveLength(2);
    // The song, 12 s from 2 s, is also cut short at the Clip's end.
    expect(outcome.notice).toBe("1 item cut short to fit. 1 Segment and 1 Text Layer left out: their Tracks are locked.");
  });

  test("their layers still follow the Main Track", () => {
    const outcome = remove({
      ...scene(edits({ ...before, text_layers: [layer("title", 12, 1)] }), picked(seg("s1"))),
      magnetic: true,
      locked: ["text"],
    });

    expect(outcome?.edits.text_layers).toEqual([layer("title", 2, 1)]);
  });
});

describe("the clip editor's trim, on the Magnetic timeline", () => {
  // A Clip from 100 to 120 s of the Source, with a title at 5 s and the hook at 1 s.
  const layers = { text_layers: [layer("title", 5, 2)], music: [music("song", 0, 20, { offset: 3 })], overlays: [], hook_start: 1, hook_secs: 3 };
  const range = { start: 100, end: 120 };

  test("a start 2 s later moves everything up 2 s, cutting what it took", () => {
    expect(clipTrimmed(layers, range, { start: 102, end: 120 }).layers).toEqual({
      ...layers,
      text_layers: [layer("title", 3, 2)],
      music: [music("song", 0, 18, { offset: 5 })],
      hook_start: 0,
      hook_secs: 2,
    });
  });

  test("a start 2 s earlier moves everything back 2 s", () => {
    expect(clipTrimmed(layers, range, { start: 98, end: 120 }).layers).toMatchObject({ text_layers: [layer("title", 7, 2)], hook_start: 3 });
  });

  test("an end earlier cuts what it took, and tells of what went", () => {
    const outcome = clipTrimmed(layers, range, { start: 100, end: 106 });

    expect(outcome.layers).toMatchObject({ text_layers: [layer("title", 5, 1)], music: [music("song", 0, 6, { offset: 3 })] });
    expect(clipTrimmed(layers, range, { start: 100, end: 104 }).notice).toBe("1 Text Layer inside the cut was removed.");
  });

  test("an end later moves nothing", () => {
    expect(clipTrimmed(layers, range, { start: 100, end: 125 }).layers).toEqual(layers);
  });
});

describe("the magnetic timeline at the Clip's end", () => {
  const three = (changes: Partial<AdvancedEdits> = {}) =>
    edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)], ...changes });

  test("the hook inside a removed last Segment ends where the Clip now ends, rather than after it", () => {
    const before = three({ hook_start: 18, hook_secs: 3 });

    expect(remove({ ...scene(before, picked(seg("s3"))), magnetic: true })?.edits).toMatchObject({ hook_start: 12, hook_secs: 3 });
  });

  test("the hook inside an end trimmed off in the clip editor ends at the new end", () => {
    const layers = { text_layers: [], music: [], overlays: [], hook_start: 15, hook_secs: 3 };

    expect(clipTrimmed(layers, { start: 100, end: 120 }, { start: 100, end: 110 }).layers).toMatchObject({ hook_start: 7, hook_secs: 3 });
  });

  test("duplicating a Segment with a layer copies the layer right after the moved original", () => {
    const before = three({ text_layers: [layer("title", 16, 2)] });

    const outcome = duplicate({ ...scene(before, picked(seg("s2"), text("title"))), magnetic: true });

    // s2's copy puts 5 s in at 15 s: the title moves to 21 s, its copy right after it.
    expect(outcome?.edits.text_layers).toEqual([layer("title", 21, 2), layer("n2", 23, 2, { text: "title" })]);
  });
});

