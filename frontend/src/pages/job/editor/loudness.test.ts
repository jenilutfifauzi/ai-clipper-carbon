// How loud a sound is heard in the preview, on the cases the backend's tests read too
// (backend/tests/fixtures/gain_vectors.json), so that the preview's gain and the render's can't
// drift; and the curve a keyed sound's gain node follows from the playhead.
import { describe, expect, test } from "vitest";
import cases from "../../../../../backend/tests/fixtures/gain_vectors.json";
import type { AudioEvent, Ease, SegmentPlan } from "../../../api";
import { fadesWithin } from "../advanced/edits";
import { gainAt, segmentHeard, sourceHeard, underSourceVolume, type Heard as TimelineHeard } from "../advanced/timelineView";
import { EASE_IN, LINEAR, valueAt } from "./keyframes";
import { changing, CURVE_RATE, eventSound, loudness, loudnessCurve, segmentSound, type Heard } from "./loudness";
import { playedFrom } from "./playback";

// A case's sound, its optional fields said.
type Case = {
  start: number;
  end: number;
  volume: number;
  fade_in?: number;
  fade_out?: number;
  keys?: { at: number; value: number; ease?: number[] }[];
  muted?: boolean;
  duck?: number;
  speech?: number[][];
  source?: boolean;
  source_volume?: number;
  tail?: number;
  crossfade?: boolean;
};

describe("a sound", () => {
  for (const { name, sound: given, at, ...of } of cases.sounds) {
    const sound = given as Case;
    const isSegment = "item" in of && of.item === "segment";
    // Its fades fitted to it as the planner fits a Music Clip's and a Segment's.
    const fades = fadesWithin({ fade_in: sound.fade_in ?? 0, fade_out: sound.fade_out ?? 0 }, sound.end - sound.start);
    const gain = (sound.keys ?? []).map(({ at, value, ease }) => ({ at, value, ease: (ease ?? LINEAR) as Ease }));
    const muted = sound.muted ?? false;
    const sourceVolume = sound.source_volume ?? 1;
    const speech = (sound.speech ?? []) as [number, number][];
    const tail = sound.tail ?? 0;

    test(`${name}: is as loud as the shared cases say`, () => {
      // A ducked one as the plan has it, with the cases' ramps (`eventSound`); a Segment taken away by
      // the Transition into the next over its tail.
      const ducked = sound.duck != null ? { duck: sound.duck, speech } : {};
      const crossfade = sound.crossfade ? { start: sound.end - tail, end: sound.end } : undefined;
      const media = sound.source ? null : isSegment ? "video" : "song";
      const event: Heard = isSegment
        ? segmentSound(segment({ media, start: sound.start, end: sound.end, volume: sound.volume, gain, ...fades, muted }), sourceVolume, crossfade)
        : eventSound(
            { id: "m", media, source: sound.source, start: sound.start, end: sound.end, offset: 0, volume: sound.volume, gain, ...fades, muted, ...ducked },
            sourceVolume,
            cases.ducking,
          );
      for (const [time, expected] of at) expect(Math.abs(loudness(event, time) - expected), `at ${time}`).toBeLessThan(cases.tolerance);
    });

    // The Timeline draws neither Muted (it draws the Muted look) nor a Transition's crossfade.
    if (muted || sound.crossfade) continue;
    test(`${name}: is drawn on the Timeline as loud as the shared cases say`, () => {
      // Drawn from its start to where the Transition into the next starts, heard on under it.
      const shown = { start: 0, end: sound.end - sound.start - tail };
      const own = { volume: sound.volume, keys: { volume: gain }, fade_in: sound.fade_in, fade_out: sound.fade_out };
      const into = (spans: [number, number][]) => spans.map(([start, end]): [number, number] => [start - sound.start, end - sound.start]);
      const duck = sound.duck != null ? { depth: sound.duck, speech: into(speech), stretches: [], ducking: cases.ducking } : undefined;
      const clip: TimelineHeard = { volume: sound.volume, secs: shown.end, ...fades, keys: gain, duck };
      const heard = isSegment
        ? sound.source
          ? sourceHeard({ source_volume: sourceVolume }, own, shown, tail)
          : segmentHeard(own, shown, tail)
        : sound.source
          ? underSourceVolume(clip, { source_volume: sourceVolume })
          : clip;
      for (const [time, expected] of at) {
        // Within what is drawn of it, and under the Transition (its tail).
        if (time < sound.start || time > sound.end) continue;
        expect(Math.abs(gainAt(time - sound.start, heard) - expected), `at ${time}`).toBeLessThan(cases.tolerance);
      }
    });
  }
});

