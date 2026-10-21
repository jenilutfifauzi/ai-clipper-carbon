import type { AdjustmentEvent, Grade, RenderPlan, VideoEffect } from "../../../api";
import { foldGrade, gradeFilterId, hasGradeFilter } from "./grading";
import { effectsFilterId } from "./videoEffects";
import { FRAME } from "./picture";

/**
 * How much of an Adjustment Layer's Grade shows at `time` (ADR 0013), 0..1: its strength times its
 * fade ramp, up over `fade_in` from its start and down over `fade_out` to its end, as the render's
 * alpha fades; 0 outside its span.
 */
export function adjustmentWeight(event: AdjustmentEvent, time: number): number {
  if (time < event.start || time >= event.end) return 0;
  let ramp = 1;
  if (event.fade_in > 0) ramp = Math.min(ramp, (time - event.start) / event.fade_in);
  if (event.fade_out > 0) ramp = Math.min(ramp, (event.end - time) / event.fade_out);
  return (Math.max(0, Math.min(event.strength, 100)) / 100) * Math.max(0, Math.min(ramp, 1));
}

/**
 * An Adjustment Layer as the preview draws it at a time: its Grade, its Video Effects (planned: the
 * enabled ones, sizes the frame's), how much of them shows, and its SVG filter's id (none for a
 * vignette alone).
 */
export interface AdjustmentFilter {
  id: string;
  // Null while the original is shown (its effects drawn alone).
  grade: Grade | null;
  effects: VideoEffect[];
  // Its start on the Timeline, which its effects that change with time count from.
  start: number;
  weight: number;
  filterId: string | null;
}

/**
 * The plan's Adjustment Layers showing at `time`, in the order they are applied (the plan's), each
 * with its weight rounded to a 200th (so that a fade redraws the preview at most that often); none
 * at weight 0, nor one with a neutral Grade and no effect drawn, which change nothing.
 */
export function adjustmentFilters(plan: RenderPlan | null, time: number): AdjustmentFilter[] {
  return (plan?.adjustment_layers ?? []).flatMap((event) => {
    const weight = Math.round(adjustmentWeight(event, time) * 200) / 200;
    const effects = event.video_effects ?? [];
    const effected = effectsFilterId(effects, FRAME, event.start);
    if (weight <= 0 || (!foldGrade(event.grade) && !effected)) return [];
    const graded = hasGradeFilter(event.grade) ? gradeFilterId(event.grade) : null;
    const filterId = graded || effected ? `adjust-${event.id}-${graded ?? "n"}-${effected ?? "n"}` : null;
    return [{ id: event.id, grade: event.grade, effects, start: event.start, weight, filterId }];
  });
}
