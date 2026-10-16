// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, worked out
// from numbers and edits alone, without React or a canvas: Zoom to fit, the Filmstrip and Peaks
// chunks an item needs, the frame each tile shows, the Peaks level for a zoom, the gain along an
// item, and the Volume Line's curve; and for .scratch/navigation-playback/spec.md, the Edit Points.
import type { PlayedSegment } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { isPicked, itemsOf, LISTS, TRACK_OF, type ItemKind, type Pick } from "./pick";
import type { TrackKind } from "./trackState";

// Zoom to fit (GLOSSARY.md).

// How far the Timeline zooms in from showing the whole Clip.
export const MAX_ZOOM = 40;
// Zoom to fit leaves this much of what it fits on each side of it.
const FIT_MARGIN = 0.05;

/** What the Timeline shows: its zoom (1× is the whole Clip) and how far it is scrolled, in CSS pixels. */
export interface ZoomedView {
  zoom: number;
  scroll: number;
}

/**
 * The view that fits `pick` on a Timeline `width` CSS pixels wide for its times (the whole Clip's
 * width at 1×), now at `zoom`: what is picked across it with a margin on each side, centred, at most
 * 40×. Items go by their Timeline time, Segments as `played`; the hook by its span; the captions are
 * the whole Clip; a join is centred at the zoom the Timeline is at. Nothing picked is the whole Clip
 * from its start. The view never scrolls past either end of the Clip.
 */
export function zoomToFit(
  { pick, edits, played, duration }: { pick: Pick; edits: AdvancedEdits; played: PlayedSegment[]; duration: number },
  { width, zoom }: { width: number; zoom: number },
): ZoomedView {
  const span = spanOf(pick, edits, played, duration);
  if (!span) return { zoom: 1, scroll: 0 };
  // Pixels a second at 1×, as the Timeline draws them.
  const fit = width / Math.max(duration, 1);
  const across = (span.end - span.start) * (1 + 2 * FIT_MARGIN);
  const fitted = pick?.kind === "join" ? zoom : Math.min(Math.max(width / (across * fit), 1), MAX_ZOOM);
  const pps = fit * fitted;
  const scroll = ((span.start + span.end) / 2) * pps - width / 2;
  return { zoom: fitted, scroll: Math.min(Math.max(scroll, 0), Math.max(duration * pps - width, 0)) };
}

// What Zoom to fit fits, in Timeline time and within the Clip: nothing when nothing is picked.
function spanOf(pick: Pick, edits: AdvancedEdits, played: PlayedSegment[], duration: number): { start: number; end: number } | null {
  const shownOf = (id: string) => played[edits.segments.findIndex((segment) => segment.id === id)];
  const spans: { start: number; end: number }[] = [];
  if (pick?.kind === "hook") spans.push({ start: edits.hook_start, end: edits.hook_start + edits.hook_secs });
  else if (pick?.kind === "captions") spans.push({ start: 0, end: duration });
  else if (pick?.kind === "join") {
    const shown = shownOf(pick.after);
    if (shown) spans.push({ start: shown.end, end: shown.end });
  } else if (pick?.kind === "items") {
    for (const item of pick.items) {
      if (item.kind === "segment") {
        const shown = shownOf(item.id);
        if (shown) spans.push(shown);
        continue;
      }
      const timed = (edits[LISTS[item.kind]] as { id: string; start: number; secs: number }[]).find((other) => other.id === item.id);
      if (timed) spans.push({ start: timed.start, end: timed.start + timed.secs });
    }
  }
  if (!spans.length) return null;
  const within = (time: number) => Math.min(Math.max(time, 0), duration);
  return { start: within(Math.min(...spans.map((span) => span.start))), end: within(Math.max(...spans.map((span) => span.end))) };
}

/**
 * The view after zooming by `factor` (the zoom buttons' ×1.5 or ÷1.5) about the playhead, at
 * `playhead` seconds, on a Timeline `width` CSS pixels wide for its times (the whole Clip's width at
 * 1×), now at `zoom` and scrolled `scroll` pixels: the playhead in view keeps its place on screen,
 * and one out of view is centred. The zoom stays between 1× and 40×, and at either already the view
 * stays as it is. The view never scrolls past either end of the Clip.
 */
