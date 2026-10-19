// .scratch/audio-mixing/issues/11-ducking-in-the-advanced-edit.md: a new Music Clip ducks at −12 dB;
// Duck under speech switched and its depth set (setDuck), each one change; and on the Timeline, a
// ducked Music Clip's shaded stretches (the plan's) and its Waveform's gain, duck included (timelineView).
import { describe, expect, test } from "vitest";
import type { AudioEvent, Ducking, MediaItem, MusicClip } from "../../../api";
import { LINEAR } from "../editor/keyframes";
import { setDuck } from "./actions";
import { DEFAULT_DUCK, type AdvancedEdits } from "./edits";
import { newMusicClip } from "./Music";
import { picked } from "./pick";
import { gainAt, musicDuck, underVolumeLine, volumeHeight, type Heard } from "./timelineView";

const DUCKING: Ducking = { lead_secs: 0.25, release_secs: 0.5, bridge_secs: 0.8 };

const music = (id: string, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "song",
  start: 0,
  secs: 10,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
});

const edits = (clips: MusicClip[]) => ({ music: clips }) as unknown as AdvancedEdits;

const event = (id: string, changes: Partial<AudioEvent> = {}): AudioEvent => ({
  id,
  media: "song",
  start: 2,
  end: 12,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  gain: [],
  ...changes,
});

describe("a new Music Clip", () => {
  test("ducks under speech at −12 dB", () => {
    const song = { id: "song", kind: "audio", duration: 30, has_audio: true } as MediaItem;
    expect(DEFAULT_DUCK).toBe(-12);
    expect(newMusicClip(song, 2, 20).duck).toBe(-12);
  });
});

describe("setDuck", () => {
  const scene = { edits: edits([music("a", { duck: -12 }), music("b")]), pick: picked({ kind: "music", id: "a" }) };

  test("switches it off with null, keeping the rest of the clip and the Pick", () => {
    const outcome = setDuck(scene, "a", null)!;
    expect(outcome.edits.music[0]).toEqual(music("a", { duck: null }));
    expect(outcome.edits.music[1]).toBe(scene.edits.music[1]);
    expect(outcome.pick).toBe(scene.pick);
  });

  test("sets a depth, whole dB within −30 to −1", () => {
    expect(setDuck(scene, "b", -12)!.edits.music[1].duck).toBe(-12);
    expect(setDuck(scene, "a", -20.4)!.edits.music[0].duck).toBe(-20);
    expect(setDuck(scene, "a", -45)!.edits.music[0].duck).toBe(-30);
    expect(setDuck(scene, "a", 3)!.edits.music[0].duck).toBe(-1);
  });

  test("refuses a Music Clip of the Source, which never ducks, and one that isn't there", () => {
    const source = { edits: edits([music("s", { media: null })]), pick: null };
    expect(setDuck(source, "s", -12)).toBeNull();
    expect(setDuck(scene, "gone", -12)).toBeNull();
  });
});

describe("a ducked Music Clip on the Timeline", () => {
  test("takes its depth from the draft, and its speech and shaded stretches from the plan, in seconds into it", () => {
    const clip = music("a", { start: 2, duck: -12 });
    // The plan's stretches, ramps included, joined and cut to the clip (ducked_stretches in backend/app/ducking.py).
    const planned = event("a", { duck: -6, speech: [[4, 5]], ducked: [[3.75, 5.5]] });
    expect(musicDuck(clip, planned, DUCKING)).toEqual({ depth: -12, speech: [[2, 3]], stretches: [[1.75, 3.5]], ducking: DUCKING });
    // Planned before the plan carried them: none shaded.
    expect(musicDuck(clip, event("a", { duck: -6, speech: [[4, 5]] }), DUCKING)?.stretches).toEqual([]);
  });

  test("isn't ducked when switched off, of the Source, unplanned or without the plan's ducking", () => {
    const planned = event("a", { duck: -12, speech: [[4, 5]] });
    expect(musicDuck(music("a", { duck: null }), planned, DUCKING)).toBeUndefined();
    expect(musicDuck(music("a", { media: null }), planned, DUCKING)).toBeUndefined();
    expect(musicDuck(music("a", { duck: -12 }), undefined, DUCKING)).toBeUndefined();
    expect(musicDuck(music("a", { duck: -12 }), planned, undefined)).toBeUndefined();
  });

  const ducked = (speech: [number, number][], changes: Partial<Heard> = {}): Heard => ({
    volume: 1,
    secs: 10,
    fade_in: 0,
    fade_out: 0,
    duck: { depth: -20, speech, stretches: [], ducking: DUCKING },
    ...changes,
  });

  test("its Waveform's gain dips by the depth over speech, along the lead and release ramps", () => {
    const heard = ducked([[4, 5]], { volume: 0.5 });
    expect(gainAt(2, heard)).toBe(0.5);
    expect(gainAt(4.5, heard)).toBeCloseTo(0.05);
    // Halfway down the lead, and halfway up the release.
    expect(gainAt(3.875, heard)).toBeCloseTo(0.5 * (1 + 0.1) / 2);
    expect(gainAt(5.25, heard)).toBeCloseTo(0.5 * (0.1 + 1) / 2);
    expect(gainAt(6, heard)).toBe(0.5);
  });

  test("shades under its Volume Line, which stays at the volume dragged", () => {
    const flat = underVolumeLine(ducked([[4, 5]], { volume: 0.5 }), [3.75, 5.5]);
    expect(flat).toEqual([
      { time: 3.75, height: volumeHeight(0.5) },
      { time: 5.5, height: volumeHeight(0.5) },
    ]);
    // A keyed one follows its Keyframes, not the duck.
    const keys = [
      { at: 0, value: 1, ease: LINEAR },
      { at: 10, value: 0, ease: LINEAR },
    ];
    const keyed = underVolumeLine(ducked([[4, 5]], { keys }), [4, 5]);
    expect(keyed[0]).toEqual({ time: 4, height: volumeHeight(0.6) });
    expect(keyed.at(-1)!.time).toBe(5);
    expect(keyed.at(-1)!.height).toBeCloseTo(volumeHeight(0.5));
  });
});
