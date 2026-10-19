// .scratch/captions-advanced/issues/09-cue-actions-split-merge-delete.md: a picked Cue is split at the
// playhead, merged with the next, emptied and retyped, and its start and end set in the inspector, as
// worked examples of the Cue Edits and Word Edits they leave.
import { isValidElement, type ReactElement } from "react";
import { describe, expect, test } from "vitest";
import type { Cue, CueEdit, CueKey, PreviewWord, RenderPlan, WordEdit } from "../../../api";
import { Slider } from "../../../components/Slider";
import { withWordEdit } from "../editor/wordEdits";
import { CueActionButtons, CueTimeFields } from "./CueFields";
import {
  cueOf,
  cueSplitter,
  cueTimeGesture,
  deleteCue,
  mergeCue,
  resetCueTiming,
  retypeCue,
  splitCue,
  wordsOfCue,
  type CueScene,
} from "./cueEdits";
import type { AdvancedEdits } from "./edits";

const word = (text: string, start: number, end: number, edit: WordEdit | null = null): PreviewWord => ({
  text,
  start,
  end,
  edit,
  at: Math.round((100 + (start + end) / 2) * 1000) / 1000,
});

// "halo semua." from 1.0 s and "apa kabar" from 3.0 s, of a Clip from 100 s lasting 5 s.
const HALO = word("halo", 1.0, 1.4);
const SEMUA = word("semua.", 1.4, 2.0);
const APA = word("apa", 3.0, 3.2);
const KABAR = word("kabar", 3.2, 3.6);
const WORDS = [HALO, SEMUA, APA, KABAR];

const cue = (start: number, end: number, at: number, said: [string, number][], changes: Partial<Cue> = {}): Cue => ({
  start,
  end,
  lines: [said.map(([text, on], i) => ({ text, start: on, end: said[i + 1]?.[1] ?? end }))],
  plain: [said.map(([text]) => text.toLowerCase()).join(" ")],
  area: { x: 40, y: 1296, width: 1000, height: 200 },
  size: 110,
  key: { at, media: null },
  edited: false,
  joinable: false,
  needs_join: false,
  ...changes,
});

const FIRST: CueKey = { at: 101.2, media: null };
const SECOND: CueKey = { at: 103.1, media: null };
// The second is parted from the first by a sentence's end and a pause, but would fit with it.
const first = cue(1.0, 2.3, 101.2, [["HALO", 1.0], ["SEMUA", 1.4]]);
const second = (changes: Partial<Cue> = {}) => cue(3.0, 3.9, 103.1, [["APA", 3.0], ["KABAR", 3.2]], { joinable: true, needs_join: true, ...changes });

const plan = (captions: Cue[]): RenderPlan => ({ start: 100, end: 105, captions, segments: [], transitions: [], unused_cue_edits: [] }) as unknown as RenderPlan;

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
    segments: [{ id: "s1", start: 100, end: 105 }],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

const edit = (at: number, changes: Partial<CueEdit> = {}): CueEdit => ({ at, media: null, shift: 0, start_delta: 0, end_delta: 0, join: false, ...changes });

const scene = (state = edits(), captions = [first, second()], words = WORDS, locked: CueScene["locked"] = []): CueScene => ({
  edits: state,
  plan: plan(captions),
  words,
  locked,
});

describe("Split on a picked Cue", () => {
  test("adds a Cue Edit at the first of its Words after the playhead, keeping this one picked", () => {
    const split = splitCue(scene(), FIRST, 1.2)!;
    expect(split.edits.cue_edits).toEqual([edit(101.7)]);
    expect(split.pick).toEqual({ kind: "cue", key: FIRST });
    expect(cueSplitter(scene(), FIRST, () => 1.2, () => {}).canSplit(1.2)).toBe(true);
  });

  test("is disabled when none of its Words starts after the playhead, or the playhead isn't in it", () => {
    for (const time of [1.5, 0.5, 2.5]) {
      expect(splitCue(scene(), FIRST, time)).toBeNull();
      expect(cueSplitter(scene(), FIRST, () => time, () => {}).canSplit(time)).toBe(false);
    }
  });

  test("puts a start in place of a join on that Word", () => {
    const joined = scene(edits({ cue_edits: [edit(101.75, { join: true })] }));
    expect(splitCue(joined, FIRST, 1.2)!.edits.cue_edits).toEqual([edit(101.7)]);
  });
});

describe("Merge with next on a picked Cue", () => {
  test("adds a join where a pause or a sentence's end would still part them", () => {
    const merged = mergeCue(scene(), FIRST)!;
    expect(merged.edits.cue_edits).toEqual([edit(103.1, { join: true })]);
    expect(merged.pick).toEqual({ kind: "cue", key: FIRST });
  });

  test("clears the next Cue's own Cue Edit and the break before its first Word, adding no join when nothing else parts them", () => {
    const broken = { at: 103.1, text: null, break_before: true };
    const state = edits({ cue_edits: [edit(101.2, { end_delta: 0.1 }), edit(103.12, { shift: 0.2 })], word_edits: [broken] });
    const words = [HALO, SEMUA, word("apa", 3.0, 3.2, broken), KABAR];
    const merged = mergeCue(scene(state, [first, second({ needs_join: false, edited: true })], words), FIRST)!;
    expect(merged.edits.cue_edits).toEqual([edit(101.2, { end_delta: 0.1 })]);
    expect(merged.edits.word_edits).toEqual([]);
  });

  test("is disabled when the next Cue wouldn't fit, or there is none", () => {
    expect(mergeCue(scene(edits(), [first, second({ joinable: false })]), FIRST)).toBeNull();
    expect(mergeCue(scene(), SECOND)).toBeNull();
  });
});

