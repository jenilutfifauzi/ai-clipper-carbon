// .scratch/audio-effects/issues/02-music-clip-and-overlay-effects.md: an item's Audio Effects (ADR
// 0017) stay with its sound. Detach copies the Segment's stack onto its Music Clip and keeps the
// Segment's, so Reattach brings it back as it was; Split gives it to both parts; copy and paste carry it.
import { describe, expect, test } from "vitest";
import type { AudioEffect, AudioEffectKind, ClipSegment, MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { playedFrom } from "../editor/playback";
import {
  addAudioEffect,
  cleanSwitches,
  detach,
  moveAudioEffect,
  removeAllAudioEffects,
  removeAudioEffect,
  setAudioEffectEnabled,
  setAudioEffectSetting,
  setCleanSetting,
  setCleanSwitch,
  sharedStack,
  reattach,
  split,
  type PickContext,
} from "./actions";
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

// .scratch/audio-effects/issues/06-clean-switches.md: the Clean switches put their entries at the top
// (Reduce noise, then Enhance voice) or at the bottom (Normalize loudness) of every picked stack.
describe("the Clean switches", () => {
  const clean = (id: string, name: string, key: string, min: number, max: number, def: number): AudioEffectKind => ({
    id,
    name,
    group: "Clean",
    order: 0,
    description: "",
    settings: [{ key, label: key, min, max, default: def, step: 1, unit: "", intensity: true }],
  });
  const denoiseKind = clean("denoise", "Reduce noise", "strength", 0, 100, 50);
  const enhanceKind = clean("enhance-voice", "Enhance voice", "amount", 0, 100, 60);
  const normalizeKind = clean("normalize", "Normalize loudness", "target", -30, -12, -23);
  const denoise: AudioEffect = { id: "denoise", params: { strength: 50 }, enabled: true };
  const enhance: AudioEffect = { id: "enhance-voice", params: { amount: 60 }, enabled: true };
  const normalize: AudioEffect = { id: "normalize", params: { target: -23 }, enabled: true };
  const one = picked({ kind: "segment", id: "a" });
  const alone = (audio_effects?: AudioEffect[]) => edits({ segments: [segment("a", 0, 5, audio_effects ? { audio_effects } : {})] });
  const stackAfter = (state: AdvancedEdits, ...switches: [AudioEffectKind, boolean][]) =>
    switches.reduce((now, [kind, on]) => setCleanSwitch({ edits: now, pick: one }, sounded, kind, on)!.edits, state).segments[0].audio_effects;

  test("each switched on alone is the stack's one entry, at its defaults", () => {
    expect(stackAfter(alone(), [denoiseKind, true])).toEqual([denoise]);
    expect(stackAfter(alone(), [enhanceKind, true])).toEqual([enhance]);
    expect(stackAfter(alone(), [normalizeKind, true])).toEqual([normalize]);
  });

  test("with presets, Reduce noise then Enhance voice go at the top and Normalize at the bottom, in whatever order switched on", () => {
    expect(stackAfter(alone(stack), [normalizeKind, true], [enhanceKind, true], [denoiseKind, true])).toEqual([denoise, enhance, echo, telephone, normalize]);
    expect(stackAfter(alone(stack), [denoiseKind, true], [enhanceKind, true], [normalizeKind, true])).toEqual([denoise, enhance, echo, telephone, normalize]);
  });

  test("switched off, its entry is taken out wherever it was moved to; the last one taken, the item has no stack", () => {
    const moved = alone([echo, denoise, normalize, telephone]);
    expect(stackAfter(moved, [denoiseKind, false])).toEqual([echo, normalize, telephone]);
    expect(stackAfter(moved, [normalizeKind, false], [denoiseKind, false])).toEqual(stack);
    const emptied = setCleanSwitch({ edits: alone([normalize]), pick: one }, sounded, normalizeKind, false)!.edits;
    expect("audio_effects" in emptied.segments[0]).toBe(false);
  });

  test("a switch shows on, off or Mixed, with its settings when on; an entry switched off counts as off and is switched on in place", () => {
    const state = edits({ segments: [segment("a", 0, 5, { audio_effects: [denoise, echo] }), segment("b", 5, 9, { audio_effects: [{ ...denoise, params: { strength: 80 } }] })] });
    const both = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "b" });
    expect(cleanSwitches({ edits: state, pick: both }, sounded)).toEqual({
      denoise: { on: true, params: { strength: 50 } },
      "enhance-voice": { on: false, params: null },
      normalize: { on: false, params: null },
    });
    const half = edits({ segments: [segment("a", 0, 5, { audio_effects: [denoise] }), segment("b", 5, 9)] });
    expect(cleanSwitches({ edits: half, pick: both }, sounded)!.denoise).toEqual({ on: "mixed", params: null });
    const unheard = alone([echo, { ...normalize, enabled: false }]);
    expect(cleanSwitches({ edits: unheard, pick: one }, sounded)!.normalize.on).toBe(false);
    expect(stackAfter(unheard, [normalizeKind, true])).toEqual([echo, normalize]);
    expect(cleanSwitches({ edits: edits(), pick: picked({ kind: "overlay", id: "none" }) }, sounded)).toBeNull();
  });

  test("on a mixed Pick, a switch puts its entry on every item with sound that hasn't it, and a slider sets it on every one", () => {
    const state = edits({
      segments: [segment("a", 0, 5, { audio_effects: [denoise, echo] }), segment("f", 5, 5, { hold: 1 })],
      music: [music("m1")],
      overlays: [overlay("o1", { audio_effects: [telephone] })],
    });
    const all = picked({ kind: "segment", id: "a" }, { kind: "segment", id: "f" }, { kind: "music", id: "m1" }, { kind: "overlay", id: "o1" });
    const on = setCleanSwitch({ edits: state, pick: all }, sounded, denoiseKind, true)!;
    expect(on.pick).toBe(all);
    expect(on.edits.segments[0].audio_effects).toEqual([denoise, echo]);
    expect(on.edits.music[0].audio_effects).toEqual([denoise]);
    expect(on.edits.overlays[0].audio_effects).toEqual([denoise, telephone]);
    expect(on.edits.segments[1].audio_effects).toBeUndefined();
    const [strength] = denoiseKind.settings;
    const set = setCleanSetting({ edits: on.edits, pick: all }, sounded, "denoise", strength, 72.4)!;
    expect([set.edits.segments[0], set.edits.music[0], set.edits.overlays[0]].map((item) => item.audio_effects![0].params)).toEqual([
      { strength: 72 },
      { strength: 72 },
      { strength: 72 },
    ]);
    const off = setCleanSwitch({ edits: set.edits, pick: all }, sounded, denoiseKind, false)!;
    expect([off.edits.segments[0], off.edits.music[0], off.edits.overlays[0]].map((item) => item.audio_effects)).toEqual([[echo], undefined, [telephone]]);
  });

  test("a stack row moves past the rows beside it, never past a switch's entry, which it doesn't show", () => {
    const state = alone([denoise, echo, telephone, normalize]);
    expect(moveAudioEffect({ edits: state, pick: one }, sounded, 1, -1)).toBeNull();
    expect(moveAudioEffect({ edits: state, pick: one }, sounded, 2, 1)).toBeNull();
    expect(moveAudioEffect({ edits: state, pick: one }, sounded, 1, 1)!.edits.segments[0].audio_effects).toEqual([denoise, telephone, echo, normalize]);
  });

  test("a row moved past a switch's entry an agent put between rows lands beside its neighbour; the rest keep their order", () => {
    const radio: AudioEffect = { id: "radio", params: {}, enabled: true };
    const state = alone([radio, normalize, echo]);
    expect(moveAudioEffect({ edits: state, pick: one }, sounded, 2, -1)!.edits.segments[0].audio_effects).toEqual([echo, radio, normalize]);
    expect(moveAudioEffect({ edits: state, pick: one }, sounded, 0, 1)!.edits.segments[0].audio_effects).toEqual([normalize, echo, radio]);
  });

  test("Add effect puts a preset above Normalize loudness, which stays last", () => {
    const echoKind: AudioEffectKind = { id: "echo", name: "Echo", group: "Space", order: 0, description: "", settings: [] };
    const added: AudioEffect = { id: "echo", params: {}, enabled: true };
    const after = (state: AdvancedEdits) => addAudioEffect({ edits: state, pick: one }, sounded, echoKind)!.edits.segments[0].audio_effects;
    expect(after(alone([denoise, telephone, normalize]))).toEqual([denoise, telephone, added, normalize]);
    expect(after(alone([normalize]))).toEqual([added, normalize]);
    expect(after(alone([denoise]))).toEqual([denoise, added]);
  });

  test("Enhance voice goes right after a Reduce noise wherever it is, else at the top", () => {
    expect(stackAfter(alone([echo, denoise, telephone]), [enhanceKind, true])).toEqual([echo, denoise, enhance, telephone]);
    expect(stackAfter(alone([echo, normalize]), [enhanceKind, true])).toEqual([enhance, echo, normalize]);
  });
});
