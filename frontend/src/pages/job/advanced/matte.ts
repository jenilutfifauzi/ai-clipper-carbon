import type { CandidateMatte, MattePart } from "../../../api";

export interface MatteState {
  // Null until it is first read (or with nothing cut out to read it for).
  matte: CandidateMatte | null;
  // Why it couldn't be read.
  message: string | null;
}

export interface MatteDeps {
  // The saved Candidate's Matte, its missing pieces asked for; with `retry`, its failed ones made again.
  read: (retry: boolean) => Promise<CandidateMatte>;
  // Runs `run` after `ms`; returns what calls it off.
  after: (ms: number, run: () => void) => () => void;
}

export const MATTE_POLL_MS = 1000;
// How long after the cut-out Segments change it is read once more: their save comes a moment later.
export const MATTE_SETTLE_MS = 1500;

/**
 * How the Matte of the cut-out Segments and Overlays `ids` (an Overlay's as `overlay:<id>`) is coming
 * along together ("Finding the subject… N%"): one not in the saved Candidate's yet (its save on its
 * way) is being made; any failed is failed (its error); then any being made, then any waiting for the
 * person model; else ready. Null for none.
 */
export function matteOf(matte: CandidateMatte | null, ids: string[]): MattePart | null {
  if (!ids.length) return null;
  const partOf = (id: string) => (id.startsWith("overlay:") ? matte?.overlays?.[id.slice("overlay:".length)] : matte?.segments[id]);
  const parts = ids.map((id): MattePart => partOf(id) ?? { state: "making", progress: 0, error: null });
  const progress = parts.reduce((sum, part) => sum + part.progress, 0) / parts.length;
  const failed = parts.find((part) => part.state === "failed");
  if (failed) return { state: "failed", progress, error: failed.error };
  for (const state of ["making", "missing", "waiting"] as const) {
    if (parts.some((part) => part.state === state)) return { state: state === "missing" ? "making" : state, progress, error: null };
  }
  return { state: "ready", progress: 1, error: null };
}

/**
 * The Matte of the cut-out Segments the Remove background section shows (.scratch/background-removal/
 * issues/02-cut-out-a-source-segment-in-the-render.md): read when they change (and once more a moment
 * later, after their save), then every MATTE_POLL_MS while one of them is being made, is waiting for
 * the person model, or isn't in the saved Candidate yet. Retry makes the failed pieces again. Reading
 * it asks for what is missing, so a model downloaded meanwhile starts it. `subscribe` and `state` are
 * for the section (useSyncExternalStore).
 */
export class MatteSource {
  state: MatteState = { matte: null, message: null };
  private ids: string[] = [];
  private listeners = new Set<() => void>();
  // The next poll, and the read after a change's save: what calls each off.
  private poll: (() => void) | null = null;
  private settle: (() => void) | null = null;
  // Bumped by every read and by dispose: an answer for an older one is dropped.
  private asked = 0;

  constructor(private deps: MatteDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The cut-out Segments shown are now `ids` (or have changed): read it now, and again after their save. */
  watch = (ids: string[]): void => {
    this.ids = ids;
    this.stop();
    if (!ids.length) return;
    void this.load();
    this.settle = this.deps.after(MATTE_SETTLE_MS, () => void this.load());
  };

  /** Reads it (with `retry`, making the failed pieces again), and again shortly while it isn't settled. */
  load = async (retry = false): Promise<void> => {
    this.poll?.();
    this.poll = null;
    const asked = ++this.asked;
    let matte: CandidateMatte;
    try {
      matte = await this.deps.read(retry);
    } catch (reason) {
      if (asked !== this.asked) return;
      this.set({ message: `Couldn't check the subject's Matte: ${reason instanceof Error ? reason.message : String(reason)}` });
      return;
    }
    if (asked !== this.asked) return;
    this.set({ matte, message: null });
    const part = matteOf(matte, this.ids);
    if (part && (part.state === "making" || part.state === "waiting")) this.poll = this.deps.after(MATTE_POLL_MS, () => void this.load());
  };

  /** Retry: the failed pieces made again. */
  retry = (): Promise<void> => this.load(true);

  /** The section closed: no more reading. */
  dispose = (): void => {
    this.asked++;
    this.stop();
  };

  private stop() {
    this.poll?.();
    this.settle?.();
    this.poll = this.settle = null;
  }

  private set(change: Partial<MatteState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}
