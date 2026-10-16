// Seam F (.scratch/navigation-playback/spec.md): `Playback` driven by fake videos and a fake clock,
// as worked examples of what each deck's videos are doing.
import { afterEach, describe, expect, test, vi } from "vitest";
import { follow } from "./follow";
import { Playback, playedFrom } from "./playback";
import { harness } from "./playbackHarness";

afterEach(() => {
  vi.unstubAllGlobals();
});

// Two Source Segments: 0–5 s of the Clip from 100 s of the Source, 5–9 s from 200 s.
const twoCuts = () =>
  playedFrom([
    { start: 100, end: 105 },
    { start: 200, end: 204 },
  ]);

describe("two decks", () => {
  test("paused at 1 s, the live deck is at 101 s and the parked deck at the next join's 200 s", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(twoCuts());
    const [live, parked] = stage.decks(playback);
    playback.seek(1);
    expect(live.master.currentTime).toBe(101);
    expect(live.follower.currentTime).toBe(101);
    expect(parked.master.currentTime).toBe(200);
    expect(parked.follower.currentTime).toBe(200);
    expect(parked.master.paused).toBe(true);
    expect(parked.master.muted).toBe(true);
    expect(live.master.muted).toBe(false);
    expect(playback.shownDeck).toBe(0);
  });

  test("playing through 5 s swaps the decks: the parked one plays from 200 s and is heard", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(twoCuts());
    const [first, second] = stage.decks(playback);
    playback.seek(1);
    stage.settle();
    playback.play();
    // 1 s to 4.96 s: the first deck still live.
    stage.advance(3.96);
    expect(playback.shownDeck).toBe(0);
    expect(second.master.paused).toBe(true);
    // Past the handover, 0.03 s before the join.
    stage.advance(0.02);
    expect(playback.shownDeck).toBe(1);
    expect(second.master.currentTime).toBe(200);
    expect(second.master.paused).toBe(false);
    expect(second.follower.paused).toBe(false);
    expect(second.master.muted).toBe(false);
    expect(first.master.paused).toBe(true);
    expect(first.follower.paused).toBe(true);
    expect(first.master.muted).toBe(true);
    expect(playback.playing).toBe(true);
    expect(playback.time).toBe(5);
  });

  test("after the swap the new live deck is read for time, and the old one, with no join left, stays put", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(twoCuts());
    const [first, second] = stage.decks(playback);
    playback.seek(1);
    stage.settle();
    playback.play();
    // To the frame at 4.98 s, past the handover: the swap.
    stage.advance(3.98);
    expect(playback.shownDeck).toBe(1);
    const left = first.master.currentTime;
    // 1 s on: 201 s on the second deck is 6 s into the Clip.
    stage.advance(1);
    expect(second.master.currentTime).toBeCloseTo(201, 5);
    expect(playback.time).toBeCloseTo(6, 5);
    expect(first.master.currentTime).toBe(left);
    expect(first.master.paused).toBe(true);
  });

  test("with the parked deck's seek not landed by the handover, the live deck seeks, and playing goes on", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(twoCuts());
    const [first, second] = stage.decks(playback);
    playback.seek(1);
    first.master.fireSeeked();
    first.follower.fireSeeked();
    playback.play();
    stage.advance(3.98);
    expect(playback.shownDeck).toBe(0);
    expect(first.master.currentTime).toBe(200);
    expect(first.follower.currentTime).toBe(200);
    expect(first.master.paused).toBe(false);
    expect(second.master.paused).toBe(true);
    expect(playback.playing).toBe(true);
    first.master.fireSeeked();
    first.follower.fireSeeked();
    stage.advance(1);
    expect(playback.time).toBeCloseTo(6, 5);
    expect(playback.playing).toBe(true);
  });

  test("through a media Segment its clock runs while the Source decks wait, its video parked at its start before", () => {
    // 0–5 s from 100 s of the Source, 5–8 s of a video from 10 s into it, 8–12 s from 200 s.
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(
      playedFrom([
        { start: 100, end: 105 },
        { start: 10, end: 13, media: "intro" },
        { start: 200, end: 204 },
      ]),
    );
    const [first, second] = stage.decks(playback);
    const media = stage.video();
    playback.subscribe(() => follow(media.element, playback, { start: 5, end: 8, from: 10 }, true));
    playback.seek(1);
    expect(media.currentTime).toBe(10);
    expect(media.paused).toBe(true);
    expect(second.master.currentTime).toBe(200);
    stage.settle();
    playback.play();
    stage.advance(3.98);
    expect(playback.current.media).toBe("intro");
    expect(first.master.paused).toBe(true);
    expect(first.follower.paused).toBe(true);
    expect(media.paused).toBe(false);
    const waiting = first.master.currentTime;
    stage.advance(1);
    expect(playback.time).toBeCloseTo(6, 5);
    expect(media.currentTime).toBeCloseTo(11, 5);
    expect(first.master.currentTime).toBe(waiting);
    expect(second.master.paused).toBe(true);
    // Past 7.97 s, the handover into the last Segment: the parked deck takes it from 200 s.
    stage.advance(1.98);
    expect(playback.shownDeck).toBe(1);
    expect(second.master.currentTime).toBe(200);
    expect(second.master.paused).toBe(false);
    expect(media.paused).toBe(true);
    expect(media.currentTime).toBe(10);
  });

  test("the old live deck parks for the join after, and the decks swap back there", () => {
    // 0–5 s from 100 s, 5–9 s from 200 s, 9–12 s from 300 s.
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(
      playedFrom([
        { start: 100, end: 105 },
        { start: 200, end: 204 },
        { start: 300, end: 303 },
      ]),
    );
    const [first, second] = stage.decks(playback);
    playback.seek(1);
    stage.settle();
    playback.play();
    stage.advance(3.98);
    expect(playback.shownDeck).toBe(1);
    expect(first.master.currentTime).toBe(300);
    expect(first.master.paused).toBe(true);
    stage.settle();
    // 5 s to 8.98 s, past the handover at 8.97 s.
    stage.advance(3.98);
    expect(playback.shownDeck).toBe(0);
    expect(first.master.currentTime).toBe(300);
    expect(first.master.paused).toBe(false);
    expect(first.master.muted).toBe(false);
    expect(second.master.paused).toBe(true);
    expect(second.master.muted).toBe(true);
    expect(playback.time).toBe(9);
  });

  test("seeking, and changing the Segments, park the parked deck again", () => {
    // 0–5 s from 100 s, 5–9 s from 200 s, 9–12 s from 300 s.
    const stage = harness();
    const playback = new Playback();
    playback.setSegments(
      playedFrom([
        { start: 100, end: 105 },
        { start: 200, end: 204 },
        { start: 300, end: 303 },
      ]),
    );
    const [first, second] = stage.decks(playback);
    playback.seek(1);
    expect(second.master.currentTime).toBe(200);
    // Into the second Segment: the next join is the third's.
    playback.seek(6);
    expect(first.master.currentTime).toBe(201);
    expect(second.master.currentTime).toBe(300);
    expect(second.follower.currentTime).toBe(300);
    // The third Segment now from 350 s.
    stage.settle();
    playback.setSegments(
      playedFrom([
        { start: 100, end: 105 },
        { start: 200, end: 204 },
        { start: 350, end: 353 },
      ]),
    );
    expect(second.master.currentTime).toBe(350);
    expect(second.master.seeking).toBe(true);
    expect(playback.time).toBe(6);
  });

  test("a one-Segment Clip plays and stops at its end, the other deck never moving", () => {
    const stage = harness();
    const playback = new Playback();
    playback.setRange(100, 103);
    const [first, second] = stage.decks(playback);
    playback.seek(0);
    stage.settle();
    playback.play();
    stage.advance(3.5);
    expect(playback.playing).toBe(false);
    expect(playback.time).toBe(3);
    expect(first.master.paused).toBe(true);
    expect(first.follower.paused).toBe(true);
    expect(first.master.currentTime).toBe(103);
    expect(second.master.seeking).toBe(false);
    expect(second.master.paused).toBe(true);
    expect(playback.shownDeck).toBe(0);
  });
});
