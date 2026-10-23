import { useEffect, useState } from "react";

// What is dragged from the asset panel onto the timeline, as a DataTransfer type: a Media Library
// item (its id), a Text Preset (its id), or a Transition's kind; and onto the timeline or the
// preview, a Stickers tile (its Shape Kind); and onto the timeline, a Filters card (its Look's id)
// or an Effects card (its Video Effect's id), which makes an Adjustment Layer.
export const DRAG_MEDIA = "application/x-clipper-media";
export const DRAG_TEXT = "application/x-clipper-text";
export const DRAG_TRANSITION = "application/x-clipper-transition";
export const DRAG_SHAPE = "application/x-clipper-shape";
export const DRAG_LOOK = "application/x-clipper-look";
export const DRAG_EFFECT = "application/x-clipper-effect";
// Beside DRAG_MEDIA, what the item has, which a drag shows before it drops (its data it doesn't):
// a picture (a video or an image, for the Overlay Tracks) and sound (for the Music Track).
export const DRAG_MEDIA_PICTURE = "application/x-clipper-media-picture";
export const DRAG_MEDIA_SOUND = "application/x-clipper-media-sound";

const ASSET_DRAGS = [DRAG_MEDIA, DRAG_TEXT, DRAG_TRANSITION, DRAG_SHAPE, DRAG_LOOK, DRAG_EFFECT, DRAG_MEDIA_PICTURE, DRAG_MEDIA_SOUND];

/** The asset panel's types among a drag's `types`, or null when it carries none of them (a file from the desktop, a link). */
export function assetDragTypes(types: readonly string[]): string[] | null {
  const found = types.filter((type) => ASSET_DRAGS.includes(type));
  return found.length ? found : null;
}

/**
 * What is being dragged from the asset panel, anywhere in the window (its asset types: assetDragTypes),
 * from its start until it drops or ends; null otherwise. The Timeline draws its empty Tracks' rows to
 * drop on while it lasts, from the drag's start, so that they are there before the pointer is.
 */
export function useAssetDrag(): string[] | null {
  const [dragging, setDragging] = useState<string[] | null>(null);
  useEffect(() => {
    const seen = (event: DragEvent) => {
      const found = assetDragTypes([...(event.dataTransfer?.types ?? [])]);
      if (found) setDragging((now) => (now?.join() === found.join() ? now : found));
    };
    const ended = () => setDragging(null);
    // Out of the window (one from another tab may never end here). Some browsers give no
    // relatedTarget on every leave, so only one at the window's edge counts.
    const left = (event: DragEvent) => {
      const outside = event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
      if (!event.relatedTarget && outside) ended();
    };
    document.addEventListener("dragstart", seen);
    document.addEventListener("dragenter", seen);
    document.addEventListener("dragleave", left);
    document.addEventListener("dragend", ended);
    document.addEventListener("drop", ended);
    return () => {
      document.removeEventListener("dragstart", seen);
      document.removeEventListener("dragenter", seen);
      document.removeEventListener("dragleave", left);
      document.removeEventListener("dragend", ended);
      document.removeEventListener("drop", ended);
    };
  }, []);
  return dragging;
}
