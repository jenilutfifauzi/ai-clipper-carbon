// Seam F's fakes (.scratch/navigation-playback/spec.md): video elements and a clock that a test
// drives, for `Playback` and what follows it. Call `vi.unstubAllGlobals()` after each test.
import { vi } from "vitest";
import type { DeckSlot, Playback } from "./playback";

// The fake clock runs in frames this long.
const FRAME_SECS = 0.02;

/**
 * A <video> as `Playback` uses it: its time, paused, muted and rate; `play` and `pause` that fire
 * their events as a browser does; and a seek that is in flight (`seeking`) until the test lands it
 * with `fireSeeked`. While playing, and not seeking, it plays on with the clock. While it `refuse`s,
 * `play` is refused as a browser refuses it (iOS, unbidden): rejected, and it stays paused.
 */
export class FakeVideo extends EventTarget {
  paused = true;
  muted = false;
  playbackRate = 1;
  volume = 1;
  seeking = false;
  refuse = false;
  private at = 0;

  get currentTime() {
    return this.at;
  }

  set currentTime(time: number) {
    this.at = time;
    this.seeking = true;
  }

  play() {
    if (this.refuse) return Promise.reject(new Error("NotAllowedError"));
    if (this.paused) {
      this.paused = false;
      this.dispatchEvent(new Event("play"));
    }
    return Promise.resolve();
  }

  pause() {
    if (!this.paused) {
      this.paused = true;
      this.dispatchEvent(new Event("pause"));
    }
  }

  // The seek in flight lands: the frame there is ready.
  fireSeeked() {
    if (!this.seeking) return;
    this.seeking = false;
    this.dispatchEvent(new Event("seeked"));
  }

  // `secs` of the clock go by.
  run(secs: number) {
    if (!this.paused && !this.seeking) this.at += secs * this.playbackRate;
  }

  // As the code under test takes it.
  get element() {
    return this as unknown as HTMLVideoElement;
  }
}

/** A deck as the test sees it: its master and its follower. */
export interface FakeDeck {
  master: FakeVideo;
  follower: FakeVideo;
}

/**
 * The page's clock, stubbed: `performance.now` and `requestAnimationFrame` run only when the test
 * `advance`s them, frame by frame, the videos made with `video` playing on in step.
 */
export function harness() {
  let now = 0;
  let next = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const videos: FakeVideo[] = [];
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(next, callback);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  const video = () => {
    const made = new FakeVideo();
    videos.push(made);
    return made;
  };

  return {
    video,
    // Two decks, registered on `playback`: the first live, the second parked.
    decks(playback: Playback): [FakeDeck, FakeDeck] {
      const made: [FakeDeck, FakeDeck] = [
        { master: video(), follower: video() },
        { master: video(), follower: video() },
      ];
      made.forEach((deck, slot) => playback.attachDeck(slot as DeckSlot, deck.master.element, deck.follower.element));
      return made;
    },
    // `secs` go by, a frame at a time: the playing videos play on, then the frame's callbacks run.
    advance(secs: number) {
      for (let left = secs; left > 1e-9; left -= FRAME_SECS) {
        const step = Math.min(FRAME_SECS, left);
        now += step * 1000;
        for (const each of videos) each.run(step);
        const due = [...frames.values()];
        frames.clear();
        for (const callback of due) callback(now);
      }
    },
    // Every seek in flight lands.
    settle() {
      for (const each of videos) each.fireSeeked();
    },
  };
}
