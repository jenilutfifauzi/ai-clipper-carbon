import { useSyncExternalStore } from "react";
import type { Keyframe, Keys } from "../../../api";
import { previewSpeed } from "./follow";
import { loopStart, wrapTarget, type LoopRegion } from "./loop";
import { segmentCopy } from "./retimedCopy";
import {
  playedSourceAt,
  playedTimeAt,
  playedUntil,
  retimingOf,
  segmentLength,
  transitionOverlap,
  type PlayedRange,
  type SegmentRange,
} from "./segmentTime";

type Listener = () => void;

/**
 * A Segment of the Clip as played: the Source from `source_start` to `source_end`, from `start` to
 * `end` seconds into the Clip, at its Speed, forwards or in Reverse, or held (segmentTime.ts); or,
 * with `media`, a Media Library video from `source_start` to `source_end` seconds into it, which the
 * preview plays itself while the Source waits. Its own sound is at `volume`, or by its volume
 * Keyframes (`gain`, in seconds from its start), silent when `muted`, its pitch following its Speed
 * with `pitch`.
 */
export interface PlayedSegment extends PlayedRange {
  source_end: number;
  media?: string | null;
  volume?: number;
  gain?: Keyframe[];
  muted?: boolean;
}

/**
 * A Main Track of these Segments as played from 0 s: back to back, or, where one of `transitions`
 * follows a Segment, the next overlapping it for that Transition's overlap, as the planner places them
 * (transitionOverlap).
 */
export function playedFrom(
  segments: (SegmentRange & { id?: string; media?: string | null; volume?: number; keys?: Keys; muted?: boolean })[],
  transitions: readonly { after: string; secs: number }[] = [],
): PlayedSegment[] {
  let at = 0;
  return segments.map((segment, i) => {
    const played = {
      start: at,
      end: at + segmentLength(segment),
      source_start: segment.start,
      source_end: segment.end,
      media: segment.media ?? null,
      volume: segment.volume ?? 1,
      muted: segment.muted ?? false,
      ...retimingOf(segment),
      ...(segment.keys?.volume?.length ? { gain: segment.keys.volume } : {}),
    };
    const join = transitions.find((transition) => transition.after === segment.id);
    const next = segments[i + 1];
    at = join && next ? played.end - transitionOverlap(join.secs, played.end - played.start, segmentLength(next)) : played.end;
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
    return playedUntil(segment, next.start);
  });
}

// A Segment that isn't the last hands over this long before its end, so that no frame past it shows.
const HANDOVER_SECS = 0.03;
// A follower video further than this from its master is moved back in step.
const MAX_DRIFT_SECS = 0.12;
// A skim's snippet of sound lasts this long.
const SNIPPET_SECS = 0.08;

/**
 * Whether a Segment plays on videos of its own while the decks wait: a video's, or one of the Source
 * played from a Retimed copy (`segmentCopy`, ADR 0009): in Reverse, or at a Speed a browser won't play.
 */
export const onOwnVideos = (segment: PlayedRange & { media?: string | null }) => !!segment.media || segmentCopy(segment) !== null;

// Whether the time runs on a clock through `segment`: one on its own videos, which follow it, or a
// Freeze frame, whose frame waits paused for its hold.
const clocked = (segment: PlayedSegment) => onOwnVideos(segment) || segment.hold != null;

