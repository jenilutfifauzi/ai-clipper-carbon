// .scratch/captions-advanced/issues/07-tracer-pick-a-cue-and-retime-it.md: a Cue picked on the
// Captions Track is retimed by its edges and body, as worked examples of the Cue Edits they leave.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Cue, CueEdit, CueKey, RenderPlan, SegmentPlan } from "../../../api";
import { mergeEdits } from "../editor/merge";
import { playedFrom } from "../editor/playback";
import { copy, paste } from "./clipboard";
import { cueEditOf, cueOf, resetCueTiming, retimeCue, type CueScene } from "./cueEdits";
import type { AdvancedEdits } from "./edits";
import { picked, prunedCue, unlockedPick, type Pick } from "./pick";

const cue = (start: number, end: number, at: number, changes: Partial<Cue> = {}): Cue => ({
  start,
  end,
  lines: [[{ text: "HALO", start, end }]],
  plain: ["halo"],
  area: { x: 40, y: 1296, width: 1000, height: 200 },
  size: 110,
  key: { at, media: null },
  edited: false,
  joinable: false,
  needs_join: false,
  low: 0,
  high: 5,
  speed: 1,
  word_ats: [at],
  cue_edit_ats: [null],
  ...changes,
});

const segmentPlan = (id: string, start: number, end: number, source_start: number, changes: Partial<SegmentPlan> = {}): SegmentPlan => ({
  id,
  start,
  end,
  source_start,
  source_end: source_start + (end - start) * (changes.speed ?? 1),
  media: null,
  volume: 1,
  silent: false,
  scenes: 1,
  gain: [],
  ...changes,
});

