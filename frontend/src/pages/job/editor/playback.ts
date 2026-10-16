import { useSyncExternalStore } from "react";

type Listener = () => void;

/**
 * A Segment of the Clip as played: the Source from `source_start` to `source_end`, from `start` to
 * `end` seconds into the Clip; or, with `media`, a Media Library video from `source_start` to
 * `source_end` seconds into it, which the preview plays itself while the Source waits. Its own
 * sound is at `volume`.
 */
export interface PlayedSegment {
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  media?: string | null;
  volume?: number;
}

/** A Main Track of these Segments as played, back to back from 0 s. */
export function playedFrom(segments: { start: number; end: number; media?: string | null; volume?: number }[]): PlayedSegment[] {
  let at = 0;
  return segments.map((segment) => {
    const played = {
      start: at,
      end: at + segment.end - segment.start,
      source_start: segment.start,
      source_end: segment.end,
      media: segment.media ?? null,
      volume: segment.volume ?? 1,
    };
    at = played.end;
    return played;
  });
}

/**
 * A plan's Segments as played: where a Transition overlaps two, the first gives way to the next
 * where the Transition starts (the preview draws the Transition over it).
 */
export function playable(segments: PlayedSegment[]): PlayedSegment[] {
  return segments.map((segment, i) => {
    const next = segments[i + 1];
    if (!next || next.start >= segment.end) return segment;
    return { ...segment, end: next.start, source_end: segment.source_start + (next.start - segment.start) };
  });
}

// A Segment that isn't the last hands over this long before its end, so that no frame past it shows.
const HANDOVER_SECS = 0.03;
// A follower video further than this from its master is moved back in step.
const MAX_DRIFT_SECS = 0.12;

/** One of the preview's two decks. */
export type DeckSlot = 0 | 1;

/**
 * A full set of the Source's panel videos: the master, read for time and heard while its deck is
 * live, and the follower for the second panel of a Split or Blur Scene, always muted.
 */
interface Deck {
  master: HTMLVideoElement;
  follower: HTMLVideoElement | null;
  // Where in the Source it was last parked, until it is live again.
  parked: number | null;
  // Its videos whose last seek hasn't landed (fired `seeked`) yet.
  landing: Set<HTMLVideoElement>;
  detach: () => void;
}

/**
 * The preview's playback of a Candidate: the Source played on two decks
 * (docs/adr/0006-the-preview-plays-the-source-on-two-decks.md), and its time in seconds into the
 * Clip. The Clip is one range of the Source or several Segments, back to back
 * (docs/adr/0002-segments-and-timeline-time.md). The live deck plays and is heard; the other waits,
 * paused and muted, where the next Source Segment starts, and at the join the two swap, so that the
 * join doesn't wait for a seek. When the parked deck isn't ready there (its seek hasn't landed),
 * the live deck seeks instead. Through a Segment of a Media Library video, the Source decks wait and
 * the time runs on a clock of its own, which that video's player follows. The preview, its other
 * media and the timeline all read and set the time through it. Playing stops at the Clip's end,
 * checked every frame; started outside the Clip (before its start), it plays freely.
 */
export class Playback {
  private decks: [Deck | null, Deck | null] = [null, null];
  // The deck played, heard and read for time; the other is parked.
  private live: DeckSlot = 0;
  private listeners = new Set<Listener>();
  private frame = 0;
  private armed = false;
  segments: PlayedSegment[] = [{ start: 0, end: 0, source_start: 0, source_end: 0 }];
  // The Segment the time is in.
  private index = 0;
  // While playing a video's Segment: when the clock read `from` seconds into the Clip.
  private clock: { at: number; from: number } | null = null;
  // The live deck paused here to hand over to a video's Segment: not a pause of the playback.
  private handing = false;
  // In seconds into the Clip, as last read: updated every frame while playing.
  time = 0;
  playing = false;

  get duration() {
    return this.segments[this.segments.length - 1].end;
  }

  private get segment() {
    return this.segments[this.index];
  }

  // The Segment the time is in, and which of them it is.
  get current(): PlayedSegment {
    return this.segment;
  }

  get segmentIndex(): number {
    return this.index;
  }

