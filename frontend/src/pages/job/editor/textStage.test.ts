// .scratch/text-advanced/issues/05-text-layer-transform-on-stage.md: a Text Layer's Grips on the
// stage scale and turn it by its Transform, as an Overlay's do, and while one holds it the preview
// draws the picture it has, placed, scaled and turned with it.
import { describe, expect, test } from "vitest";
import { textPictureUrl, type Picture, type TextEvent, type Transform } from "../../../api";
import { IDENTITY } from "./picture";
import { fingersHeld, fingerMoved, fingersOn, gripsOf, placed } from "./pictureGestures";
import { heldPicture } from "./stagePicture";
import { snapScaled } from "./smartGuides";
import { wantedPicture } from "./textPicture";
import { heldTextEvent, textEventAt, textStagePicture } from "./textStage";
import { LINEAR } from "./keyframes";

const FRAME = { width: 1080, height: 1920 };

// A 300×100 area centred on (540, 600) at `transform`'s scale, its picture 100 px larger each way
// for its ink, made at scale 1.
function event(transform: Partial<Transform> = {}): TextEvent {
  const placedBy = { ...IDENTITY, x: 540, y: 600, ...transform };
  const { scale } = placedBy;
  const picture: Picture = {
    crop: { x: 0, y: 0, width: 400, height: 200 },
    item_size: [400, 200],
    width: 400 * scale,
    height: 200 * scale,
    centre: [540, 600],
    rotation: placedBy.rotation,
    flip_h: false,
    flip_v: false,
    opacity: placedBy.opacity,
    bounds: { x: 540 - 150 * scale, y: 600 - 50 * scale, width: 300 * scale, height: 100 * scale },
    radius: 0,
    border: null,
    shadow: null,
  };
  return {
    layer: { id: "t1", text: "Halo", start: 0, secs: 2, transform: placedBy } as TextEvent["layer"],
    lines: ["Halo"],
    start: 0,
    end: 2,
    area: { x: 390, y: 550, width: 300, height: 100 },
    size: 80,
    anchors: [[540, 620]],
    image: "abc.png",
    look: "abc",
    picture,
    bounds: picture.bounds,
    box: null,
    radius: 0,
  };
}

describe("a Text Layer on the stage", () => {
  test("is gripped by its area, scaled by its Transform about its picture's centre", () => {
    const { picture, fitted } = textStagePicture(event({ scale: 2 }));
    expect(fitted).toEqual({ width: 300, height: 100 });
    expect(picture).toMatchObject({ centre: [540, 600], width: 600, height: 200 });
    // Its corner Grips are the area's corners, twice as far out.
    expect(gripsOf({ x: 540, y: 600, width: picture.width, height: picture.height, rotation: 0 }, 0)["bottom-right"]).toEqual({ x: 840, y: 700 });
  });

  test("a corner dragged out scales it about its centre, its words and size as they were", () => {
    const planned = event();
    const { picture, fitted } = textStagePicture(planned);
    const grab = { transform: planned.layer.transform, fitted, frame: FRAME };
    // The bottom-right corner (690, 650) dragged twice as far from the centre.
    const fingers = fingerMoved(fingersOn(grab, "bottom-right", 1, { x: 690, y: 650 }), 1, { x: 840, y: 700 });
    const scaled = fingersHeld(fingers, {});
    expect(scaled).toEqual({ ...planned.layer.transform, scale: 2 });
    // Drawn from the gesture until the plan comes: the same picture, twice as large.
    const held = heldTextEvent(planned, picture, heldPicture(picture, scaled, FRAME, fitted));
    expect(held.image).toBe(planned.image);
    expect(wantedPicture("j", held).url).toBe(textPictureUrl("j", "abc.png"));
    expect(held.picture).toMatchObject({ centre: [540, 600], width: 800, height: 400, rotation: 0 });
    expect(held.bounds).toEqual({ x: 240, y: 500, width: 600, height: 200 });
  });

  test("the rotate handle turns it about its centre", () => {
    const planned = event();
    const { picture, fitted } = textStagePicture(planned);
    const grab = { transform: planned.layer.transform, fitted, frame: FRAME };
    // From straight above its centre to straight right of it: a quarter turn clockwise.
    const fingers = fingerMoved(fingersOn(grab, "rotate", 1, { x: 540, y: 500 }), 1, { x: 640, y: 600 });
    const turned = fingersHeld(fingers, {});
    expect(turned).toEqual({ ...planned.layer.transform, rotation: 90 });
    const held = heldTextEvent(planned, picture, heldPicture(picture, turned, FRAME, fitted));
    expect(held.picture).toMatchObject({ centre: [540, 600], width: 400, height: 200, rotation: 90 });
    expect(held.bounds.width).toBeCloseTo(100);
    expect(held.bounds.height).toBeCloseTo(300);
  });

  test("a corner snaps its area's edges to the Smart Guides", () => {
    const planned = event();
    const { fitted } = textStagePicture(planned);
    // At scale 2.73 its area's right edge is at 949.5, half a pixel short of the safe area's guide.
    const near = { ...planned.layer.transform, scale: 2.73 };
    const snapped = snapScaled(near, fitted, { x: [950], y: [] }, { unit: 1 });
    expect(placed(snapped.transform, fitted).width / 2 + 540).toBeCloseTo(950);
    expect(snapped.guides.x).toEqual([950]);
  });

  test("is drawn as planned while nothing holds it", () => {
    const planned = event({ scale: 1.5, rotation: 20 });
    const { picture } = textStagePicture(planned);
    expect(heldTextEvent(planned, picture, picture)).toBe(planned);
  });
});

