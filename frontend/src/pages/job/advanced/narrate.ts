import { narrationEventsUrl, type MediaItem, type NarrationRequest, type VoiceEngine } from "../../../api";
import type { LandedTake } from "./takeFlow";

/**
 * The Narrate tab's flow (.scratch/text-to-speech/spec.md, ADR 0019): from Generate to a Music Clip
 * marked Speech on the Timeline. The backend reads the script (app/narration.py); `NarrateFlow` starts
 * it, follows its events and lands the item through the same action that lands a Take, at the start
 * fixed when Generate was pressed. No React.
 *
 *   idle → making → idle (landed, or kept in the Media tab when the landing is refused)
 *             ↘ failed (its message; the script stays in the tab) → making (Generate again)
 */
export type NarrateState =
  | { phase: "idle" }
  // The backend reading the script; it lands at `start`.
  | { phase: "making"; start: number }
  | { phase: "failed"; message: string };

// The longest script the backend reads (app/narration.py's MAX_CHARS).
export const MAX_SCRIPT_CHARS = 5000;

// The pause slider's stops: the silence between two sentences, in seconds (0–1.5).
export const PAUSE_STOPS = [
  { label: "None", secs: 0 },
  { label: "Natural", secs: 0.3 },
  { label: "Long", secs: 0.8 },
  { label: "Longer", secs: 1.5 },
] as const;
export const DEFAULT_PAUSE = 1;

// Told when the Narration is made but can't land (a locked Music Track): it waits in the Media tab.
export const NARRATION_IN_LIBRARY = "The Narration is in the Media tab: the Music Track is locked";

/** How an engine is labelled in the tab: where its words go. */
export const engineLabel = (engine: VoiceEngine) => (engine.local ? "On this Mac" : `${engine.service ?? engine.label} · cloud`);

/** What the flow runs on: the backend, the edit that lands the item, and the Media Library's list. */
export interface NarrateDeps {
  // Starts a Narration: its id, or rejects (busy, a script that can't be narrated) with the reason.
  start: (body: NarrationRequest) => Promise<string>;
  // Follows Narration `id` until its outcome; returns what stops following it.
  listen: (id: string, on: { done: (item: MediaItem) => void; failed: (message: string) => void }) => () => void;
  // Lands the item as a Music Clip marked Speech (actions.ts' `landTake`); null when refused.
  land: (landed: LandedTake) => number | null;
  // The new item, listed in the Media Library's tabs.
  added: (item: MediaItem) => void;
  tell: (text: string) => void;
}

/** The Narrate tab's Generate: `subscribe` and `state` are for the tab (useSyncExternalStore). */
export class NarrateFlow {
  state: NarrateState = { phase: "idle" };
  private listeners = new Set<() => void>();
  private stop: (() => void) | null = null;

  constructor(private deps: NarrateDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** Reads `body` aloud, to land at `start` (the playhead when Generate was pressed). */
  async generate(body: NarrationRequest, start: number): Promise<void> {
    if (this.state.phase === "making") return;
    this.set({ phase: "making", start });
    let id: string;
    try {
      id = await this.deps.start(body);
    } catch (reason) {
      this.set({ phase: "failed", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }
    this.stop = this.deps.listen(id, {
      done: (item) => {
        this.finish();
        this.deps.added(item);
        if (this.deps.land({ media: item.id, start, secs: item.duration ?? 0 }) === null) this.deps.tell(NARRATION_IN_LIBRARY);
        this.set({ phase: "idle" });
      },
      failed: (message) => {
        this.finish();
        this.set({ phase: "failed", message });
      },
    });
  }

  /** The editor lets go of the flow: a Narration being made is still added, unlaid. */
  dispose() {
    this.finish();
  }

  private finish() {
    this.stop?.();
    this.stop = null;
  }

  private set(state: NarrateState) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

/** Follows a Narration's events from the backend; EventSource reconnects by itself, and is told again. */
export function listenNarration(id: string, on: { done: (item: MediaItem) => void; failed: (message: string) => void }): () => void {
  const source = new EventSource(narrationEventsUrl(id));
  source.addEventListener("done", (event) => {
    source.close();
    on.done(JSON.parse((event as MessageEvent).data));
  });
  source.addEventListener("failed", (event) => {
    source.close();
    on.failed(JSON.parse((event as MessageEvent).data).message);
  });
  return () => source.close();
}
