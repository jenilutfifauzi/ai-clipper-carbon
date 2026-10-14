import { useSyncExternalStore } from "react";

type Listener = () => void;

/** A piece of the Clip: the Source from `source_start` to `source_end`, from `start` to `end` seconds into the Clip. */
export interface Piece {
  start: number;
  end: number;
  source_start: number;
  source_end: number;
}

/** The pieces of a Clip of these Segments of the Source, back to back from 0 s. */
export function piecesFrom(segments: { start: number; end: number }[]): Piece[] {
  let at = 0;
  return segments.map((segment) => {
    const piece = { start: at, end: at + segment.end - segment.start, source_start: segment.start, source_end: segment.end };
    at = piece.end;
    return piece;
  });
}

// A piece that isn't the last hands over this long before its end, so that no frame past it shows.
const HANDOVER_SECS = 0.03;

/**
 * The clip editor's playback of a Candidate: the master <video> playing the Source, and its time in
 * seconds into the Clip. The Clip is one range of the Source or several pieces of it, back to back
 * (docs/adr/0002-segments-and-timeline-time.md): at the end of each piece the video jumps to the
 * next one's start. The preview, its follower videos and the timeline all read and set the time
 * through it. Playing stops at the Clip's end, checked every frame; started outside the Clip
 * (before its start), it plays freely.
 */
export class Playback {
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<Listener>();
  private frame = 0;
  private armed = false;
  private detach: (() => void) | null = null;
  pieces: Piece[] = [{ start: 0, end: 0, source_start: 0, source_end: 0 }];
  // The piece the video is in.
  private index = 0;
  // In seconds into the Clip, as last read: updated every frame while playing.
  time = 0;
  playing = false;

  get duration() {
    return this.pieces[this.pieces.length - 1].end;
  }

  // The Clip as one range of the Source.
  setRange(start: number, end: number) {
    this.setPieces([{ start: 0, end: end - start, source_start: start, source_end: end }]);
  }

  setPieces(pieces: Piece[]) {
    if (!pieces.length || JSON.stringify(pieces) === JSON.stringify(this.pieces)) return;
    const moved = pieces[0].source_start !== this.pieces[0].source_start;
    this.pieces = pieces;
    if (this.video && this.video.paused) {
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
      this.playing = true;
      cancelAnimationFrame(this.frame);
      this.frame = requestAnimationFrame(this.tick);
      this.emit();
    };
    const onPause = () => {
      this.playing = false;
      cancelAnimationFrame(this.frame);
      this.time = this.read();
      this.emit();
    };
    const onSeeked = () => {
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

  private read() {
    const piece = this.pieces[this.index];
    return this.video ? piece.start + (this.video.currentTime - piece.source_start) : this.time;
  }

  private tick = () => {
    this.time = this.read();
    const last = this.index === this.pieces.length - 1;
    if (this.armed && !last && this.time >= this.pieces[this.index].end - HANDOVER_SECS) {
      // On to the next piece, still playing.
      this.index += 1;
      if (this.video) this.video.currentTime = this.pieces[this.index].source_start;
      this.time = this.pieces[this.index].start;
    } else if (this.armed && last && this.time >= this.duration) {
      this.video?.pause();
      this.seek(this.duration);
      return;
    }
    this.emit();
    this.frame = requestAnimationFrame(this.tick);
  };

  // To `time` seconds into the Clip.
  seek(time: number) {
    this.time = time;
    const index = this.pieces.findIndex((piece) => time < piece.end);
    this.index = index === -1 ? this.pieces.length - 1 : index;
    const piece = this.pieces[this.index];
    if (this.video) this.video.currentTime = piece.source_start + (time - piece.start);
    this.emit();
  }

  play(from?: number) {
    if (from !== undefined) this.seek(from);
    void this.video?.play();
  }

  pause() {
    this.video?.pause();
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
