// Blend Modes for Overlays (.scratch/video-effects/issues/07-overlay-blend-mode.md, ADR 0014): the
// Inspector's menu on one Overlay or several, the mode carried by split, duplicate, the Clipboard and
// the Revision merge, and the preview's mix-blend-mode.
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { BlendMode, ClipSegment, Overlay, Picture } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { mergeEdits } from "../editor/merge";
import { PicturePanel } from "../editor/PicturePanel";
import { playedFrom } from "../editor/playback";
import { mixBlendMode } from "../editor/videoEffects";
import { duplicate, setBlend, sharedBlend, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const overlay = (id: string, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "clip",
  start: 0,
  secs: 8,
  offset: 0,
  transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
  crop: NO_CROP,
  volume: 1,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});

function edits(overlays: Overlay[], segments: ClipSegment[] = [{ id: "s1", start: 100, end: 110 }]): AdvancedEdits {
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
    overlays,
    transitions: [],
  };
}

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

const blends = (state: AdvancedEdits) => state.overlays.map((each) => each.blend);
const one = picked({ kind: "overlay", id: "a" });
const both = picked({ kind: "overlay", id: "a" }, { kind: "overlay", id: "b" });

describe("the Inspector's Blend Mode menu", () => {
  test("shows one Overlay's mode, Normal when missing, and several's when equal, else Mixed", () => {
    const state = edits([overlay("a", { blend: "screen" }), overlay("b")]);
    expect(sharedBlend({ edits: state, pick: one })).toBe("screen");
    expect(sharedBlend({ edits: state, pick: picked({ kind: "overlay", id: "b" }) })).toBe("normal");
    expect(sharedBlend({ edits: state, pick: both })).toBe("mixed");
    // A Segment picked with an Overlay: the Overlay's.
    expect(sharedBlend({ edits: state, pick: picked({ kind: "segment", id: "s1" }, { kind: "overlay", id: "a" }) })).toBe("screen");
    expect(sharedBlend({ edits: state, pick: picked({ kind: "segment", id: "s1" }) })).toBeNull();
  });

  test("sets the mode on every picked Overlay as one change, Normal leaving it without the field", () => {
    const state = edits([overlay("a", { blend: "screen" }), overlay("b"), overlay("c")]);
    const multiplied = setBlend({ edits: state, pick: both }, "multiply")!;
    expect(blends(multiplied.edits)).toEqual(["multiply", "multiply", undefined]);
    const normal = setBlend({ edits: multiplied.edits, pick: both }, "normal")!;
    expect(normal.edits.overlays.some((each) => "blend" in each)).toBe(false);
    expect(setBlend({ edits: normal.edits, pick: both }, "normal")).toBeNull();
    expect(setBlend({ edits: state, pick: picked({ kind: "segment", id: "s1" }) }, "screen")).toBeNull();
  });
});

describe("the Blend Mode goes with its Overlay", () => {
  test("Split gives it to both parts, Duplicate to the copy, and copy and paste carry it", () => {
    const state = edits([overlay("a", { blend: "screen" })]);
    expect(blends(split(scene(state, one), 4)!.edits)).toEqual(["screen", "screen"]);
    expect(blends(duplicate(scene(state, one))!.edits)).toEqual(["screen", "screen"]);
    const copied = copy(scene(state, one), { job: "j1", candidate: "c1" })!;
    expect(blends(paste(scene(edits([])), copied, 0, { job: "j1", candidate: "c2" }).edits)).toEqual(["screen"]);
  });

  test("the Revision merge takes a mode set on the other side, and mine on a collision", () => {
    const base = { overlays: [overlay("a"), overlay("b")] };
    const mine = { overlays: [overlay("a", { blend: "screen" }), overlay("b")] };
    const theirs = { overlays: [overlay("a"), overlay("b", { blend: "multiply" })] };
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { overlays: [mine.overlays[0], theirs.overlays[1]] }, collisions: [] });
    const other = { overlays: [overlay("a", { blend: "darken" }), overlay("b")] };
    expect(mergeEdits(base, mine, other)).toEqual({ merged: mine, collisions: [{ field: "overlays", item: "a" }] });
  });
});

describe("the preview", () => {
  test("draws each mode with the CSS mix-blend-mode the render matches, Add as plus-lighter", () => {
    const modes: BlendMode[] = ["normal", "multiply", "screen", "add", "lighten", "darken"];
    expect(modes.map(mixBlendMode)).toEqual([undefined, "multiply", "screen", "plus-lighter", "lighten", "darken"]);
    expect(mixBlendMode(undefined)).toBeUndefined();
  });

  test("on the Overlay's outer element, so that its shadow and opacity are blended with it", () => {
    const picture: Picture = {
      centre: [540, 400], width: 540, height: 304, rotation: 0, flip_h: false, flip_v: false, opacity: 1, motion: {},
      crop: { x: 0, y: 0, width: 320, height: 180 }, item_size: [320, 180], radius: 0, border: null, shadow: null,
    } as unknown as Picture;
    const drawn = (blend?: BlendMode) =>
      renderToStaticMarkup(createElement(PicturePanel, { picture, frame: { width: 1080, height: 1920 }, media: null, blend }));
    expect(drawn("screen")).toMatch(/^<div[^>]*style="[^"]*mix-blend-mode:screen/);
    expect(drawn()).not.toContain("mix-blend-mode");
  });
});
