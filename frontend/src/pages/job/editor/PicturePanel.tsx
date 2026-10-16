import { useLayoutEffect, useRef } from "react";
import type { Picture } from "../../../api";
import { isKeyed, pictureAt, pictureStyle } from "./picture";
import type { Playback } from "./playback";

/**
 * A Picture of the plan drawn on the stage (ADR 0007): a box at its centre as large as it is drawn,
 * turned and flipped by CSS transforms. `media` (the video or image) fills it, but for what its crop
 * cuts off and its rounded corners, under its border, at the picture's opacity, or at `faded`
 * instead. Its shadow is a filter on a layer that isn't turned, so that it falls in screen space as
 * the renderer's does. It is only drawn: the Advanced Edit's stage lays its handle and Grips over it
 * (StageEdit.tsx).
 *
 * A keyed picture (ADR 0008) moves with `playback`: on every frame of its clock (and every seek) it
 * is sampled at the time shown (`pictureAt`) and its box, turn and opacity are written to its
 * elements directly, so that a frame doesn't render the stage again.
 */
export function PicturePanel({
  picture,
  frame,
  media,
  faded,
  hidden,
  playback,
}: {
  picture: Picture;
  frame: { width: number; height: number };
  media: React.ReactNode;
  faded?: number;
  hidden?: boolean;
  playback?: Playback;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const moving = isKeyed(picture) ? playback : undefined;
  const drawn = moving ? pictureAt(picture, moving.shownTime) : picture;
  const { opacity, inner, radius, border, shadow, ...place } = pictureStyle(drawn, frame);
  const visibility = hidden ? "hidden" : "visible";

  useLayoutEffect(() => {
    if (!moving) return;
    const paint = () => {
      const { left, top, width, height, transform, opacity, radius } = pictureStyle(pictureAt(picture, moving.shownTime), frame);
      if (box.current) Object.assign(box.current.style, { left, top, width, height, transform });
      if (shown.current) {
        if (faded === undefined) shown.current.style.opacity = String(opacity);
        shown.current.style.borderRadius = radius ?? "";
      }
      if (edge.current) edge.current.style.borderRadius = radius ?? "";
    };
    paint();
    return moving.subscribe(paint);
  }, [moving, picture, frame, faded]);

  return (
    <div className="pointer-events-none absolute inset-0" style={{ filter: shadow, visibility }}>
      <div ref={box} className="absolute" style={place}>
        <div ref={shown} className="absolute inset-0 overflow-hidden" style={{ opacity: faded ?? opacity, borderRadius: radius }}>
          <div className="absolute" style={inner}>
            {media}
          </div>
          {border && <div ref={edge} className="absolute inset-0" style={{ border, borderRadius: radius }} />}
        </div>
      </div>
    </div>
  );
}
