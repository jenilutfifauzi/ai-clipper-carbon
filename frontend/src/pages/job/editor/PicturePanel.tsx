import type { Picture } from "../../../api";
import { pictureStyle } from "./picture";

/**
 * A Picture of the plan drawn on the stage (ADR 0007): a box at its centre as large as it is drawn,
 * turned and flipped by CSS transforms. `media` (the video or image) fills it, but for what its crop
 * cuts off and its rounded corners, under its border, at the picture's opacity, or at `faded`
 * instead. Its shadow is a filter on a layer that isn't turned, so that it falls in screen space as
 * the renderer's does. `children` are laid on it (an Overlay's handle) and turn and flip with it,
 * outside the shadow.
 */
export function PicturePanel({
  picture,
  frame,
  media,
  faded,
  hidden,
  children,
}: {
  picture: Picture;
  frame: { width: number; height: number };
  media: React.ReactNode;
  faded?: number;
  hidden?: boolean;
  children?: React.ReactNode;
}) {
  const { opacity, inner, radius, border, shadow, ...box } = pictureStyle(picture, frame);
  const visibility = hidden ? "hidden" : "visible";
  return (
    <>
      <div className="pointer-events-none absolute inset-0" style={{ filter: shadow, visibility }}>
        <div className="pointer-events-auto absolute" style={box}>
          <div className="absolute inset-0 overflow-hidden" style={{ opacity: faded ?? opacity, borderRadius: radius }}>
            <div className="absolute" style={inner}>
              {media}
            </div>
            {border && <div className="absolute inset-0" style={{ border, borderRadius: radius }} />}
          </div>
        </div>
      </div>
      {children && (
        <div className="absolute" style={{ ...box, visibility }}>
          {children}
        </div>
      )}
    </>
  );
}
