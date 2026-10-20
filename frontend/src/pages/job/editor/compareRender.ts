import type { KeyboardEvent, PointerEvent } from "react";

/**
 * Compare render (GLOSSARY): the server's render of one frame at the playhead, shown under a split
 * line over the paused preview. Idle until asked for; then on its way, shown, or failed, each at the
 * time it was asked at.
 */
export type CompareState =
  { kind: "idle" } | { kind: "loading"; at: number } | { kind: "shown"; at: number; url: string } | { kind: "failed"; at: number; message: string };

const IDLE: CompareState = { kind: "idle" };

/** What a Compare render follows of the playback (`Playback` is one). */
export interface Playhead {
  readonly time: number;
  readonly playing: boolean;
  readonly skimTime: number | null;
  subscribe(listener: () => void): () => void;
}

/** Fetches the PNG of the frame at `at` of the draft (`api.compareFrame`, its draft bound). */
export type FetchFrame = (at: number, signal: AbortSignal) => Promise<Blob>;

/**
 * A Compare render's state, as an external store (`subscribe`, `state`): asked for while paused, at
 * the playhead; while it `watch`es the playback, cleared (its request aborted, its picture let go) on any playhead move, a skim or a
 * play, and on any edit (`edited`, with the draft's key), so that it never shows a stale frame.
 */
export class CompareRender {
  state: CompareState = IDLE;
  private listeners = new Set<() => void>();
  private controller: AbortController | null = null;
  private key: string;

  constructor(
    private playback: Playhead,
    key: string,
    private pictures: { make: (blob: Blob) => string; drop: (url: string) => void } = {
      make: (blob) => URL.createObjectURL(blob),
      drop: (url) => URL.revokeObjectURL(url),
    },
  ) {
    this.key = key;
  }

  /** Follows the playback, clearing the frame when it moves; until the returned function, which clears it too. */
  watch(): () => void {
    const { playback } = this;
    const unwatch = playback.subscribe(() => {
      const { state } = this;
      if (state.kind === "idle") return;
      if (playback.playing || playback.skimTime !== null || Math.abs(playback.time - state.at) > 1e-6) this.clear();
    });
    return () => {
      unwatch();
      this.clear();
    };
  }

  /** Asks for the frame at the playhead with `fetch`; refused while playing. */
  request(fetch: FetchFrame) {
    if (this.playback.playing) return;
    this.clear();
    const at = this.playback.time;
    const controller = new AbortController();
    this.controller = controller;
    this.set({ kind: "loading", at });
    fetch(at, controller.signal).then(
      (blob) => {
        if (controller.signal.aborted) return;
        this.controller = null;
        this.set({ kind: "shown", at, url: this.pictures.make(blob) });
      },
      (reason: Error) => {
        if (controller.signal.aborted) return;
        this.controller = null;
        this.set({ kind: "failed", at, message: reason.message || "The frame couldn't be drawn" });
      },
    );
  }

  /** The draft is now `key`: a change clears the frame, an edit making it stale. */
  edited(key: string) {
    if (key === this.key) return;
    this.key = key;
    this.clear();
  }

  /** Back to idle: a request on its way aborted, a picture shown let go. */
  clear() {
    this.controller?.abort();
    this.controller = null;
    if (this.state.kind === "shown") this.pictures.drop(this.state.url);
    if (this.state.kind !== "idle") this.set(IDLE);
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(state: CompareState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The handlers of a hold button (the before view's): held while a pointer is down on it, or while
 * Space or Enter is down with it focused, and let go on release, the pointer leaving or cancelled, or
 * the focus going. Its keys go no further (Space would play), and a key's repeats are ignored.
 */
export function holdHandlers(hold: (held: boolean) => void) {
  const press = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    hold(true);
  };
  const release = () => hold(false);
  const holdsWith = (key: string) => key === " " || key === "Enter";
  return {
    onPointerDown: press,
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onBlur: release,
    onContextMenu: (event: { preventDefault: () => void }) => event.preventDefault(),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!holdsWith(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) hold(true);
    },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (!holdsWith(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      hold(false);
    },
  };
}
