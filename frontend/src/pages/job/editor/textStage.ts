// .scratch/text-advanced/issues/05-text-layer-transform-on-stage.md: a Text Layer on the stage is a
// picture as an Overlay is (docs/adr/0007, 0010): its Grips are on its area (its words and plate,
// not the room its picture keeps round them for its ink), scaled and turned by its Transform. Its
// corners scale it and the handle above turns it; it has no edges to stretch it. 12: a keyed one is
// gripped where its Keyframes have it at the playhead (docs/adr/0008).
import type { Picture, RenderPlan, TextEvent } from "../../../api";
import { isKeyed, pictureAt } from "./picture";
import type { Size } from "./pictureGestures";

/**
 * A Text Layer's area as a picture of the stage: its size at scale 1 (`fitted`, what its Grips scale),
 * and the Picture of it drawn by its Transform, about its picture's centre, turned with its bounds.
 */
export function textStagePicture(event: TextEvent): { picture: Picture; fitted: Size } {
  const { area, picture, bounds } = event;
  const { scale } = event.layer.transform;
  return {
    fitted: { width: area.width, height: area.height },
    picture: { ...picture, width: area.width * scale, height: area.height * scale, bounds },
  };
}

/**
 * The event of a Text Layer as its Keyframes have it at `time` seconds into the Clip: its picture
 * sampled there (pictureAt) and still, its Transform's centre, scale, rotation and opacity as sampled,
 * and its bounds its area's then, turned and scaled about the sampled centre. Unkeyed, the event itself.
 */
export function textEventAt(event: TextEvent, time: number): TextEvent {
  const { picture, area, layer } = event;
  if (!isKeyed(picture)) return event;
  const drawn = pictureAt(picture, time);
  const scale = picture.motion?.scale?.length && picture.unscaled ? drawn.width / picture.unscaled[0] : layer.transform.scale;
  const [x, y] = drawn.centre;
  const angle = (drawn.rotation * Math.PI) / 180;
  const [cos, sin] = [Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle))];
  const [width, height] = [area.width * scale, area.height * scale];
  const [across, down] = [width * cos + height * sin, width * sin + height * cos];
  const bounds = { x: Math.floor(x - across / 2), y: Math.floor(y - down / 2), width: Math.ceil(across), height: Math.ceil(down) };
  const transform = { ...layer.transform, x, y, scale, rotation: drawn.rotation, opacity: drawn.opacity };
  return { ...event, layer: { ...layer, transform }, picture: drawn, bounds };
}

/** The plan's Text Layers as they are at `time` (`textEventAt`). */
export const textsAt = (plan: RenderPlan, time: number): TextEvent[] => plan.texts.map((event) => textEventAt(event, time));

/**
 * The event of a Text Layer whose area (`planned`, its `textStagePicture`) the stage draws as `shown`
 * while a gesture holds it: its picture, the same file, placed, scaled, turned and faded with it.
 */
export function heldTextEvent(event: TextEvent, planned: Picture, shown: Picture): TextEvent {
  if (shown === planned) return event;
  const by = shown.width / planned.width;
  const picture = {
    ...event.picture,
    centre: shown.centre,
    width: event.picture.width * by,
    height: event.picture.height * by,
    rotation: shown.rotation,
    opacity: shown.opacity,
  };
  return { ...event, picture, bounds: shown.bounds };
}
