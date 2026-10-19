// .scratch/audio-mixing/issues/09-detach-and-reattach.md: Detach (GLOSSARY.md, docs/adr/0016) moves a
// Segment's sound onto a Music Clip heard as it was, the Segment Muted; Reattach deletes the Music
// Clips Detached from it and unmutes it. Each is one change; split, duplicate and the Clipboard keep the
// back-reference only where it still names a Segment of the Candidate.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, MusicClip } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { LINEAR } from "../editor/keyframes";
import { BLURRED, IDENTITY } from "../editor/picture";
import { playedFrom, type PlayedSegment } from "../editor/playback";
import { canDetach, canReattach, detach, duplicate, reattach, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });
const video = (id: string, media: string, changes: Partial<ClipSegment> = {}): ClipSegment =>
  segment(id, 2, 6, { media, framing: { transform: IDENTITY, crop: NO_CROP, background: BLURRED }, volume: 1, ...changes });
const key = (at: number, value: number): Keyframe => ({ at, value, ease: LINEAR });
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
    segments: [segment("s1", 100, 110), segment("s2", 200, 210)],
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

// "clip" has sound; "mute-clip" doesn't.
const sounded = (media: string) => media === "clip";

// The Main Track as planned: Segments snapped to Words, overlapping by a Transition's length.
const planned = (state: AdvancedEdits, overlaps: number[] = []): PlayedSegment[] => {
  const track = playedFrom(state.segments);
  let by = 0;
  return track.map((shown, i) => {
    const at = { ...shown, start: shown.start - by, end: shown.end - by };
    by += overlaps[i] ?? 0;
    return at;
  });
};

