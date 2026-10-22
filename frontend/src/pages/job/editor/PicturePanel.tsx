import { useLayoutEffect, useRef } from "react";
import type { BlendMode, Grade, Picture, VideoEffect } from "../../../api";
import { animatedPicture, type Look } from "./animation";
import { GradeVignette, useGradeFilter } from "./GradeFilters";
import { isKeyed, pictureAt, pictureStyle } from "./picture";
import type { Playback } from "./playback";
import { effectsFilter, mixBlendMode, pictureBox } from "./videoEffects";

/**
 * A Picture of the plan drawn on the stage (ADR 0007): a box at its centre as large as it is drawn,
 * turned and flipped by CSS transforms. `media` (the video or image) fills it, but for what its crop
 * cuts off and its rounded corners, under its border, at the picture's opacity, or at `faded`
 * instead. Its `grade` (an Overlay's, ADR 0013) is a filter on the media alone, its vignette a layer
 * over it, so that its border and shadow keep their colours, as the renderer grades it before them.
 * Its Video Effects (an Overlay's, ADR 0014) are imitated by a filter after its Grade's on the same
 * element (EffectFilters), as the renderer draws them after it. Its `blend` (an Overlay's Blend Mode)
 * is a `mix-blend-mode` on its outer element, so that its shadow and opacity are blended too, as the
 * renderer blends the picture drawn with them over what is under it.
 * Its shadow is a filter on a layer that isn't turned, so that it falls in screen space as the
 * renderer's does. It is only drawn: the Advanced Edit's stage lays its handle and Grips over it
 * (StageEdit.tsx).
 *
 * A keyed picture (ADR 0008) moves with `playback`: on every frame of its clock (and every seek) it
 * is sampled at the time shown (`pictureAt`) and its box, turn and opacity are written to its
 * elements directly, so that a frame doesn't render the stage again. So does an animated one (an
 * Overlay coming on or going off), its animations' `look` at the time shown stacked on its keyed
 * values (animatedPicture), as the renderer's overlay_at draws it.
 */
export function PicturePanel({
  picture,
  frame,
  media,
  faded,
  hidden,
  playback,
  look,
  grade,
  effects,
  start,
  blend,
}: {
  picture: Picture;
  frame: { width: number; height: number };
  media: React.ReactNode;
  faded?: number;
  hidden?: boolean;
  playback?: Playback;
  look?: (time: number) => Look;
  grade?: Grade;
  // Planned: enabled, their sizes as drawn.
  effects?: VideoEffect[];
  // Its item's start on the Timeline, which its effects that change with time count from.
  start?: number;
  blend?: BlendMode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLDivElement>(null);
  const edge = useRef<HTMLDivElement>(null);
  const moving = isKeyed(picture) || look ? playback : undefined;
  const drawn = moving ? drawnAt(picture, moving.shownTime, frame, look) : picture;
  const { opacity, inner, radius, border, shadow, ...place } = pictureStyle(drawn, frame);
  // Hidden, or as its box is: a MediaSegment's box hides it outside its span, which "visible" would undo.
  const visibility = hidden ? "hidden" : undefined;
  const graded = useGradeFilter(grade);
  const effected = effectsFilter(effects, pictureBox(picture), start, frame);
  const filter = [graded, effected].filter(Boolean).join(" ") || undefined;

  useLayoutEffect(() => {
    if (!moving) return;
    const paint = () => {
      const { left, top, width, height, transform, opacity, radius } = pictureStyle(drawnAt(picture, moving.shownTime, frame, look), frame);
      if (box.current) Object.assign(box.current.style, { left, top, width, height, transform });
      if (shown.current) {
        if (faded === undefined) shown.current.style.opacity = String(opacity);
        shown.current.style.borderRadius = radius ?? "";
      }
      if (edge.current) edge.current.style.borderRadius = radius ?? "";
    };
    paint();
    return moving.subscribe(paint);
  }, [moving, picture, frame, faded, look]);

  return (
    <div className="pointer-events-none absolute inset-0" style={{ filter: shadow, visibility, mixBlendMode: mixBlendMode(blend) }}>
      <div ref={box} className="absolute" style={place}>
        <div ref={shown} className="absolute inset-0 overflow-hidden" style={{ opacity: faded ?? opacity, borderRadius: radius }}>
          <div className="absolute" style={{ ...inner, filter }}>
            {media}
          </div>
          <GradeVignette grade={grade} />
          {border && <div ref={edge} className="absolute inset-0" style={{ border, borderRadius: radius }} />}
        </div>
      </div>
    </div>
  );
}

// A moving `picture` as drawn at `time` on the Canvas `frame`: sampled from its Keyframes, and animated by its `look` there when it has one.
const drawnAt = (picture: Picture, time: number, frame: { width: number; height: number }, look?: (time: number) => Look) =>
  look ? animatedPicture(picture, time, look(time), frame) : pictureAt(picture, time, frame);
