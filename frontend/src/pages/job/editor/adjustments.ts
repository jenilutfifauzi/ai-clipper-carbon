import type { AdjustmentEvent, Grade, RenderPlan } from "../../../api";
import { foldGrade, gradeFilterId, hasGradeFilter } from "./grading";

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

/** An Adjustment Layer as the preview draws it at a time: its Grade, how much of it shows, and its SVG filter's id (none for a vignette alone). */
export interface AdjustmentFilter {
  id: string;
  grade: Grade;
  weight: number;
  filterId: string | null;
}

/**
 * The plan's Adjustment Layers showing at `time`, in the order they are applied (the plan's), each
 * with its weight rounded to a 200th (so that a fade redraws the preview at most that often); none
 * neutral or at weight 0, which change nothing.
 */
export function adjustmentFilters(plan: RenderPlan | null, time: number): AdjustmentFilter[] {
  return (plan?.adjustments ?? []).flatMap((event) => {
    const weight = Math.round(adjustmentWeight(event, time) * 200) / 200;
    if (weight <= 0 || !foldGrade(event.grade)) return [];
    const filterId = hasGradeFilter(event.grade) ? `adjust-${event.id}-${gradeFilterId(event.grade)}` : null;
    return [{ id: event.id, grade: event.grade, weight, filterId }];
  });
}
