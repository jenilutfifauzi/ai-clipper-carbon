// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, worked out
// from numbers and edits alone, without React or a canvas: Zoom to fit, the Filmstrip and Peaks
// chunks an item needs, the frame each tile shows, the Peaks level for a zoom, the gain along an
// item, and the Volume Line's curve.
import type { PlayedSegment } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { LISTS, type Pick } from "./pick";

// Zoom to fit (GLOSSARY.md).

// How far the Timeline zooms in from showing the whole Clip.
export const MAX_ZOOM = 40;
// Zoom to fit leaves this much of what it fits on each side of it.
const FIT_MARGIN = 0.05;

/** What the Timeline shows: its zoom (1× is the whole Clip) and how far it is scrolled, in CSS pixels. */
export interface TimelineView {
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
): TimelineView {
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
