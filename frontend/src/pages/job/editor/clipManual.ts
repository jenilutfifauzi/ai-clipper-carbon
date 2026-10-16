import type { CandidateChange, Layout, RenderPlan, Transform } from "../../../api";
import { FITTED, withClipLayout, type LayoutEdits } from "./manual";
import { sourceTime } from "./ScenesTrack";
import { withPictureTransform, type PictureEdits, type PictureSource } from "./stagePicture";

/**
 * The clip editor's Manual (docs/adr/0007): Manual among its Layout choices, the clip's and a
 * Scene's, and a Manual Scene's picture panned and scaled on its preview. Each change is saved at
 * once, so these give what to save: only the fields it changes.
 */

/**
 * The plan's Scene a clip made Manual is framed as: `near` (the one under the playhead) when it
 * shows the Source, or else the first that does; null when none does.
 */
export function sourceSceneNear(plan: RenderPlan, near: number): number | null {
  const shows = (index: number) => !!plan.scenes[index] && sourceTime(plan, index, plan.scenes[index].start) !== null;
  if (shows(near)) return near;
  const first = plan.scenes.findIndex((_, index) => shows(index));
  return first === -1 ? null : first;
}

/**
 * The clip's Layout as chosen: Manual frames every Scene without its own Layout as the Source Scene
 * `near` (`sourceSceneNear`) shows now; another Layout drops the Framing. Before there is a plan,
 * Manual keeps the clip's Framing, or fits the Source.
 */
export function clipLayoutChange(edits: LayoutEdits, plan: RenderPlan | null, near: number, layout: Layout): Pick<CandidateChange, "layout" | "framing"> {
  const index = plan && sourceSceneNear(plan, near);
  if (!plan || index === null) return { layout, framing: layout === "manual" ? (edits.framing ?? FITTED) : null };
  const next = withClipLayout(edits, plan, index, layout);
  return { layout: next.layout, framing: next.framing };
}

/**
 * What a gesture on a Manual Scene's picture saves: the Framing where it is kept, the clip's, or the
 * Layout Overrides with the Scene's own. Null for any other picture, not edited in the clip editor.
 */
export function pictureChange(edits: PictureEdits, plan: RenderPlan, source: PictureSource, transform: Transform): CandidateChange | null {
  if (source.kind !== "manual") return null;
  const next = withPictureTransform(edits, plan, source, transform);
  if (next === edits) return null;
  return next.framing !== edits.framing ? { framing: next.framing } : { layout_overrides: next.layout_overrides };
}
