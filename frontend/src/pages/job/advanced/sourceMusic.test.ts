// .scratch/audio-mixing/issues/08-music-clip-of-the-source.md: a Music Clip of the Source's sound
// (docs/adr/0016) in the Advanced Edit: it pastes only into a Candidate of its own Job, as Segments of
// the Source do, and its Speed keeps its read within the episode.
import { describe, expect, test } from "vitest";
import type { ClipSegment, MusicClip } from "../../../api";
import { playedFrom } from "../editor/playback";
import { setSpeed, split, type PickContext } from "./actions";
import { copy, paste } from "./clipboard";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";

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

// The episode's sound from 120 s, heard from 2 s for 3 s.
const episode = music("e", 2, 3, { media: null, offset: 120 });

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

describe("a Music Clip of the Source's sound on the Clipboard", () => {
  const from = { job: "j1", candidate: "c1" };
  const both = copy(scene(edits({ music: [episode, music("m", 6, 2)] }), picked({ kind: "music", id: "e" }, { kind: "music", id: "m" })), from)!;

  test("pastes into a Candidate of the same Job, the episode's same range", () => {
    for (const to of [from, { job: "j1", candidate: "c2" }]) {
      const outcome = paste(scene(edits()), both, 0, to);
      expect(outcome.edits.music.map(({ media, start, secs, offset }) => ({ media, start, secs, offset }))).toEqual([
        { media: null, start: 0, secs: 3, offset: 120 },
        { media: "song", start: 4, secs: 2, offset: 0 },
      ]);
      expect(outcome.notice).toBeUndefined();
    }
  });

  test("is left out of a Candidate of another Job, with a notice, and the song pasted", () => {
    const outcome = paste(scene(edits()), both, 0, { job: "j2", candidate: "c9" });
    expect(outcome.edits.music.map((clip) => clip.media)).toEqual(["song"]);
    expect(outcome.pick).toEqual(picked({ kind: "music", id: outcome.edits.music[0].id }));
    expect(outcome.notice).toBe("1 Music Clip of this episode's sound left out: another Job's clips can't play it.");
  });
});

describe("a Music Clip of the Source's sound, edited", () => {
  test("splits into two reading on through the episode", () => {
    const outcome = split(scene(edits({ music: [episode] }), picked({ kind: "music", id: "e" })), 3)!;
    expect(outcome.edits.music.map(({ media, start, secs, offset }) => ({ media, start, secs, offset }))).toEqual([
      { media: null, start: 2, secs: 1, offset: 120 },
      { media: null, start: 3, secs: 2, offset: 121 },
    ]);
  });

  test("at a Speed, keeps its read within the episode", () => {
    // 2 s are left of a 122 s episode from 120 s: at 2× it plays them in 1 s, not its 1.5 s.
    const outcome = setSpeed(scene(edits({ music: [episode] })), { kind: "music", id: "e" }, 2, { video: 122 })!;
    expect(outcome.edits.music[0]).toMatchObject({ media: null, start: 2, secs: 1, offset: 120, speed: 2 });
  });
});
