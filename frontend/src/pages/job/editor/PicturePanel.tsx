import type { Picture } from "../../../api";
import { pictureStyle } from "./picture";

/**
 * A Picture of the plan drawn on the stage (ADR 0007): a box at its centre as large as it is drawn,
 * turned and flipped by CSS transforms. `media` (the video or image) fills it, but for what its crop
 * cuts off, at the picture's opacity, or at `faded` instead; `children` are laid on it (an
 * Overlay's handle) and turn and flip with it.
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
  const { opacity, inner, ...box } = pictureStyle(picture, frame);
  return (
    <div className="absolute" style={{ ...box, visibility: hidden ? "hidden" : "visible" }}>
      <div className="absolute inset-0 overflow-hidden" style={{ opacity: faded ?? opacity }}>
        <div className="absolute" style={inner}>
          {media}
        </div>
      </div>
      {children}
    </div>
  );
}