  // The deck whose videos the panels show.
  get shownDeck(): DeckSlot {
    return this.live;
  }

  // The Clip as one range of the Source.
  setRange(start: number, end: number) {
    this.setSegments([{ start: 0, end: end - start, source_start: start, source_end: end }]);
  }

  setSegments(segments: PlayedSegment[]) {
    if (!segments.length || JSON.stringify(segments) === JSON.stringify(this.segments)) return;
    const moved = segments[0].source_start !== this.segments[0].source_start;
    this.segments = segments;
    // The time's Segment may be gone (one deleted): kept inside the new Segments before anything reads it.
    this.index = Math.min(this.index, segments.length - 1);
    // A moved start waits at the new start; otherwise the time is kept, inside the Clip.
    if (!this.playing) this.seek(moved ? 0 : Math.min(this.time, this.duration));
    else this.park();
  }

  /**
   * Registers deck `slot`'s videos, or lets go of them with no master. The live deck (the first, to
   * begin with) is heard; the other is parked as soon as it comes. A preview with one deck (a
   * Transition's ghost) seeks at every join.
   */
  attachDeck(slot: DeckSlot, master: HTMLVideoElement | null, follower: HTMLVideoElement | null = null) {
    this.decks[slot]?.detach();
    this.decks[slot] = null;
    if (!master) return;
    const deck: Deck = { master, follower, parked: null, landing: new Set(), detach: () => {} };
    const live = () => this.decks[this.live] === deck;
    const onPlay = () => {
      if (!live()) return;
      this.armed = this.read() >= -0.05 && this.read() < this.duration;
      this.start();
    };
    const onPause = () => {
      if (!live()) return;
      if (this.handing) {
        this.handing = false;
        return;
      }
      if (this.clock) return;
      this.stop();
    };
    const onSeeked = (event: Event) => {
      deck.landing.delete(event.target as HTMLVideoElement);
      if (!live() || event.target !== master || this.segment.media) return;
      this.time = this.read();
      this.emit();
    };
    const onLoaded = () => {
      if (live()) return this.seek(this.time);
      deck.parked = null;
      this.park();
    };
    const videos = follower ? [master, follower] : [master];
    for (const video of videos) {
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("loadedmetadata", onLoaded);
    }
    master.addEventListener("play", onPlay);
    master.addEventListener("pause", onPause);
    deck.detach = () => {
      if (live()) cancelAnimationFrame(this.frame);
      for (const video of videos) {
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("loadedmetadata", onLoaded);
      }
      master.removeEventListener("play", onPlay);
      master.removeEventListener("pause", onPause);
    };
    this.decks[slot] = deck;
    master.muted = !live();
    if (follower) follower.muted = true;
    if (!live()) this.park();
  }

  private start() {
    this.playing = true;
    this.schedule();
    this.emit();
  }

  private stop() {
    this.time = this.read();
    this.clock = null;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.emit();
  }

