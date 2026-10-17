// A reversed media Segment in the preview (.scratch/speed/issues/06-retimed-copies-and-reversed-media-segment.md),
// and Segments and Overlays at a Speed a browser won't play (.scratch/speed/issues/09-preview-copies-and-sweep.md):
// `Playback` with the fake videos and clock, the Segment's video following it as `mediaPlay` says.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { RetimedCopy, SegmentPlan } from "../../../api";
import { follow } from "./follow";
import { Playback, playedFrom } from "./playback";
import { harness } from "./playbackHarness";
import { copyProgress, eventCopy, eventPlay, mediaPlay, previewCopyOf, segmentCopy } from "./retimedCopy";

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

// 0–5 s from 100 s of the Source, then `range` of a video at `speed`, then 4 s from 200 s.
function spedMedia(range: [number, number], speed: number, copy: RetimedCopy | null, pitch = false) {
  const stage = harness();
  const playback = new Playback();
  const segments = playedFrom([
    { start: 100, end: 105 },
    { start: range[0], end: range[1], media: "intro", speed, pitch },
    { start: 200, end: 204 },
  ]);
  playback.setSegments(segments);
  stage.decks(playback);
  const media = stage.video();
  const played = segments[1];
  const segment = { ...played, source_end: range[1], media: "intro", pitch } as SegmentPlan;
  const { src, span } = mediaPlay(segment, played.end, copy);
  playback.subscribe(() => follow(media.element, playback, span, true));
  return { stage, playback, media, src, played, segment };
}

const retimed = (name: string): RetimedCopy => ({ progress: 1, url: `/api/media/intro/retimed/${name}`, at: 0, error: null });

describe("an item at a Speed a browser won't play", () => {
  test("plays from a copy retimed at it outside 0.25–4×, in Reverse from a reversed one, else from its own file", () => {
    expect(previewCopyOf({ start: 0, end: 8, speed: 8 })).toEqual({ start: 0, end: 8, reverse: false, speed: 8, pitch: false });
    expect(previewCopyOf({ start: 0, end: 1, speed: 0.125, pitch: true })).toEqual({ start: 0, end: 1, reverse: false, speed: 0.125, pitch: true });
    expect(previewCopyOf({ start: 0, end: 8, speed: 8, reverse: true })).toEqual({ start: 0, end: 8, reverse: true, speed: 8, pitch: false });
    expect(previewCopyOf({ start: 0, end: 8, speed: 2, reverse: true })).toEqual({ start: 0, end: 8, reverse: true });
    expect(previewCopyOf({ start: 0, end: 8, speed: 4 })).toBeNull();
    expect(previewCopyOf({ start: 0, end: 8, speed: 0.25 })).toBeNull();
    // A Freeze frame plays none; an Overlay's is of what it shows of its video.
    expect(segmentCopy({ start: 0, end: 1, source_start: 3, source_end: 3, hold: 1 } as SegmentPlan)).toBeNull();
    expect(eventCopy({ start: 2, end: 2.5, offset: 1, speed: 16 })).toEqual({ start: 1, end: 9, reverse: false, speed: 16, pitch: false });
    expect(copyProgress({ start: 0, end: 8, speed: 8 }, { progress: 0.4, url: null, at: null, error: null })).toBe("Retiming… 40%");
    expect(copyProgress({ start: 0, end: 8, reverse: true }, { progress: 0, url: null, at: null, error: "x" })).toBe("Couldn't reverse this video");
  });

  test("a media Segment at 8× plays its copy at the preview rate, with its pitch kept, in an eighth of its range, and leaves at its Timeline end", () => {
    const { stage, playback, media, src, played } = spedMedia([0, 8], 8, retimed("retimed-preview-0-8000-x8.mp4"));
    expect([played.start, played.end]).toEqual([5, 6]);
    expect(src).toBe("/api/media/intro/retimed/retimed-preview-0-8000-x8.mp4");
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(0.5);
    expect(media.playbackRate).toBe(1);
    expect(media.preservesPitch).toBe(true);
    expect(media.paused).toBe(false);
    // Played on, not moved back in step: half its copy, 4 s of the video.
    expect(media.currentTime).toBeCloseTo(0.5, 5);
    stage.advance(0.6);
    expect(playback.time).toBeCloseTo(6.1, 1);
    expect(playback.current.media).toBeFalsy();
    expect(media.paused).toBe(true);
  });

  test("its copy follows the preview rate", () => {
    const { stage, playback, media } = spedMedia([0, 8], 8, retimed("retimed-preview-0-8000-x8.mp4"));
    playback.setRate(2);
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(0.25);
    expect(media.playbackRate).toBe(2);
    expect(media.currentTime).toBeCloseTo(0.5, 5);
  });

  test("a media Segment at 0.125× plays its copy at eight times its range", () => {
    const { stage, playback, media, played } = spedMedia([1, 2], 0.125, retimed("retimed-preview-1000-2000-x0.125.mp4"));
    expect([played.start, played.end]).toEqual([5, 13]);
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(4);
    expect(media.playbackRate).toBe(1);
    expect(media.currentTime).toBeCloseTo(4, 5);
    expect(playback.current.media).toBe("intro");
    stage.advance(4.1);
    expect(playback.current.media).toBeFalsy();
  });

  test("shows its first frame held while its copy is made, and the Timeline time runs on", () => {
    const { stage, playback, media, src } = spedMedia([2, 10], 8, { progress: 0.4, url: null, at: null, error: null });
    expect(src).toBe("/api/media/intro/proxy");
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(0.5);
    expect(playback.time).toBeCloseTo(5.5, 5);
    expect(media.currentTime).toBe(2);
    expect(media.paused).toBe(true);
  });

  test("changed from 8× to 2×, it plays its own file again with no copy", () => {
    const { segment } = spedMedia([0, 8], 2, null);
    expect(segmentCopy(segment)).toBeNull();
    const { stage, playback, media, src } = spedMedia([0, 8], 2, retimed("retimed-preview-0-8000-x8.mp4"));
    expect(src).toBe("/api/media/intro/proxy");
    playback.seek(5);
    stage.settle();
    playback.play();
    stage.advance(1);
    expect(media.playbackRate).toBe(2);
    expect(media.currentTime).toBeCloseTo(2, 5);
  });

  test("an Overlay's video and sound at 16× play its copy at the preview rate; at 2× their own files", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(playedFrom([{ start: 100, end: 110 }]));
    stage.decks(playback);
    const event = { start: 2, end: 2.5, offset: 1, speed: 16, pitch: false };
    const video = stage.video();
    const copy = retimed("retimed-preview-1000-9000-x16.mp4");
    const shown = eventPlay(event, "/api/media/intro/proxy", copy);
    expect(shown.src).toBe(copy.url);
    playback.subscribe(() => follow(video.element, playback, shown.span));
    playback.seek(2);
    stage.settle();
    playback.play();
    stage.advance(0.25);
    expect(video.playbackRate).toBe(1);
    expect(video.currentTime).toBeCloseTo(0.25, 5);
    expect(eventPlay({ ...event, speed: 2 }, "/api/media/intro", copy)).toEqual({
      src: "/api/media/intro",
      span: { start: 2, end: 2.5, from: 1, speed: 2, pitch: false },
    });
  });
});