export function zoomAboutPlayhead({
  zoom,
  scroll,
  width,
  duration,
  playhead,
  factor,
}: {
  zoom: number;
  scroll: number;
  width: number;
  duration: number;
  playhead: number;
  factor: number;
}): ZoomedView {
  const next = Math.min(Math.max(zoom * factor, 1), MAX_ZOOM);
  if (next === zoom) return { zoom, scroll };
  // Pixels a second at 1×, as the Timeline draws them.
  const fit = width / Math.max(duration, 1);
  const at = playhead * fit * zoom - scroll;
  const kept = at >= 0 && at <= width ? at : width / 2;
  const pps = fit * next;
  return { zoom: next, scroll: Math.min(Math.max(playhead * pps - kept, 0), Math.max(duration * pps - width, 0)) };
}

// --- Edit Points (GLOSSARY.md), and the edges items snap to ---

// Edges this close together are one Edit Point.
const SAME_EDGE = 1e-6;

/**
 * The edges items snap to, besides the playhead and the Clip's ends; the Edit Points are made of
 * them too, so that the two agree. They are the hook's (while it has text), the Text Layers', Music
 * Clips' and Overlays', and where each Segment gives way to the next, as `played`. Those on a
 * `hidden` Track are left out, and so are those of `moving` when it is a Pick of several, which move
 * together. Unsorted, and as they are, even past the Clip's end.
 */
export function edgesOf(
  edits: AdvancedEdits,
  played: PlayedSegment[],
  { hidden = [], moving = null }: { hidden?: TrackKind[]; moving?: Pick } = {},
): number[] {
  const edges: number[] = [];
  if (edits.hook_text.trim() && !hidden.includes("hook")) edges.push(edits.hook_start, edits.hook_start + edits.hook_secs);
  const left = (kind: ItemKind, id: string) => hidden.includes(TRACK_OF[kind]) || (itemsOf(moving).length > 1 && isPicked(moving, kind, id));
  for (const kind of ["text", "music", "overlay"] as const) {
    for (const item of edits[LISTS[kind]]) if (!left(kind, item.id)) edges.push(item.start, item.start + item.secs);
  }
  if (!hidden.includes("video")) for (const shown of played) edges.push(shown.end);
  return edges;
}

/**
 * The Edit Points of a Clip `duration` seconds long, which ↑ and ↓ go between: its start and end,
 * and the edges of `edits` within it (`edgesOf`) but those on a `hidden` Track. Sorted, each once.
 */
export function editPoints(
  edits: AdvancedEdits,
  played: PlayedSegment[],
  { duration, hidden = [] }: { duration: number; hidden?: TrackKind[] },
): number[] {
  const within = edgesOf(edits, played, { hidden }).filter((edge) => edge > 0 && edge < duration);
  const sorted = [0, ...within, duration].sort((a, b) => a - b);
  return sorted.filter((point, i) => i === 0 || point - sorted[i - 1] > SAME_EDGE);
}

/**
 * The first of the sorted `points` after `time`, or null when there is none. A point within half a
 * frame of `time`, at `fps`, is where the playhead already is.
 */
export function nextEditPoint(points: number[], time: number, fps: number): number | null {
  return points.find((point) => point > time + 0.5 / fps) ?? null;
}

/** The last of the sorted `points` before `time`, or null when there is none; as `nextEditPoint`. */
export function previousEditPoint(points: number[], time: number, fps: number): number | null {
  return points.findLast((point) => point < time - 0.5 / fps) ?? null;
}

// --- Filmstrips, and the canvas they are drawn on ---

// A Filmstrip or Peaks chunk holds this many seconds of its media, from a multiple of it
// (docs/adr/0005-timeline-media-is-derived-per-chunk.md).
export const CHUNK_SECS = 30;
// A Filmstrip's frames are made this many pixels tall, one for each whole second.
export const STRIP_HEIGHT = 112;
// An item's canvas is at most this many device pixels wide.
const MAX_CANVAS_PX = 4096;

// A stretch across the Timeline, in CSS pixels.
export type Span = { left: number; right: number };

/** The starts of the chunks holding the frames from `from` to `to` seconds of the media (both in). */
export function chunksOf(from: number, to: number): number[] {
  const starts = [];
  for (let start = Math.floor(Math.max(from, 0) / CHUNK_SECS) * CHUNK_SECS; start <= to; start += CHUNK_SECS) starts.push(start);
  return starts;
}

/**
 * A tile's width, in CSS pixels, in a row `height` pixels tall, for a video `width` × `height`: a
 * frame's, which is made STRIP_HEIGHT pixels tall at the video's aspect, rounded to even.
 */