describe("Detach", () => {
  test("a Source Segment's sound becomes a Music Clip of the episode heard as it was: its range, Speed, pitch, volume, fades and volume Keyframes; it is Muted", () => {
    const keys = { volume: [key(1, 1), key(4, 0.5)] };
    const sped = segment("s1", 100, 110, { speed: 2, pitch: true, volume: 0.8, fade_in: 0.5, fade_out: 1, keys });
    const state = edits({ segments: [sped, segment("s2", 200, 210)] });
    const outcome = detach(scene(state), ["s1"], planned(state), sounded)!;
    const [clip] = outcome.edits.music;
    expect(clip).toEqual({
      id: "n1",
      media: null,
      start: 0,
      secs: 5,
      offset: 100,
      volume: 0.8,
      speed: 2,
      pitch: true,
      reverse: false,
      fade_in: 0.5,
      fade_out: 1,
      keys,
      detached_from: "s1",
      duck: null,
    });
    expect(outcome.edits.segments.map((each) => each.muted ?? false)).toEqual([true, false]);
    // The Segment keeps its volume, Keyframes and fades for when it is Reattached.
    expect(outcome.edits.segments[0]).toMatchObject({ volume: 0.8, keys, fade_in: 0.5, fade_out: 1 });
    expect(outcome.pick).toEqual(picked({ kind: "music", id: "n1" }));
  });

  test("covers a Transition's overlap at either end: from where its sound starts on the Timeline, as long as it is heard", () => {
    // A 1 s Transition between s1 and s2, and one of 2 s between s2 and s3: as planned, s2 starts at
    // 9 s and s3 at 17 s.
    const state = edits({ segments: [segment("s1", 100, 110), segment("s2", 200, 210), segment("s3", 300, 305)] });
    const track = planned(state, [1, 2]);
    const outcome = detach(scene(state, null, { played: track }), ["s2", "s3"], track, sounded)!;
    expect(outcome.edits.music.map(({ start, secs, offset, detached_from }) => ({ start, secs, offset, detached_from }))).toEqual([
      { start: 9, secs: 10, offset: 200, detached_from: "s2" },
      { start: 17, secs: 5, offset: 300, detached_from: "s3" },
    ]);
    expect(outcome.pick).toEqual(picked({ kind: "music", id: "n1" }, { kind: "music", id: "n2" }));
  });

  test("covers a Transition's overlap before the plan catches up, from the Main Track as drafted", () => {
    // The same Transitions, as the edits have them: the drafted Main Track overlaps as the planned one does.
    const state = edits({
      segments: [segment("s1", 100, 110), segment("s2", 200, 210), segment("s3", 300, 305)],
      transitions: [
        { after: "s1", kind: "fade", secs: 1 },
        { after: "s2", kind: "fade", secs: 2 },
      ],
    });
    const track = playedFrom(state.segments, state.transitions);
    expect(track).toEqual(planned(state, [1, 2]));
    // Half the shorter at most: a 4 s Transition before s3 overlaps 2.5 s.
    expect(playedFrom(state.segments, [{ after: "s2", secs: 4 }])[2].start).toBe(17.5);
    const outcome = detach(scene(state, null, { played: track }), ["s2"], track, sounded)!;
    expect(outcome.edits.music.map(({ start, secs }) => ({ start, secs }))).toEqual([{ start: 9, secs: 10 }]);
  });

  test("a video's Segment's sound becomes a Music Clip of the video, in Reverse as it plays", () => {
    const state = edits({ segments: [segment("s1", 100, 104), video("v", "clip", { reverse: true })] });
    const [clip] = detach(scene(state), ["v"], planned(state), sounded)!.edits.music;
    expect(clip).toMatchObject({ media: "clip", start: 4, secs: 4, offset: 2, reverse: true, detached_from: "v" });
  });

  // .scratch/audio-mixing/issues/10: speech isn't ducked, so the server's default for a new song is refused by name.
  test("a Detached sound says it isn't ducked, a video's as well as the episode's", () => {
    const state = edits({ segments: [segment("s1", 100, 104), video("v", "clip")] });
    const music = detach(scene(state), ["s1", "v"], planned(state), sounded)!.edits.music;
    expect(music.map((clip) => [clip.detached_from, clip.duck])).toEqual([["s1", null], ["v", null]]);
  });

  test("the range as planned, its Keyframes only the volume's and kept within it", () => {
    const keys = { volume: [key(3, 0.5)], scale: [key(1, 2)] };
    const state = edits({ segments: [video("v", "clip", { keys })] });
    // Planned 2.5 s long: the Keyframe at 3 s is re-anchored to its end.
    const track = [{ ...planned(state)[0], end: 2.5, source_end: 4.5 }];
    const [clip] = detach(scene(state), ["v"], track, sounded)!.edits.music;
    expect(clip.secs).toBe(2.5);
    expect(Object.keys(clip.keys)).toEqual(["volume"]);
    expect(clip.keys.volume!.at(-1)!.at).toBeLessThanOrEqual(2.5);
  });

  test("is not offered on a Freeze frame, a Muted Segment, a video without sound, or one Detached already", () => {
    const state = edits({
      segments: [
        segment("s1", 100, 110),
        segment("held", 105, 105, { hold: 1 }),
        segment("muted", 120, 125, { muted: true }),
        video("silent", "mute-clip"),
        segment("done", 130, 135),
      ],
      music: [music("d", { media: null, detached_from: "done" })],
    });
    expect(state.segments.map((each) => canDetach(state, each.id, sounded))).toEqual([true, false, false, false, false]);
    expect(detach(scene(state), ["held", "muted", "silent", "done"], planned(state), sounded)).toBeNull();
    // Of a Pick of them all, only the one that allows it.
    const outcome = detach(scene(state), state.segments.map((each) => each.id), planned(state), sounded)!;
    expect(outcome.edits.music.map((clip) => clip.detached_from)).toEqual(["done", "s1"]);
  });
});

