// A reversed media Segment in the preview (.scratch/speed/issues/06-retimed-copies-and-reversed-media-segment.md),
// and a reversed Segment of the Source (07): `Playback` with the fake videos and clock, the Segment's
// own videos following it as `mediaPlay` and `reversedPlay` say.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RetimedCopy, SegmentPlan } from "../../../api";
import { follow } from "./follow";
import { Playback, playedFrom } from "./playback";
import { harness } from "./playbackHarness";
import { mediaPlay, reversedPlay } from "./retimedCopy";

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

// A copy of 48–56 s of the Source: 50–54 s is in it from 56 − 54 = 2 s on.
const SOURCE_COPY: RetimedCopy = { progress: 1, url: "/media/job/retimed/reversed-preview-48000-56000.mp4", at: 2, error: null };

// 0–5 s from 100 s of the Source, then 50–54 s of it backwards (5–9 s), then 4 s from 200 s; the
// reversed one's own master and follower following it as `reversedPlay` says.
function reversedSource(copy: RetimedCopy | null) {
  const stage = harness();
  const playback = new Playback();
  const segments = playedFrom([
    { start: 100, end: 105 },
    { start: 50, end: 54, reverse: true },
    { start: 200, end: 204 },
  ]);
  playback.setSegments(segments);
  const [first, second] = stage.decks(playback);
  const own = { master: stage.video(), follower: stage.video() };
  const played = segments[1];
  const segment = { ...played, source_end: 54, media: null, pitch: false } as SegmentPlan;
  const { src, span } = reversedPlay(segment, played.end, copy, "/media/job/preview.mp4", 1 / 30);
  playback.subscribe(() => {
    follow(own.master.element, playback, span, true);
    follow(own.follower.element, playback, span, true);
  });
  return { stage, playback, first, second, own, src };
}

describe("a reversed Segment of the Source", () => {
  test("plays backwards from its copy on its own master and follower, the decks resuming at the next forward Segment seamlessly", () => {
    const { stage, playback, first, second, own, src } = reversedSource(SOURCE_COPY);
    expect(src).toBe(SOURCE_COPY.url);
    playback.seek(1);
    // The parked deck waits for the forward Segment after it; its own videos wait at its first frame.
    expect(second.master.currentTime).toBe(200);
    expect([own.master.currentTime, own.follower.currentTime]).toEqual([2, 2]);
    stage.settle();
    playback.play();
    stage.advance(3.9);
    expect(playback.segmentIndex).toBe(0);
    expect(own.master.paused).toBe(true);
    // Into it: the decks pause and wait, its videos play the copy in step, the time on a clock.
    stage.advance(0.2);
    expect(playback.segmentIndex).toBe(1);
    expect(first.master.paused).toBe(true);
    expect(second.master.paused).toBe(true);
    expect(own.master.paused).toBe(false);
    stage.advance(2);
    expect(playback.time).toBeCloseTo(7.1, 1);
    // 2.1 s into it: 4.1 s into the copy, 51.9 s of the Source played backwards.
    expect(own.master.currentTime).toBeCloseTo(4.1, 1);
    expect(own.follower.currentTime).toBeCloseTo(own.master.currentTime, 5);
    // Out of it on time: the deck waiting at 200 s plays on, and its own videos stop.
    stage.advance(2);
    expect(playback.segmentIndex).toBe(2);
    expect(playback.shownDeck).toBe(1);
    expect(second.master.paused).toBe(false);
    expect(own.master.paused).toBe(true);
    stage.advance(0.5);
    expect(playback.time).toBeCloseTo(9.6, 1);
    expect(second.master.currentTime).toBeCloseTo(200.6, 1);
  });

  test("holds the frame its copy will show first on the Source while the copy is made, the time running on", () => {
    const { stage, playback, own, src } = reversedSource({ progress: 0.4, url: null, at: null, error: null });
    expect(src).toBe("/media/job/preview.mp4");
    playback.seek(5.5);
    stage.settle();
    playback.play();
    stage.advance(1);
    expect(playback.time).toBeCloseTo(6.5, 5);
    expect(own.master.currentTime).toBeCloseTo(54 - 1 / 30, 5);
    expect(own.master.paused).toBe(true);
  });
});
