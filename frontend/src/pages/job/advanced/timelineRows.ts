import { DRAG_EFFECT, DRAG_LOOK, DRAG_MEDIA, DRAG_MEDIA_PICTURE, DRAG_MEDIA_SOUND, DRAG_SHAPE, DRAG_TEXT } from "./drag";
import { trackLanes } from "./edits";
import type { TrackKind } from "./trackState";

// Which rows the Advanced Edit's Timeline draws (.scratch/timeline-compact/spec.md): only the Tracks
// with something on them, as many lanes as their overlaps need, and the Video Track always. An empty
// Track shows as one empty row while something it takes is being dragged from the asset panel, to
// drop on; the rest of the time it isn't drawn.

/** The Tracks spread over lanes: the layers'. */
export type LayerKind = Extract<TrackKind, "text" | "shape" | "adjust" | "overlay" | "behind" | "music">;

/** Whether an empty `kind` Track shows, to drop on, while `dragging` (the asset types of what is dragged; null when nothing is). */
export function takesDrag(kind: LayerKind, dragging: readonly string[] | null): boolean {
  if (!dragging) return false;
  const has = (type: string) => dragging.includes(type);
  // A Media Library item says whether it has a picture and sound; one that says neither is shown
  // to every Track that takes media, and the drop sorts it out.
  const told = has(DRAG_MEDIA_PICTURE) || has(DRAG_MEDIA_SOUND);
  switch (kind) {
    case "text":
      return has(DRAG_TEXT);
    case "shape":
      return has(DRAG_SHAPE);
    case "adjust":
      return has(DRAG_LOOK) || has(DRAG_EFFECT);
    case "overlay":
    case "behind":
      return has(DRAG_MEDIA) && (!told || has(DRAG_MEDIA_PICTURE));
    case "music":
      return has(DRAG_MEDIA) && (!told || has(DRAG_MEDIA_SOUND));
  }
}

/**
 * The rows a layer Track draws of its `items`: a lane each, the first next to the Video Track (drawn
 * last above it, `upward`); or, empty, one empty row while `dragging` something it takes, else none.
 */
export function rowLanes<T extends { start: number; secs: number }>(items: T[], kind: LayerKind, upward: boolean, dragging: readonly string[] | null): T[][] {
  const found = trackLanes(items);
  if (found.length) return upward ? found.reverse() : found;
  return takesDrag(kind, dragging) ? [[]] : [];
}

/**
 * Whether the Captions Track is drawn: while the plan has captions (`cues`) or a Segment's are on
 * their way (`pending`); before the plan comes, if the Job is captioned, so that it doesn't jump in.
 * Nothing is dropped on it, so it never shows empty for a drag.
 */
export function captionsShown({ planned, cues, pending, captioned }: { planned: boolean; cues: number; pending: number; captioned: boolean }): boolean {
  return planned ? cues > 0 || pending > 0 : captioned;
}
