// .scratch/text-advanced/issues/05-text-layer-transform-on-stage.md: a Text Layer on the stage is a
// picture as an Overlay is (docs/adr/0007, 0010): its Grips are on its area (its words and plate,
// not the room its picture keeps round them for its ink), scaled and turned by its Transform. Its
// corners scale it and the handle above turns it; it has no edges to stretch it.
import type { Picture, TextEvent } from "../../../api";
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
