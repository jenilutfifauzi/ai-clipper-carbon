// A Style Preset's Join Transition (.scratch/transitions-expanded/issues/09-join-transition.md): each
// action that changes the Main Track gives its new joins a copy, in the one change it makes.
import { describe, expect, test } from "vitest";
import type { ClipSegment, JoinTransition, Transition } from "../../../api";
import { playedFrom } from "../editor/playback";
import { dragSegment, duplicate, freezeFrame, insertSegment, remove, rippleRemove, split, splitAt, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const CROSSFADE: JoinTransition = { kind: "dissolve", secs: 0.8, sound: "equal_power", strength: 0.4, colour: null };
const crossfade = (after: string): Transition => ({ after, ...CROSSFADE });
const wipe = (after: string): Transition => ({ after, kind: "wipeleft", secs: 0.5 });

// A Segment of the Source from `start` to `end` seconds.
const segment = (id: string, start: number, end: number): ClipSegment => ({ id, start, end });
const seg = (id: string) => ({ kind: "segment", id }) as const;

function edits(segments: ClipSegment[], transitions: Transition[] = []): AdvancedEdits {
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
    overlays: [],
    transitions,
  };
}

// The scene of `state` with `pick` under a Preset whose Join Transition is `join`: its Main Track
// played back to back, new ids numbered from n1.
function scene(state: AdvancedEdits, pick: Pick, join: JoinTransition | null = CROSSFADE): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, join };
}

// s1 plays 0–10 s, s2 10–15 s, s3 15–25 s; a wipe from s1 into s2.
const three = () => edits([segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)], [wipe("s1")]);

describe("a Style Preset's Join Transition", () => {
  test("splitting a Segment gives the new join a copy, in the split's one change", () => {
    const before = edits([segment("s1", 100, 110)]);

    expect(split(scene(before, picked(seg("s1"))), 4)).toEqual({
      edits: { ...before, segments: [segment("s1", 100, 104), segment("n1", 104, 110)], transitions: [crossfade("s1")] },
      pick: picked(seg("n1")),
    });
  });

  test("under a Preset with none, a split's new join is a cut", () => {
    const before = edits([segment("s1", 100, 110)]);

    expect(split(scene(before, picked(seg("s1")), null), 4)?.edits.transitions).toEqual([]);
  });

  test("Split all, an insert, a Freeze frame, a duplicate, a delete and a Ripple delete give each new join one", () => {
    const transitionsAfter = (outcome: { edits: AdvancedEdits } | null) => outcome?.edits.transitions;
    const before = three();

    // s3 split at 20 s: s3–n1 is new.
    expect(transitionsAfter(splitAt(scene(before, null), 20))).toEqual([wipe("s1"), crossfade("s3")]);
    // Put in after s2: s2–x and x–s3 are new.
    expect(transitionsAfter(insertSegment(scene(before, null), segment("x", 400, 402), 2))).toEqual([wipe("s1"), crossfade("s2"), crossfade("x")]);
    // Frozen at 3 s into s1: s1–n2 and n2–n1 are new; the wipe goes after the tail, n1.
    expect(transitionsAfter(freezeFrame(scene(before, null), 3))).toEqual([wipe("n1"), crossfade("s1"), crossfade("n2")]);
    // s2 copied after itself: s2–n1 and n1–s3 are new.
    expect(transitionsAfter(duplicate(scene(before, picked(seg("s2")))))).toEqual([wipe("s1"), crossfade("s2"), crossfade("n1")]);
    // s2 deleted: s1–s3 is new, and s1 has the wipe already.
    expect(transitionsAfter(remove(scene(before, picked(seg("s2")))))).toEqual([wipe("s1")]);
    // s1 deleted: nothing is new.
    expect(transitionsAfter(rippleRemove(scene(before, picked(seg("s1")))))).toEqual([wipe("s1")]);
    const plain = edits(before.segments);
    expect(transitionsAfter(remove(scene(plain, picked(seg("s2")))))).toEqual([crossfade("s1")]);
    expect(transitionsAfter(rippleRemove(scene(plain, picked(seg("s2")))))).toEqual([crossfade("s1")]);
  });

  test("a paste gives its joins one but where it brings its own", () => {
    const here = { job: "j1", candidate: "c1" };
    const before = three();
    const held = copy(scene(before, picked(seg("s1"), seg("s2"))), here)!;

    // At the Clip's end: s3–n1 is new, and n1–n2 brings its wipe.
    expect(paste(scene(before, null), held, 25, here).edits.transitions).toEqual([wipe("s1"), wipe("n1"), crossfade("s3")]);
  });

  test("a reorder by drag gives the joins new since the drag began one, and none once it is back", () => {
    const before = edits([segment("s1", 100, 110), segment("s2", 200, 205), segment("s3", 300, 310)]);
    const context = scene(before, null);
    const origin = { edits: before, shown: context.played, planned: context.played };
    // s3 dragged to the start, then back.
    const moved = dragSegment(context, origin, "s3", { start: 0, end: 10, edge: "move" }, () => Infinity);
    expect(moved.edits.segments.map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    expect(moved.edits.transitions).toEqual([crossfade("s3")]);
    const back = dragSegment(scene(moved.edits, null), origin, "s3", { start: 15, end: 25, edge: "move" }, () => Infinity);
    expect(back.edits.segments.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(back.edits.transitions).toEqual([]);
  });
});