// A Segment of a video as planned, with `fields`.
const segment = (fields: Partial<SegmentPlan>): SegmentPlan => ({
  start: 0,
  end: 1,
  source_start: 0,
  source_end: 1,
  media: "video",
  volume: 1,
  silent: false,
  scenes: 1,
  gain: [],
  id: "v",
  fade_in: 0,
  fade_out: 0,
  ...fields,
});

describe("a Segment's sound", () => {
  test("is a Source Segment's under the Clip's own volume, a video's at its own", () => {
    const source = segmentSound(segment({ media: null, start: 2, end: 6, volume: 0.5, fade_in: 1 }), 1.5);
    expect(loudness(source, 2.5)).toBeCloseTo(0.375, 6);
    expect(loudness(source, 4)).toBeCloseTo(0.75, 6);
    expect(loudness(segmentSound(segment({ start: 2, end: 6, volume: 0.5 }), 1.5), 4)).toBeCloseTo(0.5, 6);
  });

  test("taken away by a Transition, falls with its crossfade, which multiplies its own fade out", () => {
    // Faded out over its last second, which a Transition overlaps.
    const faded = segment({ start: 0, end: 2, fade_out: 1 });
    const taken = segmentSound(faded, 1, { start: 1, end: 2 });
    for (const [time, expected] of [[0.5, 1], [1, 1], [1.25, 0.75 * 0.75], [1.5, 0.25], [2, 0]]) expect(loudness(taken, time)).toBeCloseTo(expected, 6);
    // Unfaded, the crossfade alone.
    expect(loudness(segmentSound({ ...faded, fade_out: 0 }, 1, { start: 1, end: 2 }), 1.5)).toBeCloseTo(0.5, 6);
  });

  test("taken away along its Transition's sound, and brought in by `crossed`, times its fades", () => {
    const faded = segment({ start: 0, end: 2, fade_out: 1 });
    // Equal power: a quarter cosine over the overlap, times the fade out.
    const taken = segmentSound(faded, 1, { start: 1, end: 2, sound: "equal_power" });
    expect(loudness(taken, 1.5)).toBeCloseTo(Math.cos(Math.PI / 4) * 0.5, 6);
    // A Cut: whole until the middle.
    expect(loudness(segmentSound({ ...faded, fade_out: 0 }, 1, { start: 1, end: 2, sound: "cut" }), 1.4)).toBeCloseTo(1, 6);
    // The incoming side's share multiplies the rest.
    const brought = segmentSound(segment({ start: 0, end: 2, fade_in: 1 }), 1);
    expect(loudness(brought, 0.5, (time) => time)).toBeCloseTo(0.5 * 0.5, 6);
  });
});

describe("a keyed sound", () => {
  // Heard from 3 to 7 s into the Clip, fading in over 0.5 s and out over 1 s, dipped from 100% 1 s
  // into it to 25% 2 s into it, eased in (the shared cases' "keyed and faded").
  const dipped: AudioEvent = {
    id: "m",
    media: "song",
    start: 3,
    end: 7,
    offset: 0,
    volume: 0.5,
    fade_in: 0.5,
    fade_out: 1,
    gain: [
      { at: 1, value: 1, ease: LINEAR },
      { at: 2, value: 0.25, ease: EASE_IN },
    ],
  };

  test("follows a curve sampled 100 times a second from the playhead to its end", () => {
    const curve = loudnessCurve(dipped, 4.2);
    expect(CURVE_RATE).toBe(100);
    expect(curve.length).toBe(281);
    for (const [i, time] of [[0, 4.2], [30, 4.5], [280, 7]]) expect(curve[i]).toBeCloseTo(loudness(dipped, time), 6);
    // At its very end, two values still.
    expect(loudnessCurve(dipped, 7).length).toBe(2);
    // Its last value, just past its end, is its loudness at its end.
    expect(loudnessCurve({ ...dipped, fade_out: 0 }, 4.205).at(-1)).toBe(0.25);
  });

  // Muted (.scratch/audio-mixing/issues/02-muted-agent-render-preview.md), its gain is 0 at every
  // time (the shared cases' "Muted, keyed and faded"), so a curve of it is silence throughout.
  test("Muted, follows a curve of silence", () => {
    expect(loudnessCurve({ ...dipped, muted: true }, 4).every((gain) => gain === 0)).toBe(true);
  });
});