  // The next frame's tick, only once however often it is asked for.
  private schedule() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  }

  private read() {
    const segment = this.segment;
    if (segment.media) return this.clock ? this.clock.from + (performance.now() - this.clock.at) / 1000 : this.time;
    const deck = this.decks[this.live];
    return deck ? segment.start + (deck.master.currentTime - segment.source_start) : this.time;
  }

  // A deck's videos sent to `source` seconds into the Source.
  private cue(deck: Deck, source: number) {
    for (const video of deck.follower ? [deck.master, deck.follower] : [deck.master]) {
      video.currentTime = source;
      deck.landing.add(video);
    }
  }

  private run(deck: Deck) {
    void deck.master.play().catch(() => {});
    if (deck.follower) void deck.follower.play().catch(() => {});
  }

  private halt(deck: Deck) {
    deck.master.pause();
    deck.follower?.pause();
  }

  // Where the parked deck waits, in the Source: the start of the next Source Segment after the time's,
  // or nowhere when none is left.
  private parkTarget(): number | null {
    const next = this.segments.slice(this.index + 1).find((segment) => !segment.media);
    return next ? next.source_start : null;
  }

  // The parked deck, paused and muted, to where the playback will need it next, unless it is there.
  private park() {
    const deck = this.decks[1 - this.live];
    const target = this.parkTarget();
    if (!deck || target === null || deck.parked === target) return;
    this.halt(deck);
    deck.master.muted = true;
    deck.parked = target;
    this.cue(deck, target);
  }

  // The live deck's follower plays, pauses and keeps step with its master.
  private align() {
    const deck = this.decks[this.live];
    const follower = deck?.follower;
    if (!deck || !follower) return;
    const master = deck.master;
    if (Math.abs(follower.currentTime - master.currentTime) > MAX_DRIFT_SECS) follower.currentTime = master.currentTime;
    if (master.paused !== follower.paused) {
      if (master.paused) follower.pause();
      else void follower.play().catch(() => {});
    }
  }

  // Into the Segment at `index`, from its start, still playing.
  private enter(index: number) {
    const from = this.segment;
    this.index = index;
    const next = this.segment;
    this.time = next.start;
    const deck = this.decks[this.live];
    if (next.media) {
      this.clock = { at: performance.now(), from: next.start };
      if (!from.media && deck && !deck.master.paused) {
        this.handing = true;
        this.halt(deck);
      }
    } else {
      this.clock = null;
      const parked = this.decks[1 - this.live];
      if (parked && this.ready(parked, next.source_start)) this.swap();
      else if (deck) {
        this.cue(deck, next.source_start);
        if (from.media) this.run(deck);
      }
    }
    this.park();
  }

  // Whether a deck waits at `source`, its frame there ready.
  private ready(deck: Deck, source: number) {
    return deck.parked === source && deck.landing.size === 0;
  }

  // The parked deck goes live, playing from where it waits and heard; the old live deck is paused,
  // muted, and parked again by the caller.
  private swap() {
    const old = this.decks[this.live];
    this.live = this.live === 0 ? 1 : 0;
    const deck = this.decks[this.live]!;
    deck.parked = null;
    deck.master.muted = false;
    this.run(deck);
    if (old) {
      this.halt(old);
      old.master.muted = true;
    }
  }

  private tick = () => {
    this.time = this.read();
    const last = this.index === this.segments.length - 1;
    if (this.armed && !last && this.time >= this.segment.end - HANDOVER_SECS) {
      this.enter(this.index + 1);
    } else if (this.armed && last && this.time >= this.duration) {
      this.pause();
      this.seek(this.duration);
      return;
    }
    this.emit();
    this.schedule();
  };

  // To `time` seconds into the Clip.
  seek(time: number) {
    const index = this.segments.findIndex((segment) => time < segment.end);
    const wasMedia = !!this.segment.media;
    this.index = index === -1 ? this.segments.length - 1 : index;
    this.time = time;
    const segment = this.segment;
    const deck = this.decks[this.live];
    if (segment.media) {
      if (this.playing) {
        this.clock = { at: performance.now(), from: time };
        if (!wasMedia && deck && !deck.master.paused) {
          this.handing = true;
          this.halt(deck);
        }
      }
    } else {
      const resume = this.playing && !!this.clock;
      this.clock = null;
      if (deck) {
        this.cue(deck, segment.source_start + (time - segment.start));
        if (resume) this.run(deck);
      }
    }
    this.park();
    this.emit();
  }

  play(from?: number) {
    if (from !== undefined) this.seek(from);
    const deck = this.decks[this.live];
    if (this.segment.media) {
      this.armed = this.time >= -0.05 && this.time < this.duration;
      this.clock = { at: performance.now(), from: this.time };
      this.start();
    } else if (deck) this.run(deck);
  }

  pause() {
    const deck = this.decks[this.live];
    if (this.clock) this.stop();
    else if (deck) this.halt(deck);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play(this.time >= this.duration - 0.05 ? 0 : undefined);
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private emit() {
    this.align();
    for (const listener of this.listeners) listener();
  }
}

/**
 * What `select` makes of the playback's time and state, re-rendering only when that changes: select
 * a primitive (an index, a key, a rounded time), not a new object.
 */
export function usePlayback<T extends string | number | boolean | null>(
  playback: Playback,
  select: (time: number, playback: Playback) => T,
): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.time, playback));
}