describe("Delete on a picked Cue", () => {
  test("empties each of its Words in one change, and picks nothing", () => {
    const state = edits({ word_edits: [{ at: 101.2, text: "Halo", break_before: false }] });
    const deleted = deleteCue(scene(state), SECOND)!;
    expect(deleted.edits.word_edits).toEqual([
      { at: 101.2, text: "Halo", break_before: false },
      { at: 103.1, text: "", break_before: false },
      { at: 103.4, text: "", break_before: false },
    ]);
    expect(deleted.pick).toBeNull();
  });

  test("finds a video's Cue's Words only on its item's timeline", () => {
    const video = { ...first, key: { at: 1.2, media: "ab".repeat(16) } };
    expect(wordsOfCue(scene(edits(), [video]), video.key)).toEqual([]);
    expect(deleteCue(scene(edits(), [video]), video.key)).toBeNull();
  });
});

describe("Reset timing after a Split", () => {
  test("keeps the Cue Edit that starts its Cue as a bare start, dropping one that doesn't", () => {
    const state = edits({ cue_edits: [edit(103.1, { shift: 0.3 })] });
    // Nothing but its Cue Edit parts it from the Cue before: it stays, at 0.
    expect(resetCueTiming(scene(state, [first, second({ needs_join: false })]), SECOND)!.edits.cue_edits).toEqual([edit(103.1)]);
    // A sentence's end parts them anyway: it goes.
    expect(resetCueTiming(scene(state), SECOND)!.edits.cue_edits).toEqual([]);
    // A Split's bare start has no timing to reset.
    expect(resetCueTiming(scene(edits({ cue_edits: [edit(103.1)] })), SECOND)).toBeNull();
  });
});

describe("a locked Captions Track", () => {
  test("refuses Split, Merge, Delete, retyping and the time fields", () => {
    const locked = scene(edits(), [first, second()], WORDS, ["captions"]);
    expect(splitCue(locked, FIRST, 1.2)).toBeNull();
    expect(cueSplitter(locked, FIRST, () => 1.2, () => {}).canSplit(1.2)).toBe(false);
    expect(mergeCue(locked, FIRST)).toBeNull();
    expect(deleteCue(locked, FIRST)).toBeNull();
    expect(retypeCue(locked, FIRST, [])).toBeNull();
    expect(cueTimeGesture()(locked, FIRST, "start", 0.8)).toBeNull();
  });
});

describe("the inspector of a picked Cue", () => {
  test("shows its Words as chips, which retype and remove them", () => {
    const words = wordsOfCue(scene(), FIRST);
    expect(words).toEqual([HALO, SEMUA]);
    const retyped = retypeCue(scene(), FIRST, withWordEdit([], words[1], { text: "semuanya." }))!;
    expect(retyped.edits.word_edits).toEqual([{ at: 101.7, text: "semuanya.", break_before: false }]);
    expect(retyped.pick).toEqual({ kind: "cue", key: FIRST });
    const removed = retypeCue(scene(), FIRST, withWordEdit([], words[0], { text: "" }))!;
    expect(removed.edits.word_edits).toEqual([{ at: 101.2, text: "", break_before: false }]);
  });

  test("has Split, Merge with next and Delete, each disabled when it can't be done", () => {
    const done: string[] = [];
    const buttons = CueActionButtons({
      canSplit: false,
      canMerge: true,
      canDelete: true,
      onSplit: () => done.push("split"),
      onMerge: () => done.push("merge"),
      onDelete: () => done.push("delete"),
    });
    if (!isValidElement(buttons)) throw new Error("no buttons");
    const shown = (buttons as ReactElement<{ children: ReactElement<{ "aria-label": string; disabled: boolean; onClick: () => void }>[] }>).props.children;
    expect(shown.map((button) => [button.props["aria-label"], button.props.disabled])).toEqual([
      ["Split at the playhead", true],
      ["Merge with next", false],
      ["Delete its words", false],
    ]);
    shown.forEach((button) => button.props.onClick());
    expect(done).toEqual(["split", "merge", "delete"]);
  });

  test("has its start and end as fields, which write that edge's delta", () => {
    const set: [string, number][] = [];
    const fields = CueTimeFields({ shown: cueOf(plan([first, second()]), SECOND)!, onTime: (edge, time) => set.push([edge, time]) });
    if (!isValidElement(fields)) throw new Error("no fields");
    const [starts, ends] = (fields as ReactElement<{ children: ReactElement<Parameters<typeof Slider>[0]>[] }>).props.children;
    expect([starts.type, starts.props.value, starts.props.min, ends.props.value, ends.props.max]).toEqual([Slider, 3.0, 2.3, 3.9, 5]);
    starts.props.onChange(2.8);
    ends.props.onChange(4.2);
    expect(set).toEqual([["start", 2.8], ["end", 4.2]]);

    // Each set moves that edge there; a run of them goes on from where the Cue was as it began,
    // though the plan hasn't caught up with the last.
    const retime = cueTimeGesture();
    const earlier = retime(scene(), SECOND, "start", 2.8)!;
    expect(earlier.edits.cue_edits).toEqual([edit(103.1, { start_delta: -0.2 })]);
    const further = retime(scene(earlier.edits), SECOND, "start", 2.7)!;
    expect(further.edits.cue_edits).toEqual([edit(103.1, { start_delta: -0.3 })]);
    const later = retime(scene(further.edits, [first, second({ start: 2.7, edited: true })]), SECOND, "end", 4.2)!;
    expect(later.edits.cue_edits).toEqual([edit(103.1, { start_delta: -0.3, end_delta: 0.3 })]);
  });
});