// .scratch/audio-mixing/issues/06: a Source Segment's own sound, as the decks play it.
describe("a Source Segment's sound", () => {
  const keys = [
    { at: 1, value: 1, ease: LINEAR },
    { at: 2, value: 0.25, ease: EASE_IN },
  ];

  test("follows its volume Keyframes from where it starts, times the Clip's own sound", () => {
    const segment = { id: "e", start: 10, end: 14, source_start: 100, volume: 0.8, gain: keys };
    const sound = segmentSound(segment, 0.5);
    for (const time of [10, 11, 11.5, 12, 13.9]) expect(loudness(sound, time)).toBeCloseTo(0.5 * valueAt(keys, time - 10, 0.8), 9);
    // Faded out by a Transition taking it away.
    expect(loudness(segmentSound(segment, 0.5, { start: 13, end: 14 }), 13.5)).toBeCloseTo(0.5 * 0.25 * 0.5, 9);
  });

  test("is keyed from the edits' Segments as played back to back, before a plan has them", () => {
    const [plain, keyed] = playedFrom([{ start: 0, end: 4 }, { start: 100, end: 104, volume: 0.8, keys: { volume: keys } }]);
    expect([plain.gain, keyed.gain]).toEqual([undefined, keys]);
    expect(loudness(segmentSound(keyed, 0.5), 5.5)).toBeCloseTo(0.5 * valueAt(keys, 1.5, 0.8), 9);
  });

  test("unkeyed, is its volume times the Clip's own sound all along", () => {
    const sound = segmentSound({ start: 0, end: 4, source_start: 0, volume: 0.5 }, 0.8);
    expect([loudness(sound, 0), loudness(sound, 3)]).toEqual([0.4, 0.4]);
  });
});

// .scratch/audio-mixing/issues/08: a Music Clip of the Source's sound, under the Clip's own sound.
describe("a Music Clip of the Source's sound", () => {
  const keys = [
    { at: 1, value: 1, ease: LINEAR },
    { at: 2, value: 0.25, ease: EASE_IN },
  ];
  const episode: AudioEvent = { id: "s", media: null, source: true, start: 3, end: 7, offset: 120, volume: 0.8, fade_in: 1, fade_out: 0, gain: [] };

  test("is its volume through its fades times the Clip's own sound, keyed or not", () => {
    for (const time of [3.5, 5]) expect(loudness(eventSound(episode, 0.5), time)).toBeCloseTo(0.5 * loudness(episode, time), 9);
    const keyed = { ...episode, gain: keys };
    for (const time of [3.5, 4.5, 5, 6.9]) expect(loudness(eventSound(keyed, 0.5), time)).toBeCloseTo(0.5 * loudness(keyed, time), 9);
  });

  test("leaves a song's sound as planned, the same sound, and the Source's at the Clip's own 1", () => {
    const song = { ...episode, media: "song", source: false };
    expect(eventSound(song, 0.5)).toBe(song);
    expect(eventSound(episode, 1)).toBe(episode);
  });
});

// .scratch/audio-mixing/issues/10: a ducked song, as its gain node follows it.
describe("a ducked sound", () => {
  const ducking = { lead_secs: 0.25, release_secs: 0.5, bridge_secs: 0.8 };
  const song: AudioEvent = { id: "m", media: "song", start: 0, end: 10, offset: 0, volume: 1, fade_in: 0, fade_out: 0, gain: [], duck: -20, speech: [[3, 5]] };

  test("follows a curve that goes down under speech and comes back up, as the plan's ramps say", () => {
    const sound = eventSound(song, 1, ducking);
    expect(changing(sound)).toBe(true);
    const curve = loudnessCurve(sound, 2);
    // From 2 s, 100 values a second: down from 2.75 s, at a tenth from 3 to 5 s, up by 5.5 s.
    for (const [i, expected] of [[0, 1], [85, 0.64], [150, 0.1], [325, 0.55], [400, 1]]) expect(curve[i]).toBeCloseTo(expected, 5);
  });

  test("isn't ducked without the plan's ramps, nor follows a curve without speech to duck under", () => {
    expect(loudness(eventSound(song, 1), 4)).toBe(1);
    expect(changing(eventSound({ ...song, speech: [] }, 1, ducking))).toBe(false);
  });
});
