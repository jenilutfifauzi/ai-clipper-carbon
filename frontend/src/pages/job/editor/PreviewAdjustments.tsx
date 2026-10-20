import type { ReactNode } from "react";
import type { RenderPlan } from "../../../api";
import { adjustmentFilters, type AdjustmentFilter } from "./adjustments";
import { GradeFilter, GradeVignette } from "./GradeFilters";
import { useShown, type Playback } from "./playback";

/**
 * The Main Track and the Overlays (`children`) under the plan's Adjustment Layers showing at the time
 * shown (ADR 0013), and nothing else: the Watermark, captions, picture layers and hook are drawn
 * after it, ungraded.
 *
 * Not a second copy of the videos, which would decode them twice: one wrapper, always there (so its
 * videos never remount), whose CSS `filter` lists one SVG filter per layer showing, in the order they
 * apply. Each filter grades the picture and mixes it back over the picture as it was by the layer's
 * strength times its fade (an feComposite, as the render's alpha), so the wrapper is a filtered copy
 * at that opacity over an unfiltered one. The weights are redrawn as the playhead moves, at most each
 * 200th of a change, and only this wrapper redraws: its children are the caller's. A layer's vignette
 * is a gradient over the wrapper at its weight's opacity, after every layer's colour (near, not
 * exact, where layers with vignettes overlap).
 */
export function PreviewAdjusted({ plan, playback, children }: { plan: RenderPlan | null; playback: Playback; children: ReactNode }) {
  // Drawn again only when what shows changes.
  useShown(playback, (time) => adjustmentFilters(plan, time).map(({ id, weight, filterId }) => `${id}:${weight}:${filterId}`).join("|"));
  return <AdjustedStack filters={adjustmentFilters(plan, playback.shownTime)}>{children}</AdjustedStack>;
}

/** `children` under the Adjustment Layers `filters` (adjustmentFilters'), as PreviewAdjusted draws them. */
export function AdjustedStack({ filters, children }: { filters: AdjustmentFilter[]; children: ReactNode }) {
  const filter = filters.flatMap(({ filterId }) => (filterId ? [`url(#${filterId})`] : [])).join(" ");
  return (
    <>
      {filter && (
        <svg aria-hidden width={0} height={0} className="pointer-events-none absolute">
          <defs>
            {filters.map(({ filterId, grade, weight }) => filterId && <GradeFilter key={filterId} id={filterId} grade={grade} mix={weight} />)}
          </defs>
        </svg>
      )}
      <div data-adjusted className="absolute inset-0" style={filter ? { filter } : undefined}>
        {children}
      </div>
      {filters.map(({ id, grade, weight }) => (
        <div key={id} aria-hidden className="pointer-events-none absolute inset-0" style={{ opacity: weight }}>
          <GradeVignette grade={grade} />
        </div>
      ))}
    </>
  );
}