export function tileWidth(height: number, videoWidth: number, videoHeight: number): number {
  const made = 2 * Math.round((STRIP_HEIGHT * videoWidth) / videoHeight / 2);
  return (made * height) / STRIP_HEIGHT;
}

/** A tile of a Filmstrip: where it is, in pixels from the item's left edge, and the frame it shows. */
export interface Tile {
  left: number;
  width: number;
  // The second of the media whose frame it shows.
  frame: number;
}

/**
 * The tiles of an item's Filmstrip across `span` (pixels from the item's left edge): tiles `tile`
 * pixels wide from its left edge, so that they keep their place in time as the Timeline scrolls. Each
 * shows the frame under the middle of its visible part, in `view` (where the item is on screen) and
 * within the item's `width`, rounded to the nearest second and kept within the media's `frames`.
 * `mediaStart` is the media's time at the item's left edge, and `pps` the Timeline's pixels a second.
 */
export function filmstripTiles({
  width,
  mediaStart,
  frames,
  tile,
  pps,
  view,
  span,
}: {
  width: number;
  mediaStart: number;
  frames: number;
  tile: number;
  pps: number;
  view: Span;
  span: Span;
}): Tile[] {
  const tiles: Tile[] = [];
  const from = Math.max(span.left, 0);
  const to = Math.min(span.right, width);
  for (let left = Math.floor(from / tile) * tile; left < to; left += tile) {
    const right = Math.min(left + tile, width);
    // Its visible part, or the whole of it in the margins off screen.
    const shown = Math.min(right, view.right) > Math.max(left, view.left) ? { left: Math.max(left, view.left), right: Math.min(right, view.right) } : { left, right };
    const time = mediaStart + (shown.left + shown.right) / 2 / pps;
    tiles.push({ left, width: tile, frame: Math.min(Math.max(Math.round(time), 0), frames - 1) });
  }
  return tiles;
}

/**
 * The stretch of an item an item's canvas covers, in CSS pixels from the item's left edge: its
 * visible part and half the viewport on each side, at most MAX_CANVAS_PX device pixels wide (about
 * the visible part's middle), at `dpr` device pixels to a CSS pixel. `item` and `view` are in the
 * Timeline's pixels from 0 s. Null for an item wholly outside that margin.
 */
export function canvasWindow(item: { left: number; width: number }, view: Span, dpr: number): Span | null {
  const margin = (view.right - view.left) / 2;
  let left = Math.max(item.left, view.left - margin);
  let right = Math.min(item.left + item.width, view.right + margin);
  if (right <= left) return null;
  const most = MAX_CANVAS_PX / dpr;
  if (right - left > most) {
    const middle = (Math.max(left, view.left) + Math.min(right, view.right)) / 2;
    left = Math.max(left, middle - most / 2);
    right = Math.min(right, left + most);
    left = right - most;
  }
  return { left: left - item.left, right: right - item.left };
}

// --- Waveforms ---

// The Peaks pyramid halves until a level has this many buckets or fewer (Concat's Pyramid::of).
const COARSEST_BUCKETS = 64;

/**
 * A chunk's Peaks, or a coarser level of them: the lowest and highest of the sound in each bucket,
 * `perSecond` buckets a second, in 127ths of full scale (int8, as served).
 */
export interface Peaks {
  perSecond: number;
  min: Int8Array;
  max: Int8Array;
}

/**
 * The starts of the chunks an item needs across `span` (pixels from its left edge), within its
 * `width`: of its media from `mediaStart` at its left edge (a Music Clip's offset into its song, a
 * Segment's start in its media), at `pps` pixels a second, within the media's `duration`.
 */
export function chunksAcross({
  mediaStart,
  pps,
  width,
  span,
  duration,
}: {
  mediaStart: number;
  pps: number;
  width: number;
  span: Span;
  duration: number;
}): number[] {
  const from = mediaStart + Math.max(span.left, 0) / pps;
  const to = Math.min(mediaStart + Math.min(span.right, width) / pps, duration);
  if (to <= from) return [];
  // The chunk the end falls on the start of isn't needed.
  return chunksOf(from, to).filter((start) => start < to);
}

/** `peaks`, then each level folded two buckets to one, down to COARSEST_BUCKETS or fewer: finest first. */
export function peaksPyramid(peaks: Peaks): Peaks[] {
  const levels = [peaks];
  for (let level = peaks; level.min.length > COARSEST_BUCKETS; levels.push(level)) {
    const count = Math.ceil(level.min.length / 2);
    const min = new Int8Array(count);
    const max = new Int8Array(count);
    for (let i = 0; i < count; i++) {
      // A trailing bucket on its own still counts.
      const pair = Math.min(2 * i + 1, level.min.length - 1);
      min[i] = Math.min(level.min[2 * i], level.min[pair]);
      max[i] = Math.max(level.max[2 * i], level.max[pair]);
    }
    level = { perSecond: level.perSecond / 2, min, max };
  }
  return levels;
}