describe("Reattach", () => {
  test("after the Detached sound was split and moved, both parts are deleted and the Segment unmuted, as one change", () => {
    const state = edits();
    const detached = detach(scene(state), ["s1"], planned(state), sounded)!.edits;
    const parts = split(scene(detached, picked({ kind: "music", id: "n1" })), 2)!.edits;
    expect(parts.music.map((clip) => clip.detached_from)).toEqual(["s1", "s1"]);
    const slid = { ...parts, music: parts.music.map((clip) => ({ ...clip, start: clip.start + 0.5 })) };
    // Offered on the Segment and on either part.
    expect(canReattach(slid, "s1")).toBe(true);
    const outcome = reattach(scene(slid), "s1")!;
    expect(outcome.edits.music).toEqual([]);
    expect(outcome.edits.segments.map((each) => each.muted ?? false)).toEqual([false, false]);
    expect(outcome.pick).toEqual(picked({ kind: "segment", id: "s1" }));
  });

  test("keeps other Music Clips, and copies nothing back", () => {
    const state = edits({
      segments: [segment("s1", 100, 110, { muted: true, volume: 0.5 }), segment("s2", 200, 210)],
      music: [music("song"), music("d", { media: null, offset: 100, volume: 2, detached_from: "s1" })],
    });
    const outcome = reattach(scene(state), "s1")!;
    expect(outcome.edits.music.map((clip) => clip.id)).toEqual(["song"]);
    expect(outcome.edits.segments[0]).toEqual(segment("s1", 100, 110, { muted: false, volume: 0.5 }));
  });

  test("is not offered once the Segment is gone, nor on a Segment nothing was Detached from", () => {
    const state = edits({ music: [music("d", { media: null, detached_from: "gone" })] });
    expect(canReattach(state, "gone")).toBe(false);
    expect(canReattach(state, "s1")).toBe(false);
    expect(reattach(scene(state), "gone")).toBeNull();
    expect(reattach(scene(state), "s1")).toBeNull();
  });
});

describe("Split", () => {
  test("a Muted Segment's tail stays Muted", () => {
    const state = edits({ segments: [segment("s1", 100, 110, { muted: true })] });
    const outcome = split(scene(state, picked({ kind: "segment", id: "s1" })), 4)!;
    expect(outcome.edits.segments.map((each) => each.muted)).toEqual([true, true]);
  });

  test("a Detached sound whose Segment is gone: its tail, a new Music Clip, no longer names it", () => {
    const state = edits({ music: [music("d", { media: null, offset: 300, detached_from: "gone" })] });
    const outcome = split(scene(state, picked({ kind: "music", id: "d" })), 2)!;
    expect(outcome.edits.music.map((clip) => clip.detached_from ?? null)).toEqual(["gone", null]);
  });

  test("duplicated, a Detached sound's copy names its Segment while it is there", () => {
    const state = edits({ music: [music("d", { media: null, detached_from: "s1" }), music("e", { media: null, detached_from: "gone" })] });
    const outcome = duplicate(scene(state, picked({ kind: "music", id: "d" }, { kind: "music", id: "e" })))!;
    expect(outcome.edits.music.map((clip) => clip.detached_from ?? null)).toEqual(["s1", "gone", "s1", null]);
  });
});

describe("the Clipboard", () => {
  const from = { job: "j1", candidate: "c1" };
  const state = edits({ music: [music("d", { media: null, offset: 100, detached_from: "s1" })] });
  const copied = copy(scene(state, picked({ kind: "music", id: "d" })), from)!;

  test("drops `detached_from` pasting into another Candidate of the Job", () => {
    const [clip] = paste(scene(edits()), copied, 0, { job: "j1", candidate: "c2" }).edits.music;
    expect(clip.media).toBeNull();
    expect(clip.detached_from ?? null).toBeNull();
  });

  test("keeps it pasting into the same Candidate while the Segment is there", () => {
    expect(paste(scene(state), copied, 0, from).edits.music.map((clip) => clip.detached_from ?? null)).toEqual(["s1", "s1"]);
    const without = edits({ segments: [segment("s2", 200, 210)] });
    expect(paste(scene(without), copied, 0, from).edits.music.map((clip) => clip.detached_from ?? null)).toEqual([null]);
  });
});
