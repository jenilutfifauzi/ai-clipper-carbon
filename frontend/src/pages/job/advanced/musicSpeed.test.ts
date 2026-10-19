// .scratch/audio-mixing/issues/07-music-clip-speed-pitch-reverse.md: a Music Clip's Speed, pitch and
// Reverse in the Advanced Edit (docs/adr/0016): a Speed change is a trim at its end, its Keyframes
// scaled, and splits, ripples and the Clipboard read its song through its Speed.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, MusicClip } from "../../../api";
import { LINEAR } from "../editor/keyframes";
import { playedFrom } from "../editor/playback";
import { gestureSpeed, remove, reversible, setReverse, setSpeed, speedSheetItem, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const key = (at: number, value: number): Keyframe => ({ at, value, ease: LINEAR });

const segment = (id: string, start: number, end: number): ClipSegment => ({ id, start, end });

const music = (id: string, start: number, secs: number, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "song",
  start,
  secs,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
});

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
    shapes: [],
    music: [],
    source_volume: 1,
    segments: [segment("s1", 100, 110), segment("s2", 200, 210), segment("s3", 300, 310)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null, changes: Partial<PickContext> = {}): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, ...changes };
}

const song = { kind: "music", id: "m" } as const;
const pickSong = picked(song);

describe("a Music Clip's Speed", () => {
  test("is a trim at its end: its start stays and its volume Keyframes scale by old ÷ new, as one change", () => {
    const keyed = music("m", 4, 4, { offset: 1, fade_out: 1, keys: { volume: [key(0, 1), key(4, 0.2)] } });
    const before = edits({ music: [keyed], text_layers: [] });
    const outcome = setSpeed(scene(before, pickSong, { magnetic: true }), song, 2, { video: 30 })!;
    expect(outcome.edits.music).toEqual([{ ...keyed, speed: 2, secs: 2, keys: { volume: [key(0, 1), key(2, 0.2)] } }]);
    // Nothing else moves: the Main Track is as it was.
    expect(outcome.edits.segments).toBe(before.segments);
    // Back to 1×, it is as it was.
    expect(setSpeed(scene(outcome.edits, pickSong), song, 1, { video: 30 })!.edits.music).toEqual([{ ...keyed, speed: 1 }]);
  });

  test("keeps its read within its song and its fades within it", () => {
    // 9 s of the song are left from 1 s: 4.5 s at 2×.
    const long = music("m", 0, 12, { offset: 1, fade_in: 3, fade_out: 3 });
    const sped = setSpeed(scene(edits({ music: [long] })), song, 2, { video: 10 })!.edits.music[0];
    expect(sped).toMatchObject({ secs: 4.5, speed: 2, fade_in: 2.25, fade_out: 2.25 });
    // Slower, it plays longer.
    expect(setSpeed(scene(edits({ music: [music("m", 0, 2)] })), song, 0.5, { video: 10 })!.edits.music[0].secs).toBe(4);
  });

  test("set through a gesture brings back the Keyframes a fast Speed crowded", () => {
    const keyed = music("m", 0, 4, { keys: { volume: [key(0, 1), key(1, 0.5), key(4, 0.2)] } });
    const set = gestureSpeed();
    const start = scene(edits({ music: [keyed] }), pickSong);
    const fast = set(start, song, 16, "music:m:speed", { video: 30 })!;
    const back = set({ ...start, edits: fast.edits }, song, 1, "music:m:speed", { video: 30 })!;
    expect(back.edits.music[0]).toEqual({ ...keyed, speed: 1 });
  });
});

describe("a Music Clip in Reverse", () => {
  test("R turns it on alone, its Keyframes mirrored over its length", () => {
    const keyed = music("m", 0, 4, { keys: { volume: [key(0, 1), key(1, 0.5)] } });
    const state = edits({ music: [keyed, music("other", 5, 1)] });
    expect(reversible({ edits: state, pick: pickSong }, () => false)).toEqual(song);
    expect(speedSheetItem({ edits: state, pick: pickSong }, () => false)).toEqual(song);
    expect(reversible({ edits: state, pick: picked(song, { kind: "music", id: "other" }) }, () => false)).toBeNull();
    const turned = setReverse({ edits: state, pick: pickSong }, song, true)!.edits.music[0];
    expect(turned).toMatchObject({ reverse: true, keys: { volume: [{ at: 3, value: 0.5 }, { at: 4, value: 1 }] } });
  });
});

describe("a sped Music Clip on the Timeline", () => {
  test("split at the playhead, its tail's offset goes on by twice the head's length", () => {
    const before = edits({ music: [music("m", 2, 4, { offset: 1, speed: 2, fade_in: 0.5, fade_out: 0.5 })] });
    const [head, tail] = split(scene(before, pickSong), 3.5)!.edits.music;
    expect(head).toMatchObject({ start: 2, secs: 1.5, offset: 1, speed: 2, fade_in: 0.5, fade_out: 0 });
    expect(tail).toMatchObject({ start: 3.5, secs: 2.5, offset: 4, speed: 2, fade_in: 0, fade_out: 0.5 });
  });

  test("split in Reverse, its first part plays the later part of its song", () => {
    // 1..9 s of the song backwards at 2×: its first 1.5 s on the Timeline are 9 back to 6.
    const before = edits({ music: [music("m", 2, 4, { offset: 1, speed: 2, reverse: true })] });
    const [head, tail] = split(scene(before, pickSong), 3.5)!.edits.music;
    expect(head).toMatchObject({ secs: 1.5, offset: 6, reverse: true });
    expect(tail).toMatchObject({ secs: 2.5, offset: 1, reverse: true });
  });

  test("cut by a ripple, it goes on as far into its song as it was cut, times its Speed", () => {
    // s1 removed on the Magnetic timeline: the Music Clip from 8 s loses its first 2 s, 4 s of its song at 2×.
    const before = edits({ music: [music("m", 8, 4, { offset: 1, speed: 2 })] });
    const after = remove(scene(before, picked({ kind: "segment", id: "s1" }), { magnetic: true }))!.edits.music[0];
    expect(after).toMatchObject({ start: 0, secs: 2, offset: 5, speed: 2 });
  });

  test("copied cut short at the Clip's start, it goes on as far into its song", () => {
    const here = { job: "j", candidate: "c" };
    const from = edits({ music: [music("m", 9, 4, { offset: 1, speed: 2 })] });
    const clipboard = copy(scene(from, picked({ kind: "segment", id: "s2" }, song)), here)!;
    const pasted = paste(scene(edits()), clipboard, 0, here, []);
    expect(pasted.edits.music[0]).toMatchObject({ start: 0, secs: 3, offset: 3, speed: 2 });
  });
});
