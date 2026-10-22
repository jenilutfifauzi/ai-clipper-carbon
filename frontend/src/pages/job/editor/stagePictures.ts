// The pictures picked and transformed on the preview's stage (ClipPreview's StageHandles, through
// StageEdit's useStageEdit): the Segment's picture under the playhead, the Overlays (the Behind ones
// under that picture, ADR 0015), the Shapes and the Text Layers.
import type { OverlayEvent, RenderPlan } from "../../../api";
import { reachedBehind, type BehindTarget } from "./behindStage";
import type { PictureTarget, StageControls, StageId } from "./ClipPreview";
import type { Editing } from "./InlineText";
import { layerStagePicture } from "./layerStage";
import { allStroke } from "./picture";
import type { Point } from "./pictureGestures";
import type { StagePicture } from "./StageEdit";

// The picture behind the Overlays, at the plan's Scene `scene`: another Scene's is another picture,
// so that one held isn't drawn in the next Scene, nor saved to it.
export const behindId = (scene: number): StageId => `picture:${scene}`;

/**
 * The pictures `controls` can pick and transform on the stage, in the order they are drawn: the
 * picture `behind` every Overlay (of the plan's Scene `scene`), then the Overlays, the Behind ones
 * (ADR 0015) first, as they are at `time`, then the Shapes and the Text Layers, by their areas
 * (layerStage.ts) as they are at `time`, each Text Layer retyped by `edit` when given.
 *
 * A Behind Overlay is drawn under the Segment's picture, so its handle is under the picture's too:
 * a press on the Segment's picture reaches the topmost Behind Overlay there (at `under.now()`) where
 * that picture doesn't show (`under.shows`: off it, or where its cut takes it away; behindStage.ts),
 * and a click (not a drag) on a picked one where the picture shows over it picks the picture.
 */
export function stagePictures(
  plan: RenderPlan,
  controls: StageControls,
  behind: PictureTarget | null,
  scene: number,
  time: number,
  edit: ((editing: Editing) => void) | undefined,
  under: { shows: (point: Point) => boolean; now: () => number } = { shows: () => true, now: () => time },
): StagePicture[] {
  const pictures: StagePicture[] = [];
  const shown = plan.scenes[scene];
  const reached: BehindTarget[] = [];
  if (behind && shown) {
    const picture = behind.transform ? shown.picture : null;
    pictures.push({
      id: behindId(scene),
      label: shown.layout === "media" ? "Video" : shown.layout === "manual" ? "Scene, framed by hand" : "Scene",
      start: shown.start,
      end: shown.end,
      picture,
      transform: picture && behind.transform,
      behind: true,
      grips: behind.grips,
      onTransform: behind.onTransform,
      crop: picture && behind.crop,
      onCrop: behind.onCrop,
      through: (point) => (reached.length ? reachedBehind(reached, point, under.now(), under.shows) : null),
    });
  }
  const segment = behind && shown ? behindId(scene) : null;
  const overlays = controls.overlays;
  // An Overlay as `transformOf` holds it at `time`: none on a locked Track.
  const overlayPicture = (event: OverlayEvent, label: string): StagePicture | null => {
    const transform = overlays!.transformOf(event.id, time);
    if (!transform) return null;
    return {
      id: `overlay:${event.id}`,
      label,
      start: event.start,
      end: event.end,
      picture: event.picture,
      transform,
      onTransform: (next, group) => overlays!.onTransform(event.id, next, group, time),
      crop: overlays!.cropOf?.(event.id) ?? null,
      onCrop: overlays!.onCrop && ((crop, next, group) => overlays!.onCrop!(event.id, crop, next, group)),
    };
  };
  for (const event of overlays ? (plan.behind ?? []) : []) {
    const picture = overlayPicture(event, "Overlay behind the Main Track");
    if (!picture) continue;
    reached.push({ id: picture.id, picture: event.picture, start: event.start, end: event.end });
    pictures.push({ ...picture, under: true, coveredBy: segment ? (point) => (under.shows(point) ? segment : null) : undefined });
  }
  for (const event of overlays ? plan.overlays : []) {
    const picture = overlayPicture(event, "Overlay");
    if (picture) pictures.push(picture);
  }
  const shapes = controls.shapes;
  for (const event of shapes ? plan.shapes : []) {
    const { picture, fitted } = layerStagePicture(event);
    const { id, style, keys } = event.layer;
    const onResize = shapes!.onResize;
    const ends = allStroke(style.kind);
    pictures.push({
      id: `shape:${id}`,
      label: ends ? `Shape: ${style.kind}` : "Shape",
      start: event.start,
      end: event.end,
      picture,
      fitted,
      transform: shapes!.transformOf(id, time) ?? event.layer.transform,
      grips: !onResize ? "corners-rotate" : ends ? "ends" : "all",
      onTransform: (next, group) => shapes!.onTransform(id, next, group, time),
      // Its position keyed, an edge resizes it about its centre, as a Text Layer's box Grip does,
      // so that a resize writes no Keyframe.
      resize: onResize && { aboutCentre: !!(keys.x?.length || keys.y?.length), onResize: (box, next, group) => onResize(id, box, next, group, time) },
    });
  }
  const texts = controls.texts;
  for (const event of texts ? plan.texts : []) {
    const { picture, fitted } = layerStagePicture(event);
    pictures.push({
      id: `text:${event.layer.id}`,
      label: `Text: ${event.lines.join(" ")}`,
      start: event.start,
      end: event.end,
      picture,
      fitted,
      transform: texts!.transformOf(event.layer.id, time) ?? event.layer.transform,
      grips: "corners-rotate",
      onTransform: (next, group) => texts!.onTransform(event.layer.id, next, group, time),
      onBox: texts!.onBox && ((edge, length, group) => texts!.onBox!(event.layer.id, edge, length, group)),
      onEdit: edit && (() => edit({ kind: "text", id: event.layer.id })),
    });
  }
  return pictures;
}
