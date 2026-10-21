// .scratch/text-advanced/issues/05-text-layer-transform-on-stage.md: a picture layer (a Text Layer, a Shape)
// on the stage is a picture as an Overlay is (docs/adr/0007, 0010): its Grips are on its area (a Text
// Layer's words and plate, not the room its picture keeps round them for its ink), scaled and turned
// by its Transform. Its corners scale it and the handle above turns it; it has no edges to stretch
// it (a Shape's edges set its width and height instead, .scratch/shapes/issues/05-resize-on-stage.md).
// 12: a keyed one is gripped where its Keyframes have it at the playhead (docs/adr/0008).
import type { Picture, PictureLayerEvent, RenderPlan } from "../../../api";
import { boundsAbout, isKeyed, pictureAt } from "./picture";
import type { Size } from "./pictureGestures";

/**
 * A picture layer's area as a picture of the stage: its size at scale 1 (`fitted`, what its Grips
 * scale), and the Picture of it drawn by its Transform, about its picture's centre, turned with its bounds.
 */
export function layerStagePicture(event: PictureLayerEvent): { picture: Picture; fitted: Size } {
  const { area, picture, bounds } = event;
  const { scale } = event.layer.transform;
  return {
    fitted: { width: area.width, height: area.height },
    picture: { ...picture, width: area.width * scale, height: area.height * scale, bounds },
  };
}

/**
 * The event of a picture layer as its Keyframes have it at `time` seconds into the Clip on the Canvas
 * `frame`: its picture sampled there (pictureAt) and still, its Transform's centre, scale, rotation and opacity as sampled,
 * and its bounds its area's then, scaled and turned about its picture's sampled centre and rounded as
 * a picture's are (backend/app/planner.py's bounds_at). Unkeyed, the event itself.
 */
export function layerEventAt<Event extends PictureLayerEvent>(event: Event, time: number, frame: Size): Event {
  const { picture, area, layer } = event;
  if (!isKeyed(picture)) return event;
  const drawn = pictureAt(picture, time, frame);
  const scale = picture.motion?.scale?.length && picture.unscaled ? drawn.width / picture.unscaled[0] : layer.transform.scale;
  const [x, y] = drawn.centre;
  const angle = (drawn.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  // The area's middle, off its picture's by up to half a pixel, scaled and turned with it.
  const [u, v] = [(area.x + area.width / 2 - picture.centre[0]) * scale, (area.y + area.height / 2 - picture.centre[1]) * scale];
  const [width, height] = [area.width * scale, area.height * scale];
  const [across, down] = [width * Math.abs(cos) + height * Math.abs(sin), width * Math.abs(sin) + height * Math.abs(cos)];
  const bounds = boundsAbout([x + u * cos - v * sin, y + u * sin + v * cos], across, down);
  const transform = { ...layer.transform, x, y, scale, rotation: drawn.rotation, opacity: drawn.opacity };
  return { ...event, layer: { ...layer, transform }, picture: drawn, bounds };
}

/** The plan's picture layers as they are at `time` (`layerEventAt`), by kind. */
export const layersAt = (plan: RenderPlan, time: number): Pick<RenderPlan, "shapes" | "texts"> => ({
  shapes: plan.shapes.map((event) => layerEventAt(event, time, plan)),
  texts: plan.texts.map((event) => layerEventAt(event, time, plan)),
});

/**
 * The event of a picture layer whose area (`planned`, its `layerStagePicture`) the stage draws as
 * `shown` while a gesture holds it: its picture, the same file, placed, scaled, turned and faded with
 * it, and stretched as far as its area is (a Shape's edge Grip, setting its width or height, draws
 * the last picture stretched until the new one comes).
 */
export function heldLayerEvent<Event extends PictureLayerEvent>(event: Event, planned: Picture, shown: Picture): Event {
  if (shown === planned) return event;
  const picture = {
    ...event.picture,
    centre: shown.centre,
    width: (event.picture.width * shown.width) / planned.width,
    height: (event.picture.height * shown.height) / planned.height,
    rotation: shown.rotation,
    opacity: shown.opacity,
  };
  return { ...event, picture, bounds: shown.bounds };
}
