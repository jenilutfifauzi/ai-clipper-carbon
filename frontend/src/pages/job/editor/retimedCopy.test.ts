// A reversed media Segment in the preview (.scratch/speed/issues/06-retimed-copies-and-reversed-media-segment.md):
// `Playback` with the fake videos and clock, the Segment's video following it as `mediaPlay` says.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RetimedCopy, SegmentPlan } from "../../../api";
import { follow } from "./follow";
import { Playback, playedFrom } from "./playback";
import { harness } from "./playbackHarness";
import { mediaPlay } from "./retimedCopy";

afterEach(() => {
  vi.unstubAllGlobals();
});

const BEING_MADE: RetimedCopy = { progress: 0.4, url: null, at: null, error: null };
// A copy of 8–20 s of the video: 12–16 s is in it from 20 − 16 = 4 s on.
const MADE: RetimedCopy = { progress: 1, url: "/api/media/intro/retimed/reversed-preview-8000-20000.mp4", at: 4, error: null };

// 0–5 s from 100 s of the Source, then 12–16 s of a video backwards at `speed`, then 4 s from 200 s.
function reversedMedia(speed: number, copy: RetimedCopy | null) {
  const stage = harness();
  const playback = new Playback();
  const segments = playedFrom([
    { start: 100, end: 105 },
    { start: 12, end: 16, media: "intro", speed, reverse: true },
    { start: 200, end: 204 },
  ]);
  playback.setSegments(segments);
  stage.decks(playback);
  const media = stage.video();
  const played = segments[1];
  const segment = { ...played, source_end: 16, media: "intro", pitch: false } as SegmentPlan;
  const { src, span } = mediaPlay(segment, played.end, copy);
  playback.subscribe(() => follow(media.element, playback, span, true));
  return { stage, playback, media, src, played };
}

describe("a reversed media Segment", () => {
  test("plays its copy forwards from where it shows its range, at its Speed", () => {
    const { stage, playback, media, src, played } = reversedMedia(2, MADE);
    expect([played.start, played.end]).toEqual([5, 7]);
    expect(src).toBe(MADE.url);
    // Parked at its first frame: 4 s into the copy, 16 s into the video.
    playback.seek(1);
    expect(media.currentTime).toBe(4);
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(1);
    expect(playback.time).toBeCloseTo(6, 5);
    expect(media.playbackRate).toBe(2);
    expect(media.paused).toBe(false);
    // 2 s into the copy: 14 s into the video, backwards.
    expect(media.currentTime).toBeCloseTo(6, 5);
  });

  test("shows the frame its copy will show first, held, while the copy is made, and the Timeline time runs on", () => {
    const { stage, playback, media, src } = reversedMedia(1, BEING_MADE);
    expect(src).toBe("/api/media/intro/proxy");
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(1.5);
    expect(playback.time).toBeCloseTo(6.5, 5);
    // The last frame before 16 s of the video, paused.
    expect(media.currentTime).toBeCloseTo(16 - 1 / 30, 5);
    expect(media.paused).toBe(true);
    // Past its end, the next Segment plays on time.
    stage.advance(2.6);
    expect(playback.time).toBeCloseTo(9.1, 1);
    expect(playback.current.media).toBeFalsy();
  });
});
