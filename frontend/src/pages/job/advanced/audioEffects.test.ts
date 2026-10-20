// .scratch/audio-effects/issues/02-music-clip-and-overlay-effects.md: an item's Audio Effects (ADR
// 0017) stay with its sound. Detach copies the Segment's stack onto its Music Clip and keeps the
// Segment's, so Reattach brings it back as it was; Split gives it to both parts; copy and paste carry it.
import { describe, expect, test } from "vitest";
import type { AudioEffect, AudioEffectKind, ClipSegment, MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { playedFrom } from "../editor/playback";
import { addAudioEffect, detach, moveAudioEffect, removeAllAudioEffects, removeAudioEffect, setAudioEffectEnabled, setAudioEffectSetting, sharedStack, reattach, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const echo: AudioEffect = { id: "echo", params: { delay: 0.25, decay: 0.4 }, enabled: true };
const telephone: AudioEffect = { id: "telephone", params: { drive: 3 }, enabled: false };
const stack = [echo, telephone];

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const music = (id: string, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "song",
  start: 0,
  secs: 4,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
});
const overlay = (id: string, changes: Partial<Overlay> = {}): Overlay => ({
  id,
  media: "clip",
  start: 0,
  secs: 4,
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
    segments: [segment("s1", 100, 110, { audio_effects: stack }), segment("s2", 200, 210)],
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

const sounded = () => true;

describe("Detach and Reattach", () => {
  test("the Music Clip gets the Segment's stack, switched-off entries too, and the Segment keeps its own", () => {
    const state = edits();
    const detached = detach(scene(state), ["s1", "s2"], playedFrom(state.segments), sounded)!.edits;
    const [effected, plain] = detached.music;
    expect(effected.audio_effects).toEqual(stack);
    // A Segment without a stack gives none.
    expect(plain.audio_effects ?? []).toEqual([]);
    expect(detached.segments[0]).toMatchObject({ muted: true, audio_effects: stack });

    // Changing the Detached sound's stack leaves the Segment's; Reattach brings it back as it was.
    const changed = { ...detached, music: [{ ...effected, audio_effects: [] }, plain] };
    const outcome = reattach(scene(changed), "s1")!;
    expect(outcome.edits.segments[0]).toEqual(segment("s1", 100, 110, { audio_effects: stack, muted: false }));
  });
});

describe("Split", () => {
  test("both parts of a Segment, a Music Clip and an Overlay keep the stack", () => {
    const state = edits({ music: [music("m", { start: 0, secs: 8, audio_effects: stack })], overlays: [overlay("o", { secs: 8, audio_effects: [echo] })] });
    const pick = picked({ kind: "segment", id: "s1" }, { kind: "music", id: "m" }, { kind: "overlay", id: "o" });
    const outcome = split(scene(state, pick), 4)!;
    expect(outcome.edits.segments.map((each) => each.audio_effects ?? [])).toEqual([stack, stack, []]);
    expect(outcome.edits.music.map((each) => each.audio_effects)).toEqual([stack, stack]);
    expect(outcome.edits.overlays.map((each) => each.audio_effects)).toEqual([[echo], [echo]]);
  });
});

describe("the Clipboard", () => {
  test("copy and paste carry a Segment's, a Music Clip's and an Overlay's stack, into another Candidate too", () => {
    const from = { job: "j1", candidate: "c1" };
    const state = edits({ music: [music("m", { audio_effects: stack })], overlays: [overlay("o", { audio_effects: [echo] })] });
    const pick = picked({ kind: "segment", id: "s1" }, { kind: "music", id: "m" }, { kind: "overlay", id: "o" });
    const copied = copy(scene(state, pick), from)!;
    const pasted = paste(scene(edits({ segments: [segment("s2", 200, 210)] })), copied, 0, { job: "j1", candidate: "c2" }).edits;
    expect(pasted.segments.map((each) => each.audio_effects ?? [])).toEqual([stack, []]);
    expect(pasted.music.map((each) => each.audio_effects)).toEqual([stack]);
    expect(pasted.overlays.map((each) => each.audio_effects)).toEqual([[echo]]);
  });
});

// .scratch/audio-effects/issues/04-inspector-audio-effects.md: the Inspector's Audio Effects section
// acts on the picked items with sound, each change one step of undo.
describe("the Inspector's Audio Effects actions", () => {
  const robot: AudioEffectKind = {
    id: "robot",
    name: "Robot",
    group: "Voice",
    order: 3,
    description: "",
    settings: [
      { key: "amount", label: "Amount", min: 0, max: 100, default: 60, step: 1, unit: "%", intensity: true },
      { key: "rate", label: "Rate", min: 1, max: 20, default: 8, step: 0.5, unit: "Hz", intensity: false },
    ],
  };
  // A video with sound ("clip"), an image ("still"): only the first is sounded.
  const hasSound = (media: string) => media === "clip";
  const mixed = () =>
    edits({
      segments: [segment("s1", 100, 110, { audio_effects: stack }), segment("s2", 200, 210), segment("f", 210, 210, { hold: 1 })],
      music: [music("m1")],
      overlays: [overlay("o1"), overlay("still", { media: "still" })],
    });
  const all = picked(
    { kind: "segment", id: "s1" },
    { kind: "segment", id: "s2" },
    { kind: "segment", id: "f" },
    { kind: "music", id: "m1" },
    { kind: "overlay", id: "o1" },
    { kind: "overlay", id: "still" },
  );
  const stackOf = (state: AdvancedEdits, kind: "segments" | "music" | "overlays", id: string) => state[kind].find((item) => item.id === id)?.audio_effects;

  test("Add effect appends the effect at its defaults to every picked item with sound, and skips a Freeze frame and an image", () => {
    const outcome = addAudioEffect({ edits: mixed(), pick: all }, hasSound, robot)!;
    const added: AudioEffect = { id: "robot", params: { amount: 60, rate: 8 }, enabled: true };
    expect(stackOf(outcome.edits, "segments", "s1")).toEqual([echo, telephone, added]);
    expect(stackOf(outcome.edits, "segments", "s2")).toEqual([added]);
    expect(stackOf(outcome.edits, "music", "m1")).toEqual([added]);
    expect(stackOf(outcome.edits, "overlays", "o1")).toEqual([added]);
    expect(stackOf(outcome.edits, "segments", "f")).toBeUndefined();
    expect(stackOf(outcome.edits, "overlays", "still")).toBeUndefined();
    expect(outcome.pick).toBe(all);
  });

  test("the picked stack is shown when every item's is the same, else Mixed; nothing with sound picked, none", () => {
    const state = mixed();
    const scene = (pick: Pick) => ({ edits: state, pick });
    expect(sharedStack(scene(picked({ kind: "segment", id: "s1" }, { kind: "segment", id: "f" })), hasSound)).toEqual(stack);
    expect(sharedStack(scene(picked({ kind: "segment", id: "s2" }, { kind: "music", id: "m1" })), hasSound)).toEqual([]);
    expect(sharedStack(scene(all), hasSound)).toBe("mixed");
    expect(sharedStack(scene(picked({ kind: "segment", id: "f" }, { kind: "overlay", id: "still" })), hasSound)).toBeNull();
    // Equal entries, not the same objects (as after a save): the same stack.
    const filled = edits({ segments: [segment("a", 0, 5, { audio_effects: [echo] }), segment("b", 5, 9, { audio_effects: [{ ...echo, params: { ...echo.params } }] })] });
    expect(sharedStack({ edits: filled, pick: picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" }) }, hasSound)).toEqual([echo]);
  });

  // Two Segments with the same stack, picked together.
  const twins = () => edits({ segments: [segment("a", 0, 5, { audio_effects: stack }), segment("b", 5, 9, { audio_effects: stack })] });
  const both = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" });
  const stacks = (state: AdvancedEdits) => state.segments.map((each) => each.audio_effects);

  test("move up and move down swap an entry with its neighbour on every picked item; past an end, nothing", () => {
    const down = moveAudioEffect({ edits: twins(), pick: both }, hasSound, 0, 1)!;
    expect(stacks(down.edits)).toEqual([[telephone, echo], [telephone, echo]]);
    const up = moveAudioEffect({ edits: down.edits, pick: both }, hasSound, 1, -1)!;
    expect(stacks(up.edits)).toEqual([stack, stack]);
    expect(moveAudioEffect({ edits: twins(), pick: both }, hasSound, 0, -1)).toBeNull();
    expect(moveAudioEffect({ edits: twins(), pick: both }, hasSound, 1, 1)).toBeNull();
  });

  test("an entry switched off stays in its place, and on again", () => {
    const off = setAudioEffectEnabled({ edits: twins(), pick: both }, hasSound, 0, false)!;
    expect(stacks(off.edits)).toEqual([[{ ...echo, enabled: false }, telephone], [{ ...echo, enabled: false }, telephone]]);
    const on = setAudioEffectEnabled({ edits: off.edits, pick: both }, hasSound, 1, true)!;
    expect(on.edits.segments[0].audio_effects![1]).toEqual({ ...telephone, enabled: true });
  });

  test("remove takes the entry out; the last one taken, the item has no stack", () => {
    const once = removeAudioEffect({ edits: twins(), pick: both }, hasSound, 0)!;
    expect(stacks(once.edits)).toEqual([[telephone], [telephone]]);
    const twice = removeAudioEffect({ edits: once.edits, pick: both }, hasSound, 0)!;
    expect(stacks(twice.edits)).toEqual([undefined, undefined]);
    expect("audio_effects" in twice.edits.segments[0]).toBe(false);
  });

  test("a setting change sets that one setting of the entry, kept within its range and on its steps", () => {
    const state = edits({ segments: [segment("a", 0, 5, { audio_effects: [{ id: "robot", params: { amount: 60 }, enabled: true }] })] });
    const one = picked({ kind: "segment", id: "a" });
    const [amount, rate] = robot.settings;
    expect(setAudioEffectSetting({ edits: state, pick: one }, hasSound, 0, amount, 25)!.edits.segments[0].audio_effects).toEqual([
      { id: "robot", params: { amount: 25 }, enabled: true },
    ]);
    // A setting left out (at the catalogue's default) is written once changed.
    expect(setAudioEffectSetting({ edits: state, pick: one }, hasSound, 0, rate, 12.3)!.edits.segments[0].audio_effects![0].params).toEqual({ amount: 60, rate: 12.5 });
    expect(setAudioEffectSetting({ edits: state, pick: one }, hasSound, 0, amount, 140)!.edits.segments[0].audio_effects![0].params.amount).toBe(100);
  });

  test("Remove all effects empties every picked stack, Mixed or not", () => {
    const outcome = removeAllAudioEffects({ edits: mixed(), pick: all }, hasSound)!;
    expect(outcome.edits.segments.map((each) => each.audio_effects)).toEqual([undefined, undefined, undefined]);
    expect(stackOf(outcome.edits, "music", "m1")).toBeUndefined();
    expect(sharedStack(outcome, hasSound)).toEqual([]);
  });

  test("an entry's actions do nothing while the picked stacks differ", () => {
    expect(moveAudioEffect({ edits: mixed(), pick: all }, hasSound, 0, 1)).toBeNull();
    expect(setAudioEffectEnabled({ edits: mixed(), pick: all }, hasSound, 0, false)).toBeNull();
    expect(removeAudioEffect({ edits: mixed(), pick: all }, hasSound, 0)).toBeNull();
  });
});
