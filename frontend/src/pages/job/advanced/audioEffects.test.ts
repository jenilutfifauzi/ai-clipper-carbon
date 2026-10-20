// .scratch/audio-effects/issues/02-music-clip-and-overlay-effects.md: an item's Audio Effects (ADR
// 0017) stay with its sound. Detach copies the Segment's stack onto its Music Clip and keeps the
// Segment's, so Reattach brings it back as it was; Split gives it to both parts; copy and paste carry it.
import { describe, expect, test } from "vitest";
import type { AudioEffect, ClipSegment, MusicClip, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { playedFrom } from "../editor/playback";
import { detach, reattach, split, type PickContext } from "./actions";
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
