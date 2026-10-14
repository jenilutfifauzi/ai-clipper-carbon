import { useSyncExternalStore } from "react";

type Listener = () => void;

/**
 * A piece of the Clip: the Source from `source_start` to `source_end`, from `start` to `end` seconds
 * into the Clip; or, with `media`, a Media Library video from `source_start` to `source_end` seconds
 * into it, which the preview plays itself while the Source waits.
 */
export interface Piece {
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  media?: string | null;
}

/** The pieces of a Clip of these Segments, back to back from 0 s. */
export function piecesFrom(segments: { start: number; end: number; media?: string | null }[]): Piece[] {
  let at = 0;
  return segments.map((segment) => {
    const piece = { start: at, end: at + segment.end - segment.start, source_start: segment.start, source_end: segment.end, media: segment.media ?? null };
    at = piece.end;
    return piece;
  });
}

/**
 * The pieces as played from a plan's Segments: where a Transition overlaps two, the first gives way
 * to the next where the Transition starts (the preview draws the Transition over it).
 */
export function playable(segments: Piece[]): Piece[] {
  return segments.map((segment, i) => {
    const next = segments[i + 1];
    if (!next || next.start >= segment.end) return segment;
    return { ...segment, end: next.start, source_end: segment.source_start + (next.start - segment.start) };
  });
}

// A piece that isn't the last hands over this long before its end, so that no frame past it shows.
const HANDOVER_SECS = 0.03;

/**
 * The clip editor's playback of a Candidate: the master <video> playing the Source, and its time in
 * seconds into the Clip. The Clip is one range of the Source or several pieces of it, back to back
 * (docs/adr/0002-segments-and-timeline-time.md): at the end of each piece the video jumps to the
 * next one's start. Through a piece of a Media Library video, the Source video waits and the time
 * runs on a clock of its own, which that video's player follows. The preview, its follower videos
 * and the timeline all read and set the time through it. Playing stops at the Clip's end, checked
 * every frame; started outside the Clip (before its start), it plays freely.
 */
export class Playback {
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<Listener>();
  private handovers = new Set<(from: Piece, to: Piece) => void>();
  private frame = 0;
  private armed = false;
  private detach: (() => void) | null = null;
  pieces: Piece[] = [{ start: 0, end: 0, source_start: 0, source_end: 0 }];
  // The piece the time is in.
  private index = 0;
  // While playing a video's piece: when the clock read `from` seconds into the Clip.
  private clock: { at: number; from: number } | null = null;
  // The Source video paused here to hand over to a video's piece: not a pause of the playback.
  private handing = false;
  // In seconds into the Clip, as last read: updated every frame while playing.
  time = 0;
  playing = false;

  get duration() {
    return this.pieces[this.pieces.length - 1].end;
  }

  private get piece() {
    return this.pieces[this.index];
  }

  // The Clip as one range of the Source.
  setRange(start: number, end: number) {
    this.setPieces([{ start: 0, end: end - start, source_start: start, source_end: end }]);
  }

  setPieces(pieces: Piece[]) {
    if (!pieces.length || JSON.stringify(pieces) === JSON.stringify(this.pieces)) return;
    const moved = pieces[0].source_start !== this.pieces[0].source_start;
    this.pieces = pieces;
    if (!this.playing) {
      // A moved start waits at the new start; otherwise the time is kept, inside the Clip.
      this.seek(moved ? 0 : Math.min(this.time, this.duration));
    } else this.index = Math.min(this.index, pieces.length - 1);
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
      if (this.piece.media) return;
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
    const piece = this.piece;
    if (piece.media) return this.clock ? this.clock.from + (performance.now() - this.clock.at) / 1000 : this.time;
    return this.video ? piece.start + (this.video.currentTime - piece.source_start) : this.time;
  }

  // Into the piece at `index`, from its start, still playing.
  private enter(index: number) {
    const from = this.piece;
    // Before the picture changes: the preview copies the last one for a Transition.
    for (const handover of this.handovers) handover(from, this.pieces[index]);
    this.index = index;
    const next = this.piece;
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
    const last = this.index === this.pieces.length - 1;
    if (this.armed && !last && this.time >= this.piece.end - HANDOVER_SECS) {
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
    const index = this.pieces.findIndex((piece) => time < piece.end);
    const wasMedia = !!this.piece.media;
    this.index = index === -1 ? this.pieces.length - 1 : index;
    this.time = time;
    const piece = this.piece;
    if (piece.media) {
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
        this.video.currentTime = piece.source_start + (time - piece.start);
        if (resume) void this.video.play().catch(() => {});
      }
    }
    this.emit();
  }

  play(from?: number) {
    if (from !== undefined) this.seek(from);
    if (this.piece.media) {
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

  /** Calls `listener` as playing goes on from one piece to the next, before the picture changes. */
  onHandover(listener: (from: Piece, to: Piece) => void) {
    this.handovers.add(listener);
    return () => {
      this.handovers.delete(listener);
    };
  }

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