// A plan of `captions` over a Clip of `segments` (one range of 5 s when there are none).
const plan = (captions: Cue[], segments: SegmentPlan[] = [], end = 105): RenderPlan =>
  ({ start: 100, end, captions, segments, transitions: [], unused_cue_edits: [], cue_min_secs: 0.2 }) as unknown as RenderPlan;

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });

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
    segments: [segment("s1", 100, 105)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

const edit = (at: number, changes: Partial<CueEdit> = {}): CueEdit => ({ at, media: null, shift: 0, start_delta: 0, end_delta: 0, join: false, ...changes });

// "halo semua" from 1.0 to 2.3 s, "apa kabar" from 3.0 to 3.9 s, of a Clip from 100 s lasting 5 s,
// each with the bounds the planner gives it.
const TALK = [cue(1.0, 2.3, 101.2, { high: 3.0 }), cue(3.0, 3.9, 103.1, { low: 2.3 })];
const FIRST: CueKey = { at: 101.2, media: null };
const SECOND: CueKey = { at: 103.1, media: null };

const scene = (state: AdvancedEdits, captions = TALK, segments: SegmentPlan[] = [], locked: CueScene["locked"] = []): CueScene => ({
  edits: state,
  plan: plan(captions, segments),
  locked,
});

describe("a picked Cue on the Captions Track", () => {
  test("is shown from its start to its end, kept where the plan says a Cue Edit keeps it", () => {
    expect(cueOf(plan(TALK), SECOND)).toMatchObject({ start: 3.0, end: 3.9, low: 2.3, high: 5, speed: 1, minSecs: 0.2 });
    expect(cueOf(plan(TALK), FIRST)).toMatchObject({ low: 0, high: 3.0 });
    // Moved at a Layout change it is two entries keyed alike: one Cue.
    const moved = [cue(1.0, 1.5, 101.2, { high: 3.0 }), cue(1.5, 2.3, 101.2, { high: 3.0 }), TALK[1]];
    expect(cueOf(plan(moved), FIRST)).toMatchObject({ start: 1.0, end: 2.3, low: 0, high: 3.0 });
    expect(cueOf(plan(TALK), { at: 9, media: null })).toBeNull();
    // The bounds are the plan's, not the neighbours' shown times: the next Cue, shown earlier by its
    // Cue Edit, still leaves this one room up to its first Word.
    const earlier = [TALK[0], cue(2.6, 3.9, 103.1, { low: 2.3, edited: true })];
    expect(cueOf(plan(earlier), FIRST)).toMatchObject({ high: 3.0 });
  });

  test("dragged by its body, it writes its Cue Edit's shift, kept between its neighbours", () => {
    const moved = retimeCue(scene(edits()), SECOND, { start: 3.5, end: 4.4, edge: "move" }, null)!;
    expect(moved.edits.cue_edits).toEqual([edit(103.1, { shift: 0.5 })]);
    expect(moved.pick).toEqual({ kind: "cue", key: SECOND });
    // Dropped over the Cue before, it stops at its end, keeping its length.
    const early = retimeCue(scene(edits()), SECOND, { start: 1.5, end: 2.4, edge: "move" }, null)!;
    expect(early.edits.cue_edits).toEqual([edit(103.1, { shift: -0.7 })]);
    // Past the Clip's end, it stops there.
    const late = retimeCue(scene(edits()), SECOND, { start: 4.6, end: 5.5, edge: "move" }, null)!;
    expect(late.edits.cue_edits).toEqual([edit(103.1, { shift: 1.1 })]);
  });

  test("dragged by an edge, it writes that edge's delta, at least 0.2 s long and between its neighbours", () => {
    const start = retimeCue(scene(edits()), SECOND, { start: 2.6, end: 3.9, edge: "start" }, null)!;
    expect(start.edits.cue_edits).toEqual([edit(103.1, { start_delta: -0.4 })]);
    const before = retimeCue(scene(edits()), SECOND, { start: 1.0, end: 3.9, edge: "start" }, null)!;
    expect(before.edits.cue_edits).toEqual([edit(103.1, { start_delta: -0.7 })]);
    const end = retimeCue(scene(edits()), FIRST, { start: 1.0, end: 3.5, edge: "end" }, null)!;
    expect(end.edits.cue_edits).toEqual([edit(101.2, { end_delta: 0.7 })]);
    const short = retimeCue(scene(edits()), FIRST, { start: 1.0, end: 1.05, edge: "end" }, null)!;
    expect(short.edits.cue_edits).toEqual([edit(101.2, { end_delta: -1.1 })]);
  });

  test("goes on from its Cue Edit as the drag began, each step of a drag, and keeps its other fields", () => {
    const begun = edit(103.1, { shift: 0.2, end_delta: 0.1 });
    // Shown at 3.2–4.2 when the drag began; dragged 0.3 s later.
    const shown = [TALK[0], cue(3.2, 4.2, 103.1, { edited: true })];
    const state = edits({ cue_edits: [begun] });
    const moved = retimeCue(scene(state, shown), SECOND, { start: 3.5, end: 4.5, edge: "move" }, { edit: begun, start: 3.2, end: 4.2 })!;
    expect(moved.edits.cue_edits).toEqual([edit(103.1, { shift: 0.5, end_delta: 0.1 })]);
  });

  test("on a 2x Segment, writes its Cue Edit in seconds of the Source: twice what it moved on the Timeline", () => {
    const sped = [segmentPlan("s1", 0, 2, 50, { speed: 2 })];
    const cues = [cue(0.5, 1.0, 51.2, { high: 1.3, speed: 2 }), cue(1.3, 1.8, 52.8, { low: 1.0, high: 2, speed: 2 })];
    const at = { at: 51.2, media: null };
    expect(cueOf(plan(cues, sped), at)).toMatchObject({ speed: 2, low: 0, high: 1.3 });
    const moved = retimeCue(scene(edits(), cues, sped), at, { start: 0.7, end: 1.2, edge: "move" }, null)!;
    expect(moved.edits.cue_edits).toEqual([edit(51.2, { shift: 0.4 })]);
  });

  test("names the Cue Edit the plan matched to it, written at any time in its first Word", () => {
    // Early in a long first Word, further from its key than a Word Edit's reach.
    const own = edit(102.65, { shift: 0.3 });
    const long = [TALK[0], cue(3.3, 4.2, 103.1, { low: 2.3, edited: true, cue_edit_ats: [102.65] })];
    expect(cueEditOf([edit(101.2), own], plan(long), SECOND)).toBe(own);
    // One the plan didn't match to it isn't its own.
    expect(cueEditOf([edit(101.2), edit(103.0)], plan(TALK), SECOND)).toBeNull();
    // An item's Cue Edit isn't the Source's.
    expect(cueEditOf([{ ...own, media: "ab".repeat(16) }], plan(long), SECOND)).toBeNull();
    const moved = retimeCue(scene(edits({ cue_edits: [own] }), long), SECOND, { start: 3.8, end: 4.7, edge: "move" }, null)!;
    expect(moved.edits.cue_edits).toEqual([edit(102.65, { shift: 0.8 })]);
    // Until it is planned again, a Cue Edit written at its key (as a drag writes it) is its own.
    const written = edit(103.1, { shift: 0.2 });
    expect(cueEditOf([written], plan(TALK), SECOND)).toBe(written);
  });

  test("Reset timing clears its timing, dropping its Cue Edit when nothing is left of it", () => {
    const state = edits({ cue_edits: [edit(101.2, { end_delta: 0.4 }), edit(103.1, { shift: 0.5, start_delta: -0.1 })] });
    const reset = resetCueTiming(scene(state), SECOND)!;
    expect(reset.edits.cue_edits).toEqual([edit(101.2, { end_delta: 0.4 })]);
    expect(reset.pick).toEqual({ kind: "cue", key: SECOND });
    // Nothing to reset.
    expect(resetCueTiming(scene(edits()), SECOND)).toBeNull();
  });

  test("a locked Captions Track refuses a drag and Reset timing, and its Cue can't be picked", () => {
    const state = edits({ cue_edits: [edit(103.1, { shift: 0.5 })] });
    const locked = scene(state, TALK, [], ["captions"]);
    expect(retimeCue(locked, SECOND, { start: 3.5, end: 4.4, edge: "move" }, null)).toBeNull();
    expect(resetCueTiming(locked, SECOND)).toBeNull();
    const pick: Pick = { kind: "cue", key: SECOND };
    expect(unlockedPick(pick, ["captions"])).toBeNull();
    expect(unlockedPick(pick, ["video"])).toBe(pick);
  });

  test("drops out of the Pick once no Cue of the plan has its key", () => {
    const pick: Pick = { kind: "cue", key: SECOND };
    expect(prunedCue(pick, plan(TALK))).toBe(pick);
    expect(prunedCue(pick, plan([TALK[0]]))).toBeNull();
    // Without a plan yet, it stays.
    expect(prunedCue(pick, null)).toBe(pick);
  });
});

describe("Cue Edits on the Clipboard", () => {
  const here = { job: "j1", candidate: "c1" };
  const words = [
    { start: 201, end: 201.5 },
    { start: 202, end: 202.6 },
  ];
  const media = "ab".repeat(16);
  const source = edits({
    segments: [segment("s1", 100, 105), segment("s2", 200, 210), segment("m1", 0, 4, { media })],
    cue_edits: [edit(201.2, { shift: 0.3 }), edit(102, { end_delta: 1 }), edit(1.5, { media, start_delta: -0.2 }), edit(1.5, { start_delta: 2 })],
  });
  const pickContext = (state: AdvancedEdits, pick: Pick) => {
    const played = playedFrom(state.segments);
    let n = 0;
    return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time: number) => time, ids: () => `n${++n}` };
  };
  const held = copy(pickContext(source, picked({ kind: "segment", id: "s2" }, { kind: "segment", id: "m1" })), here)!;

  test("Segments copied carry the Cue Edits of their ranges, each on its own timeline", () => {
    expect(held.cue_edits).toEqual([edit(201.2, { shift: 0.3 }), edit(1.5, { media, start_delta: -0.2 })]);
  });

  test("pasted into another Candidate, those it hasn't got at that Word come along; its own are kept", () => {
    const target = edits({ segments: [segment("t1", 300, 306)], cue_edits: [edit(201.4, { shift: -0.1 })] });
    const pasted = paste(pickContext(target, null), held, 6, { job: "j1", candidate: "c2" }, words).edits;
    expect(pasted.cue_edits).toEqual([edit(201.4, { shift: -0.1 }), edit(1.5, { media, start_delta: -0.2 })]);
    // Into another Job only the media Segment comes, with its item's Cue Edits.
    const elsewhere = paste(pickContext(edits({ segments: [segment("t1", 300, 306)] }), null), held, 6, { job: "j2", candidate: "c9" }).edits;
    expect(elsewhere.cue_edits).toEqual([edit(1.5, { media, start_delta: -0.2 })]);
  });
});

describe("merging another editor's Cue Edits", () => {
  test("keeps both editors' Cue Edits on different Cues, and tells an item's apart from the Source's", () => {
    const base = { cue_edits: [] as CueEdit[] };
    const mine = { cue_edits: [edit(101.2, { shift: 0.2 })] };
    const theirs = { cue_edits: [edit(103.1, { end_delta: 0.4 }), edit(101.2, { media: "ab".repeat(16), shift: 1 })] };
    const { merged, collisions } = mergeEdits(base, mine, theirs);
    expect(merged.cue_edits).toEqual(expect.arrayContaining([...mine.cue_edits, ...theirs.cue_edits]));
    expect(merged.cue_edits).toHaveLength(3);
    expect(collisions).toEqual([]);
  });

  test("of one Cue changed by both, mine wins and it is a collision", () => {
    const base = { cue_edits: [edit(103.1)] };
    const { merged, collisions } = mergeEdits(base, { cue_edits: [edit(103.1, { shift: 0.2 })] }, { cue_edits: [edit(103.1, { shift: -0.2 })] });
    expect(merged.cue_edits).toEqual([edit(103.1, { shift: 0.2 })]);
    expect(collisions).toEqual([{ field: "cue_edits", item: "@103.100" }]);
  });
});