// 12: Keyframes on Text Layers.
describe("a keyed Text Layer on the stage", () => {
  // Keyed from x 200 to 800, scale 1 to 2 and upright to a quarter turn over its 2 s.
  const keyed = (): TextEvent => {
    const planned = event();
    const motion = {
      x: [{ at: 0, value: 200, ease: LINEAR }, { at: 2, value: 800, ease: LINEAR }],
      scale: [{ at: 0, value: 1, ease: LINEAR }, { at: 2, value: 2, ease: LINEAR }],
      rotation: [{ at: 0, value: 0, ease: LINEAR }, { at: 2, value: 90, ease: LINEAR }],
    };
    return { ...planned, picture: { ...planned.picture, motion, unscaled: [400, 200] } };
  };

  test("is gripped where its Keyframes have it at the playhead: its area scaled and turned about its sampled centre", () => {
    const at = textEventAt(keyed(), 1);
    expect(at.layer.transform).toMatchObject({ x: 500, y: 600, scale: 1.5, rotation: 45 });
    const { picture, fitted } = textStagePicture(at);
    expect(fitted).toEqual({ width: 300, height: 100 });
    expect(picture).toMatchObject({ centre: [500, 600], width: 450, height: 150, rotation: 45 });
    const across = (450 + 150) * Math.SQRT1_2;
    expect(Math.abs(at.bounds.width - across)).toBeLessThanOrEqual(1);
    expect(Math.abs(at.bounds.x + at.bounds.width / 2 - 500)).toBeLessThanOrEqual(1);
    // Its picture as drawn then, still: what a gesture holds and moves.
    expect(at.picture).toMatchObject({ centre: [500, 600], width: 600, height: 300, rotation: 45, motion: {} });
  });

  test("a Grip held draws the same picture where the gesture puts it", () => {
    const at = textEventAt(keyed(), 2);
    const { picture, fitted } = textStagePicture(at);
    const moved = heldTextEvent(at, picture, heldPicture(picture, { ...at.layer.transform, x: 300 }, FRAME, fitted));
    expect(moved.picture).toMatchObject({ centre: [300, 600], width: 800, height: 400, rotation: 90 });
  });

  test("unkeyed, is as planned", () => {
    const planned = event({ scale: 2 });
    expect(textEventAt(planned, 1)).toBe(planned);
  });
});