/** The rates the preview plays at: a viewing aid, not a Clip's speed. */
export const RATES = [0.5, 1, 1.5, 2] as const;

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
  // The Segment it plays or waits for, whose Speed it plays at (null: the time's).
  shows: PlayedSegment | null;
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
 * the live deck seeks instead. Through a Segment of a Media Library video, or one of the Source played
 * from a Retimed copy (`onOwnVideos`, ADR 0009: on a master and follower of its own, so that every
 * panel of its Scenes draws from the copy), the decks wait at the next Segment they play and the time runs on a
 * clock of its own, which those videos follow. Through a Freeze frame
 * (ADR 0009) the time runs on the clock too, for its hold, while its frame waits paused: a deck
 * parked at it for the Source's, its video for a video's. The preview, its other
 * media and the timeline all read and set the time through it. Playing stops at the Clip's end,
 * checked every frame; started outside the Clip (before its start), it plays freely. With a Loop
 * Region set (`setLoop`), it plays from In when started outside the Region, and at Out goes back to
 * In without stopping, on the parked deck waiting there. Everything plays at its `rate`: both decks,
 * the clock, and (through `follow`) every element that follows it, each keeping its pitch as the
 * browser does. A deck plays the Segment it shows at that Segment's Speed times the rate
 * (`previewSpeed`), its pitch kept unless the Segment's `pitch`, parked at the one it waits for. While paused, a skim borrows the parked deck to show another time, its `shownTime`,
 * which the preview draws and its followers follow, the time staying put; a seek or Play ends it.
 * A live deck the browser refuses to play stops the playback.
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
  // How fast it plays: 1 is the Clip's own speed.
  private pace = 1;
  // The live deck paused here to hand over to a video's Segment: not a pause of the playback.
  private handing = false;
  // While skimming: the time shown, and its Segment, on the parked deck.
  private skimmed: { time: number; index: number } | null = null;
  // While a skim's snippet of sound plays: the frame that checks for its end.
  private snippet: { frame: number } | null = null;
  // The Loop Region while Loop is on, in seconds into the Clip.
  private region: LoopRegion | null = null;
  // In seconds into the Clip, as last read: updated every frame while playing.
  time = 0;
  playing = false;

  get rate(): number {
    return this.pace;
  }

  // Plays at `rate` from now on, the time kept where it is.
  setRate(rate: number) {
    if (rate === this.pace) return;
    if (this.clock) this.clock = { at: performance.now(), from: this.read() };
    this.pace = rate;
    for (const deck of this.decks) if (deck) this.paced(deck);
    this.emit();
  }

  get duration() {
    return this.segments[this.segments.length - 1].end;
  }

  // The Loop Region while Loop is on, else null.
  get loop(): LoopRegion | null {
    return this.region;
  }

  // Loop on, repeating `region`, or off with null; the parked deck waits again where it will be needed.
  setLoop(region: LoopRegion | null) {
    const old = this.region;
    if (old === region || (old && region && old.in === region.in && old.out === region.out)) return;
    this.region = region;
    this.park();
  }

  // The Loop Region, when Loop is on, the time is before Out, and Out is in the time's Segment (before
  // the next join, or at it): playing goes back to In there.
  private wrapping(): LoopRegion | null {
    const region = this.region;
    const segment = this.segment;
    return region && this.time < region.out && region.out > segment.start && region.out <= segment.end ? region : null;
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

  // The deck whose videos the panels show: the parked one while a skim borrows it.
  get shownDeck(): DeckSlot {
    return this.skimmed && this.decks[this.parkedSlot] ? this.parkedSlot : this.live;
  }

  private get parkedSlot(): DeckSlot {
    return this.live === 0 ? 1 : 0;
  }

  // The time the preview shows: the skimmed time while skimming, otherwise the time.
  get shownTime(): number {
    return this.skimmed?.time ?? this.time;
  }

  // The Segment the shown time is in, and which of them it is.
  get shownSegmentIndex(): number {
    return this.skimmed?.index ?? this.index;
  }

  // The skimmed time, or null when not skimming.
  get skimTime(): number | null {
    return this.skimmed?.time ?? null;
  }

  // The Clip as one range of the Source.
  setRange(start: number, end: number) {
    this.setSegments([{ start: 0, end: segmentLength({ start, end }), source_start: start, source_end: end }]);
  }

  setSegments(segments: PlayedSegment[]) {
    if (!segments.length || JSON.stringify(segments) === JSON.stringify(this.segments)) return;
    const moved = segments[0].source_start !== this.segments[0].source_start;
    this.segments = segments;
    // The time's Segment may be gone (one deleted): kept inside the new Segments before anything reads it.
    this.index = Math.min(this.index, segments.length - 1);
    // A moved start waits at the new start; otherwise the time is kept, inside the Clip.
    if (!this.playing) this.moveTo(moved ? 0 : Math.min(this.time, this.duration));
    else this.park();
    // A skim shows its time as the Segments now play it.
    if (this.skimmed) this.show(this.skimmed.time);
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
    const deck: Deck = { master, follower, parked: null, shows: null, landing: new Set(), detach: () => {} };
    const live = () => this.decks[this.live] === deck;
    const onPlay = () => {
      if (!live()) return;
      this.armed = this.read() >= -0.05 && this.read() < this.duration;
      this.start();
    };
    const onPause = () => {
      // Played again since (an unlock's pause heard after a swap): not a pause of the playback.
      if (!live() || !master.paused) return;
      if (this.handing) {
        this.handing = false;
        return;
      }
      if (this.clock) return;
      this.stop();
    };
    const onSeeked = (event: Event) => {
      deck.landing.delete(event.target as HTMLVideoElement);
      if (!live() || event.target !== master || clocked(this.segment)) return;
      this.time = this.read();
      this.emit();
    };
    const onLoaded = () => {
      // A load sets the rate back to the default.
      this.paced(deck);
      if (live()) return this.moveTo(this.time);
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
    this.paced(deck);
    master.muted = !live();
    if (follower) follower.muted = true;
    if (!live()) this.park();
  }

  private start() {
    this.unskim();
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
    if (clocked(segment)) return this.clock ? this.clock.from + ((performance.now() - this.clock.at) / 1000) * this.pace : this.time;
    const deck = this.decks[this.live];
    return deck ? playedTimeAt(segment, deck.master.currentTime) : this.time;
  }

  // A deck's videos sent to `source` seconds into the Source, to show `segment` at its Speed.
  private cue(deck: Deck, source: number, segment: PlayedSegment) {
    deck.shows = segment;
    this.paced(deck);
    for (const video of deck.follower ? [deck.master, deck.follower] : [deck.master]) {
      video.currentTime = source;
      deck.landing.add(video);
    }
  }

  // A deck's videos set to play its Segment at its Speed times the rate, its pitch kept unless changed.
  private paced(deck: Deck) {
    const segment = deck.shows ?? this.segment;
    const rate = this.pace * previewSpeed(segment.speed);
    for (const video of deck.follower ? [deck.master, deck.follower] : [deck.master]) {
      if (video.playbackRate !== rate) video.playbackRate = rate;
      if (video.preservesPitch === !!segment.pitch) video.preservesPitch = !segment.pitch;
    }
  }

  private run(deck: Deck) {
    this.paced(deck);
    // A browser may refuse to play (iOS, a deck swapped in): the live deck refused while playing
    // stops the playback where it is, so that Play plays again.
    void deck.master.play().catch(() => {
      if (this.playing && !this.clock && this.decks[this.live] === deck && deck.master.paused) this.stop();
    });
    if (deck.follower) void deck.follower.play().catch(() => {});
  }

  // The parked deck's videos played and paused at once, muted, inside the owner's own Play: iOS
  // refuses to play a video that no press of the owner's has played, as at the swap it would be.
  private unlock() {
    const deck = this.decks[this.parkedSlot];
    if (!deck) return;
    for (const video of deck.follower ? [deck.master, deck.follower] : [deck.master]) {
      if (!video.paused || !video.muted) continue;
      void video.play().catch(() => {});
      video.pause();
    }
  }

  private halt(deck: Deck) {
    deck.master.pause();
    deck.follower?.pause();
  }

  // Where the parked deck waits, in the Source, and for which Segment: In when the Loop Region wraps
  // before the next join (nowhere when In is in a Segment on its own videos, which wait by
  // themselves); otherwise the start of the next Segment after the time's that plays on the decks,
  // or nowhere when none is left.
  private parkTarget(): { source: number; segment: PlayedSegment } | null {
    const region = this.wrapping();
    if (region) {
      const { index, source } = wrapTarget(region, this.segments);
      return source === null ? null : { source, segment: this.segments[index] };
    }
    const next = this.segments.slice(this.index + 1).find((segment) => !onOwnVideos(segment));
    return next ? { source: playedSourceAt(next, next.start), segment: next } : null;
  }

  // The parked deck, paused and muted, to where the playback will need it next, unless it is there
  // (or a skim has borrowed it).
  private park() {
    if (this.skimmed) return;
    const deck = this.decks[1 - this.live];
    const target = this.parkTarget();
    if (!deck || target === null) return;
    if (deck.parked === target.source) {
      // There already, perhaps for another Segment (the Segments replanned): at its rate.
      deck.shows = target.segment;
      this.paced(deck);
      return;
    }
    this.halt(deck);
    deck.master.muted = true;
    deck.parked = target.source;
    this.cue(deck, target.source, target.segment);
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

  // Into the Segment at `index`, at `time` (its start unless said), still playing.
  private enter(index: number, time = this.segments[index].start) {
    const from = this.segment;
    this.index = index;
    const next = this.segment;
    this.time = time;
    const deck = this.decks[this.live];
    const parked = this.decks[1 - this.live];
    if (clocked(next)) {
      this.clock = { at: performance.now(), from: time };
      // A Freeze frame of the Source shows its frame on a deck, paused: the parked one when it waits there.
      const frame = onOwnVideos(next) ? null : next.source_start;
      if (frame !== null && parked && this.ready(parked, frame)) this.swap(false);
      else {
        if (!clocked(from) && deck && !deck.master.paused) {
          this.handing = true;
          this.halt(deck);
        }
        if (frame !== null && deck) this.cue(deck, frame, next);
      }
    } else {
      this.clock = null;
      const source = playedSourceAt(next, time);
      if (parked && this.ready(parked, source)) this.swap();
      else if (deck) {
        this.cue(deck, source, next);
        if (clocked(from)) this.run(deck);
      }
    }
    this.park();
  }

  // Whether a deck waits at `source`, its frame there ready.
  private ready(deck: Deck, source: number) {
    return deck.parked === source && deck.landing.size === 0;
  }

  // The parked deck goes live for the time's Segment, playing from where it waits and heard (or, not
  // `playing`, paused there: a Freeze frame); the old live deck is paused, muted, and parked again by
  // the caller.
  private swap(playing = true) {
    const old = this.decks[this.live];
    this.live = this.live === 0 ? 1 : 0;
    const deck = this.decks[this.live]!;
    deck.parked = null;
    deck.shows = this.segment;
    this.paced(deck);
    deck.master.muted = false;
    if (playing) this.run(deck);
    if (old) {
      this.halt(old);
      old.master.muted = true;
    }
  }

  private tick = () => {
    // Out still ahead before this frame: at Out (or the handover, when Out is at the Segment's end)
    // the wrap to In.
    const region = this.wrapping();
    this.time = this.read();
    const last = this.index === this.segments.length - 1;
    if (this.armed && region && this.time >= Math.min(region.out, this.segment.end - HANDOVER_SECS)) {
      const { index, time } = wrapTarget(region, this.segments);
      this.enter(index, time);
    } else if (this.armed && !last && this.time >= this.segment.end - HANDOVER_SECS) {
      this.enter(this.index + 1);
    } else if (this.armed && last && this.time >= this.duration) {
      this.pause();
      this.seek(this.duration);
      return;
    }
    this.emit();
    this.schedule();
  };

  // The Segment `time` is in, the last one past the end.
  private indexAt(time: number) {
    const index = this.segments.findIndex((segment) => time < segment.end);
    return index === -1 ? this.segments.length - 1 : index;
  }

  // To `time` seconds into the Clip, ending a skim: the preview shows the time it went to.
  seek(time: number) {
    this.unskim();
    this.moveTo(time);
  }

  // To `time` seconds into the Clip, a skim kept showing its own time.
  private moveTo(time: number) {
    const wasClocked = clocked(this.segment);
    this.index = this.indexAt(time);
    this.time = time;
    const segment = this.segment;
    const deck = this.decks[this.live];
    if (clocked(segment)) {
      if (this.playing) {
        this.clock = { at: performance.now(), from: time };
        if (!wasClocked && deck && !deck.master.paused) {
          this.handing = true;
          this.halt(deck);
        }
      }
      // A Freeze frame of the Source shows its frame on the live deck, paused.
      if (!onOwnVideos(segment) && deck) this.cue(deck, segment.source_start, segment);
    } else {
      const resume = this.playing && !!this.clock;
      this.clock = null;
      if (deck) {
        this.cue(deck, playedSourceAt(segment, time), segment);
        if (resume) this.run(deck);
      }
    }
    this.park();
    this.emit();
  }

  // From `from`, else from the time; with Loop on, from In when the time is outside the Region.
  play(from?: number) {
    this.unskim();
    this.unlock();
    if (from !== undefined) this.seek(from);
    else if (this.region && loopStart(this.time, this.region) !== this.time) this.seek(this.region.in);
    const deck = this.decks[this.live];
    if (clocked(this.segment)) {
      this.armed = this.time >= -0.05 && this.time < this.duration;
      this.clock = { at: performance.now(), from: this.time };
      this.start();
    } else if (deck) this.run(deck);
  }

  pause() {
    const deck = this.decks[this.live];
    if (this.clock) this.stop();
    else if (deck) {
      // A live deck paused already (refused its play) fires no `pause`: the playback stops here.
      const still = deck.master.paused;
      this.halt(deck);
      if (still && this.playing) this.stop();
    }
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play(!this.region && this.time >= this.duration - 0.05 ? 0 : undefined);
  }

  /**
   * While paused, shows `time` seconds into the Clip on the parked deck, the time and the live deck
   * staying put; with `sound`, each new position is heard for a moment, one snippet at a time. With
   * null, shows the live deck again and parks the other. Ignored while playing, which ends a skim.
   */
  skim(time: number | null, sound = false) {
    if (this.playing || time === this.skimTime) return;
    if (time === null) {
      this.unskim();
      this.emit();
      return;
    }
    this.show(time, sound);
  }

  // The parked deck borrowed to show `time`.
  private show(time: number, sound = false) {
    this.skimmed = { time, index: this.indexAt(time) };
    const deck = this.decks[this.parkedSlot];
    const skimmed = this.skimSource();
    if (deck && skimmed) {
      deck.parked = null;
      this.cue(deck, skimmed.source, skimmed.segment);
      if (sound && !this.snippet) this.snip(deck);
    }
    this.emit();
  }

  // Where in the Source the skimmed time is, and its Segment, or null when it is in a Segment on its own videos.
  private skimSource(): { source: number; segment: PlayedSegment } | null {
    if (!this.skimmed) return null;
    const segment = this.segments[this.skimmed.index];
    return onOwnVideos(segment) ? null : { source: playedSourceAt(segment, this.skimmed.time), segment };
  }

  // The skim's end: the parked deck silenced and parked again.
  private unskim() {
    if (!this.skimmed) return;
    this.skimmed = null;
    this.hush();
    const deck = this.decks[this.parkedSlot];
    if (deck) deck.parked = null;
    this.park();
  }

  // A snippet of the borrowed deck's sound where it is, for SNIPPET_SECS.
  private snip(deck: Deck) {
    const until = performance.now() + SNIPPET_SECS * 1000;
    const check = () => {
      if (performance.now() < until) this.snippet = { frame: requestAnimationFrame(check) };
      else this.hush();
    };
    deck.master.muted = false;
    this.run(deck);
    this.snippet = { frame: requestAnimationFrame(check) };
  }

  // The snippet stopped: the borrowed deck paused and muted, and back on the skimmed frame.
  private hush() {
    if (!this.snippet) return;
    cancelAnimationFrame(this.snippet.frame);
    this.snippet = null;
    const deck = this.decks[this.parkedSlot];
    if (!deck) return;
    this.halt(deck);
    deck.master.muted = true;
    const skimmed = this.skimSource();
    if (skimmed) this.cue(deck, skimmed.source, skimmed.segment);
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
 * What `select` makes of the playback's time (the playhead's, where edits go) and state, re-rendering
 * only when that changes: select a primitive (an index, a key, a rounded time), not a new object.
 */
export function usePlayback<T extends string | number | boolean | null>(
  playback: Playback,
  select: (time: number, playback: Playback) => T,
): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.time, playback));
}

/** As `usePlayback`, of the time shown (the skimmed time while skimming): for what the preview draws. */
export function useShown<T extends string | number | boolean | null>(
  playback: Playback,
  select: (time: number, playback: Playback) => T,
): T {
  return useSyncExternalStore(playback.subscribe, () => select(playback.shownTime, playback));
}
