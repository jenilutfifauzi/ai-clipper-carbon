import { useSyncExternalStore } from "react";

type Listener = () => void;

/**
 * The clip editor's playback of a Candidate: the master <video> playing the Source, and its time in
 * seconds into the Clip (the Source's time less the Clip's start). The preview, its follower videos
 * and the timeline all read and set the time through it. Playing stops at the Clip's end, checked
 * every frame; started outside the Clip (before its start), it plays freely.
 */
export class Playback {
  private video: HTMLVideoElement | null = null;
  private listeners = new Set<Listener>();
  private frame = 0;
  private armed = false;
  private detach: (() => void) | null = null;
  start = 0;
  end = 0;
  // In seconds into the Clip, as last read: updated every frame while playing.
  time = 0;
  playing = false;

  get duration() {
    return this.end - this.start;
  }

  setRange(start: number, end: number) {
    const moved = start !== this.start;
    this.start = start;
    this.end = end;
    if (this.video && this.video.paused) {
      // A moved start waits at the new start; otherwise the time is kept, inside the Clip.
      this.seek(moved ? 0 : Math.min(this.time, this.duration));
    }
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
    return this.video ? this.video.currentTime - this.start : this.time;
  }

  private tick = () => {
    this.time = this.read();
    if (this.armed && this.time >= this.duration) {
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
    if (this.video) this.video.currentTime = this.start + time;
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
