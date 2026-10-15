// How many chunks are fetched at once, and how many decoded Filmstrip chunks are kept.
const MAX_LOADS = 2;
const MAX_BITMAPS = 12;
// A chunk evicted this recently isn't fetched again at once, so that more chunks on screen than the
// cache holds don't fetch one another out in a loop.
const REFETCH_MS = 1000;

/** A Filmstrip chunk, decoded: its frames side by side, how many, and when it arrived (to fade in). */
export interface StripChunk {
  bitmap: ImageBitmap;
  frames: number;
  arrived: number;
}

type Load = { run: () => Promise<void>; wanted: (() => boolean)[] };

/**
 * The Timeline's derived media for the Advanced Edit's session (.scratch/timeline-visuals/spec.md,
 * "Drawing"): chunks fetched at most MAX_LOADS at a time, in the order asked for, and dropped from the
 * queue when no canvas wants them any more by the time a load is free. Filmstrip chunks are decoded
 * at the height they are drawn, and the last MAX_BITMAPS used are kept, released when evicted.
 */
export class MediaCache {
  private strips = new Map<string, StripChunk>();
  private evicted = new Map<string, number>();
  // Chunks with no answer to show: off the grid, made in error, or gone.
  private failed = new Set<string>();
  private queue = new Map<string, Load>();
  private loading = new Set<string>();
  private listeners = new Set<() => void>();

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
    if (this.failed.has(key) || performance.now() - (this.evicted.get(key) ?? -Infinity) < REFETCH_MS) return null;
    this.ask(key, wanted, async () => {
      const answer = await fetch(url);
      if (!answer.ok) throw new Error(`${answer.status}`);
      const frames = Number(answer.headers.get("X-Frames"));
      const bitmap = await createImageBitmap(await answer.blob(), { resizeHeight: height, resizeQuality: "medium" });
      this.keep(key, { bitmap, frames, arrived: performance.now() });
    });
    return null;
  }

  /** Calls `listener` whenever a chunk arrives; returns what stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Releases every decoded chunk. */
  clear() {
    for (const chunk of this.strips.values()) chunk.bitmap.close();
    this.strips.clear();
    this.queue.clear();
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

  private ask(key: string, wanted: () => boolean, run: () => Promise<void>) {
    if (this.loading.has(key)) return;
    const queued = this.queue.get(key);
    if (queued) queued.wanted.push(wanted);
    else this.queue.set(key, { run, wanted: [wanted] });
    this.next();
  }

  private next() {
    for (const [key, load] of this.queue) {
      if (this.loading.size >= MAX_LOADS) return;
      this.queue.delete(key);
      if (!load.wanted.some((wanted) => wanted())) continue;
      this.loading.add(key);
      load
        .run()
        .catch(() => this.failed.add(key))
        .finally(() => {
          this.loading.delete(key);
          for (const listener of this.listeners) listener();
          this.next();
        });
    }
  }
}