/**
 * The level of `pyramid` to draw at `pps` pixels a second and `dpr` device pixels to a pixel: the
 * coarsest with at least one bucket for each device-pixel column, or the finest when none has.
 */
export function peaksLevel(pyramid: Peaks[], pps: number, dpr: number): Peaks {
  const columns = pps * dpr;
  for (let i = pyramid.length - 1; i > 0; i--) if (pyramid[i].perSecond >= columns) return pyramid[i];
  return pyramid[0];
}

/**
 * The lowest and highest of `peaks` from `from` to `to` seconds into them, in [-1, 0] and [0, 1]: of
 * the buckets that begin in that stretch, so that a bucket across two columns is read by one, or of
 * the bucket it is in when it is narrower than one (Concat's Peaks::extremes). Silence past the end.
 */
export function peaksExtremes(peaks: Peaks, from: number, to: number): [number, number] {
  const count = peaks.min.length;
  if (!count || to <= from) return [0, 0];
  // A hair of float noise at a boundary is forgiven.
  const HAIR = 1e-3;
  const start = from * peaks.perSecond;
  let first = Math.min(Math.max(Math.ceil(start - HAIR), 0), count);
  let last = Math.min(Math.max(Math.ceil(to * peaks.perSecond - HAIR), 0), count);
  if (first >= last) {
    if (start >= count) return [0, 0];
    first = Math.min(Math.max(Math.floor(start), 0), count - 1);
    last = first + 1;
  }
  let low = 0;
  let high = 0;
  for (let i = first; i < last; i++) {
    low = Math.min(low, peaks.min[i]);
    high = Math.max(high, peaks.max[i]);
  }
  return [low / 127, high / 127];
}

/**
 * How loud an item `secs` long is `time` seconds into it: its volume through its fade in's and fade
 * out's linear ramps (none for a fade of 0).
 */
export function gainAt(time: number, { volume, secs, fade_in, fade_out }: { volume: number; secs: number; fade_in: number; fade_out: number }): number {
  const ramp = (into: number, fade: number) => (fade > 0 ? Math.min(Math.max(into / fade, 0), 1) : 1);
  return volume * ramp(time, fade_in) * ramp(secs - time, fade_out);
}

/**
 * How loud a Source Segment is all along it: the Clip's own sound's volume, with no fades, times a
 * volume of the Segment's own (1 unless set), as the renderer has it.
 */
export function sourceGain({ source_volume }: { source_volume: number }, segment: { volume?: number }): number {
  return source_volume * (segment.volume ?? 1);
}

// --- The Volume Line ---

// The Volume Line's curve: a volume is 2 · height^VOLUME_CURVE, so that 100% sits at two thirds of
// an item's height (0% at the bottom, 200% at the top), which gives the quiet range room.
const VOLUME_CURVE = Math.log(1 / 2) / Math.log(2 / 3);
// The loudest volume, at the top of an item.
const VOLUME_MAX = 2;

/** The volume the Volume Line sets at `height` up an item (0 at the bottom, 1 at the top), rounded to 0.01. */
export function volumeOfHeight(height: number): number {
  const p = Math.min(Math.max(height, 0), 1);
  return Math.round(VOLUME_MAX * p ** VOLUME_CURVE * 100) / 100;
}

/** How far up an item (0 at the bottom, 1 at the top) the Volume Line of `volume` is drawn. */
export function volumeHeight(volume: number): number {
  const gain = Math.min(Math.max(volume, 0), VOLUME_MAX);
  return (gain / VOLUME_MAX) ** (1 / VOLUME_CURVE);
}

// A drag of the Volume Line goes as if over at least this many pixels, so that in a short lane (a
// phone's Music lane is 35 px) a small move is a small change.
const VOLUME_TRAVEL_PX = 120;

/** The volume a drag of the Volume Line by `dy` pixels (down is quieter) sets, from `volume`, on an item `height` pixels tall. */
export function volumeDragged(volume: number, dy: number, height: number): number {
  return volumeOfHeight(volumeHeight(volume) - dy / Math.max(height, VOLUME_TRAVEL_PX));
}
