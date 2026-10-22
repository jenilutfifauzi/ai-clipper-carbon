// .scratch/background-removal/issues/08-matte-housekeeping.md: a Segment's Background removal (ADR
// 0015) moves with it like any other field, and so does an Overlay's `behind`. Copy and paste, duplicate, Split (both parts, which read
// the same Matte pieces) and the Revision merge carry it.
import { describe, expect, test } from "vitest";
import type { BackgroundRemoval, ClipSegment, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { mergeEdits } from "../editor/merge";
import { playedFrom } from "../editor/playback";
import { duplicate, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const cut: BackgroundRemoval = { subject: "person", feather: 12 };
const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const seg = (id: string) => ({ kind: "segment" as const, id });

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
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
    segments: [segment("s1", 100, 110, { background_removal: cut }), segment("s2", 200, 210)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}` };
}

const removals = (state: AdvancedEdits) => state.segments.map((each) => each.background_removal ?? null);

describe("moving a cut-out Segment", () => {
  test("copy and paste carry it, into another Candidate of the Job too", () => {
    const copied = copy(scene(edits(), picked(seg("s1"), seg("s2"))), { job: "j1", candidate: "c1" })!;
    const into = edits({ segments: [segment("s3", 300, 310)] });
    for (const to of [{ job: "j1", candidate: "c1" }, { job: "j1", candidate: "c2" }]) {
      expect(removals(paste(scene(into), copied, 0, to).edits)).toEqual([cut, null, null]);
    }
  });

  test("duplicate carries it", () => {
    expect(removals(duplicate(scene(edits(), picked(seg("s1"))))!.edits)).toEqual([cut, cut, null]);
  });

  test("both parts of a Split keep it", () => {
    expect(removals(split(scene(edits(), picked(seg("s1"))), 4)!.edits)).toEqual([cut, cut, null]);
  });

  test("the Revision merge keeps theirs where I changed something else, and mine where I changed it", () => {
    const base = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210)] });
    const theirs = edits();
    const mine = { ...base, segments: [base.segments[0], segment("s2", 200, 208)] };
    expect(mergeEdits(base, mine, theirs)).toEqual({ merged: { ...theirs, segments: [theirs.segments[0], mine.segments[1]] }, collisions: [] });

    const softer = { ...base, segments: [segment("s1", 100, 110, { background_removal: { ...cut, feather: 2 } }), base.segments[1]] };
    expect(removals(mergeEdits(base, softer, theirs).merged)).toEqual([{ ...cut, feather: 2 }, null]);
    // Switched off on my side, left on theirs as it was: off.
    expect(removals(mergeEdits(theirs, base, theirs).merged)).toEqual([null, null]);
  });
});

// An Overlay Behind the Main Track (ticket 05) moves with its field as well.
describe("moving an Overlay Behind the Main Track", () => {
  const under: Overlay = {
    id: "o",
    media: "clip",
    start: 2,
    secs: 4,
    offset: 0,
    transform: { x: 540, y: 400, scale: 0.5, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1 },
    crop: NO_CROP,
    volume: 0,
    radius: 0,
    border: null,
    shadow: null,
    keys: {},
    behind: true,
  };
  const over = (id: string): Overlay => ({ ...under, id, behind: undefined });
  const ref = { kind: "overlay" as const, id: "o" };
  const behinds = (state: AdvancedEdits) => state.overlays.map((each) => each.behind ?? false);

  test("copy and paste, duplicate and both parts of a Split keep it", () => {
    const state = edits({ overlays: [under] });
    const copied = copy(scene(state, picked(ref)), { job: "j1", candidate: "c1" })!;
    expect(behinds(paste(scene(edits({ overlays: [over("p")] })), copied, 0, { job: "j1", candidate: "c2" }).edits)).toEqual([false, true]);
    expect(behinds(duplicate(scene(state, picked(ref)))!.edits)).toEqual([true, true]);
    expect(behinds(split(scene(state, picked(ref)), 4)!.edits)).toEqual([true, true]);
  });

  test("the Revision merge keeps mine where I moved it, and theirs where I changed something else", () => {
    const base = edits({ overlays: [over("o"), over("p")] });
    expect(behinds(mergeEdits(base, edits({ overlays: [under, over("p")] }), base).merged)).toEqual([true, false]);
    const mine = edits({ overlays: [over("o"), { ...over("p"), secs: 3 }] });
    expect(behinds(mergeEdits(base, mine, edits({ overlays: [under, over("p")] })).merged)).toEqual([true, false]);
  });
});
