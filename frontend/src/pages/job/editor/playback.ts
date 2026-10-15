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

/**
 * The clip editor's playback of a Candidate: the master <video> playing the Source, and its time in
 * seconds into the Clip. The Clip is one range of the Source or several Segments, back to back
 * (docs/adr/0002-segments-and-timeline-time.md): at the end of each Segment the video jumps to the
 * next one's start. Through a Segment of a Media Library video, the Source video waits and the time
 * runs on a clock of its own, which that video's player follows. The preview, its follower videos
 * and the timeline all read and set the time through it. Playing stops at the Clip's end, checked
 * every frame; started outside the Clip (before its start), it plays freely.
 */
export class Playback {
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<Listener>();
  private frame = 0;
  private armed = false;
  private detach: (() => void) | null = null;
  segments: PlayedSegment[] = [{ start: 0, end: 0, source_start: 0, source_end: 0 }];
  // The Segment the time is in.
  private index = 0;
  // While playing a video's Segment: when the clock read `from` seconds into the Clip.
  private clock: { at: number; from: number } | null = null;
  // The Source video paused here to hand over to a video's Segment: not a pause of the playback.
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
  }

  attach(video: HTMLVideoElement | null) {
    this.detach?.();
    this.detach = null;
    this.video = video;
    if (!video) return;
    const onPlay = () => {
      this.armed = this.read() >= -0.05 && this.read() < this.duration;
      this.start();
    };
    const onPause = () => {
      if (this.handing) {
        this.handing = false;
        return;
      }
      if (this.clock) return;
      this.stop();
    };
    const onSeeked = () => {
      if (this.segment.media) return;
      this.time = this.read();
      this.emit();
    };
    const onLoaded = () => this.seek(this.time);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("loadedmetadata", onLoaded);
    this.detach = () => {
      cancelAnimationFrame(this.frame);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("loadedmetadata", onLoaded);
    };
  }

  private start() {
    this.playing = true;
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
    this.emit();
  }

  private stop() {
    this.time = this.read();
    this.clock = null;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    this.emit();
  }

  private read() {
    const segment = this.segment;
    if (segment.media) return this.clock ? this.clock.from + (performance.now() - this.clock.at) / 1000 : this.time;
    return this.video ? segment.start + (this.video.currentTime - segment.source_start) : this.time;
  }

  // Into the Segment at `index`, from its start, still playing.
  private enter(index: number) {
    const from = this.segment;
    this.index = index;
    const next = this.segment;
    this.time = next.start;
    if (next.media) {
      this.clock = { at: performance.now(), from: next.start };
      if (!from.media && this.video && !this.video.paused) {
        this.handing = true;
        this.video.pause();
      }
    } else {
      this.clock = null;
      if (this.video) {
        this.video.currentTime = next.source_start;
        if (from.media) void this.video.play().catch(() => {});
      }
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
    this.frame = requestAnimationFrame(this.tick);
  };

  // To `time` seconds into the Clip.
  seek(time: number) {
    const index = this.segments.findIndex((segment) => time < segment.end);
    const wasMedia = !!this.segment.media;
    this.index = index === -1 ? this.segments.length - 1 : index;
    this.time = time;
    const segment = this.segment;
    if (segment.media) {
      if (this.playing) {
        this.clock = { at: performance.now(), from: time };
        if (!wasMedia && this.video && !this.video.paused) {
          this.handing = true;
          this.video.pause();
        }
      }
    } else {
      const resume = this.playing && !!this.clock;
      this.clock = null;
      if (this.video) {
        this.video.currentTime = segment.source_start + (time - segment.start);
        if (resume) void this.video.play().catch(() => {});
      }
    }
    this.emit();
  }

  play(from?: number) {
    if (from !== undefined) this.seek(from);
    if (this.segment.media) {
      this.armed = this.time >= -0.05 && this.time < this.duration;
      this.clock = { at: performance.now(), from: this.time };
      this.start();
    } else void this.video?.play();
  }

  pause() {
    if (this.clock) this.stop();
    else this.video?.pause();
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
