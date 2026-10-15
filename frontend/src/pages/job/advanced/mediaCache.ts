import { peaksPyramid, type Peaks } from "./timelineView";

// How many chunks are fetched at once, and how many decoded Filmstrip chunks are kept.
const MAX_LOADS = 2;
const MAX_BITMAPS = 12;
// A chunk evicted this recently isn't fetched again at once, so that more chunks on screen than the
// cache holds don't fetch one another out in a loop.
const REFETCH_MS = 1000;
// A chunk whose fetch failed (but not with a 404, which is for good) is asked for again after this.
const RETRY_MS = 5000;
// The most askers a queued chunk remembers: those that asked last.
const MAX_WANTED = 8;

/** A Filmstrip chunk, decoded: its frames side by side, how many, and when it arrived (to fade in). */
export interface StripChunk {
  bitmap: ImageBitmap;
  frames: number;
  arrived: number;
}

/** A Peaks chunk, as its pyramid (finest first), and when it arrived (to fade in). */
export interface PeaksChunk {
  levels: Peaks[];
  arrived: number;
}

type Load = { run: (signal: AbortSignal) => Promise<void>; wanted: (() => boolean)[]; controller?: AbortController };

/**
 * The Timeline's derived media for the Advanced Edit's session (.scratch/timeline-visuals/spec.md,
 * "Drawing"): chunks fetched at most MAX_LOADS at a time, in the order asked for, and dropped from the
 * queue when no canvas wants them any more by the time a load is free. A fetch under way that no
 * canvas wants any more (a fling went past it) is cancelled, so that where it stops comes sooner. Filmstrip chunks are decoded
 * at the height they are drawn, and the last MAX_BITMAPS used are kept, released when evicted. Peaks
 * chunks are small: they are kept for the session, with their pyramids built once.
 */
export class MediaCache {
  private strips = new Map<string, StripChunk>();
  private peaksChunks = new Map<string, PeaksChunk>();
  private evicted = new Map<string, number>();
  // Chunks with no answer to show, until when: for good when answered 404 (off the grid, no sound,
  // gone), a while when the fetch failed otherwise.
  private failed = new Map<string, number>();
  private queue = new Map<string, Load>();
  private loading = new Map<string, Load>();
  private pruning = false;
  private listeners = new Set<() => void>();
  // Counts clear()s, so that a load that finishes after one is dropped.
  private generation = 0;

  /**
   * The Filmstrip chunk at `url`, decoded `height` device pixels tall, or null while it isn't here; it
   * is then asked for, and fetched when a load is free if `wanted()` still says so.
   */
  strip(url: string, height: number, wanted: () => boolean): StripChunk | null {
    const key = `${url}@${height}`;
    const chunk = this.strips.get(key);
    if (chunk) {
      // The most recently used, last.
      this.strips.delete(key);
      this.strips.set(key, chunk);
      return chunk;
    }
    if (this.failing(key) || performance.now() - (this.evicted.get(key) ?? -Infinity) < REFETCH_MS) return null;
    this.ask(key, wanted, async (current, signal) => {
      const answer = await fetched(url, signal);
      const frames = Number(answer.headers.get("X-Frames"));
      const bitmap = await createImageBitmap(await answer.blob(), { resizeHeight: height, resizeQuality: "medium" });
      if (current()) this.keep(key, { bitmap, frames, arrived: performance.now() });
      else bitmap.close();
    });
    return null;
  }

  /**
   * The Peaks chunk at `url`, or null while it isn't here; it is then asked for, and fetched when a
   * load is free if `wanted()` still says so.
   */
  peaks(url: string, wanted: () => boolean): PeaksChunk | null {
    const chunk = this.peaksChunks.get(url);
    if (chunk) return chunk;
    if (this.failing(url)) return null;
    this.ask(url, wanted, async (current, signal) => {
      const levels = peaksPyramid(readPeaks(await (await fetched(url, signal)).arrayBuffer()));
      if (current()) this.peaksChunks.set(url, { levels, arrived: performance.now() });
    });
    return null;
  }

  /** Calls `listener` whenever a chunk arrives; returns what stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Releases every chunk, cancels the fetches under way, and forgets what failed. */
  clear() {
    this.generation++;
    for (const chunk of this.strips.values()) chunk.bitmap.close();
    this.strips.clear();
    this.peaksChunks.clear();
    this.queue.clear();
    for (const load of this.loading.values()) load.controller?.abort();
    this.loading.clear();
    this.failed.clear();
    this.evicted.clear();
  }

  private failing(key: string) {
    return (this.failed.get(key) ?? -Infinity) > performance.now();
  }

  private keep(key: string, chunk: StripChunk) {
    this.strips.set(key, chunk);
    this.evicted.delete(key);
    for (const [old, stale] of this.strips) {
      if (this.strips.size <= MAX_BITMAPS) break;
      stale.bitmap.close();
      this.strips.delete(old);
      this.evicted.set(old, performance.now());
    }
  }

  // `run` is given what says whether no clear() came since it started, and what cancels its fetch.
  private ask(key: string, wanted: () => boolean, run: (current: () => boolean, signal: AbortSignal) => Promise<void>) {
    const known = this.loading.get(key) ?? this.queue.get(key);
    if (known) known.wanted = [...known.wanted.slice(1 - MAX_WANTED), wanted];
    else {
      const generation = this.generation;
      this.queue.set(key, { run: (signal) => run(() => this.generation === generation, signal), wanted: [wanted] });
    }
    this.next();
    this.prune();
  }

  // Cancels the fetches under way that no canvas wants any more. Looked at once the drawing that
  // asked is over (a microtask later), when every chunk it wants has been asked for again.
  private prune() {
    if (this.pruning) return;
    this.pruning = true;
    queueMicrotask(() => {
      this.pruning = false;
      for (const [key, load] of this.loading) {
        if (load.wanted.some((wanted) => wanted())) continue;
        load.controller?.abort();
        this.loading.delete(key);
      }
      this.next();
    });
  }

  private next() {
    for (const [key, load] of this.queue) {
      if (this.loading.size >= MAX_LOADS) return;
      this.queue.delete(key);
      if (!load.wanted.some((wanted) => wanted())) continue;
      const controller = new AbortController();
      load.controller = controller;
      this.loading.set(key, load);
      load
        .run(controller.signal)
        .catch((error) => {
          if (!controller.signal.aborted) this.failed.set(key, error instanceof Gone ? Infinity : performance.now() + RETRY_MS);
        })
        .finally(() => {
          if (this.loading.get(key) === load) this.loading.delete(key);
          for (const listener of this.listeners) listener();
          this.next();
        });
    }
  }
}

// A chunk answered 404: there is none to show, for good.
class Gone extends Error {}

async function fetched(url: string, signal: AbortSignal): Promise<Response> {
  const answer = await fetch(url, { signal });
  if (answer.status === 404) throw new Gone(url);
  if (!answer.ok) throw new Error(`${answer.status} for ${url}`);
  return answer;
}

// A Peaks chunk as served (backend/app/derived.py), little-endian:
// [buckets_per_second u16][count u32][min i8 × count][max i8 × count].
function readPeaks(bytes: ArrayBuffer): Peaks {
  const header = new DataView(bytes, 0, 6);
  const count = header.getUint32(2, true);
  return { perSecond: header.getUint16(0, true), min: new Int8Array(bytes, 6, count), max: new Int8Array(bytes, 6 + count, count) };
}
