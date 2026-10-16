// Seam H (.scratch/transform-crop/spec.md): Crop mode's handles and its commit, as worked examples
// of a Transform and Crop in and the Crop and Transform out.
import { describe, expect, test } from "vitest";
import type { Transform } from "../../../api";
import { cropCommitted, cropDragged, croppedSize, keptPart, NO_CROP, tidyCrop, wholePicture, type Crop, type CropEntry } from "./cropGestures";
import { fittedSize } from "./picture";
import { boundsOf, cornersOf, placed } from "./pictureGestures";

const FRAME = { width: 1080, height: 1920 };
// A 1920×1080 video: 1080×607.5 fitted.
const ITEM = { width: 1920, height: 1080 };

function transform(changes: Partial<Transform> = {}): Transform {
  return { x: 540, y: 960, scale: 1, stretch_x: 1, stretch_y: 1, rotation: 0, flip_h: false, flip_v: false, opacity: 1, ...changes };
}

const crop = (changes: Partial<Crop> = {}): Crop => ({ ...NO_CROP, ...changes });

// Crop mode opened on the video with `changes` to its Transform and the Crop `from`.
const entry = (changes: Partial<Transform> = {}, from: Crop = NO_CROP): CropEntry => ({
  transform: transform(changes),
  crop: from,
  item: ITEM,
  frame: FRAME,
});

// Where the picture `next` Transform and Crop draw is on the frame.
const drawn = (next: Transform, kept: Crop) => placed(next, fittedSize(croppedSize(ITEM, kept), FRAME));

// Rounded to a thousandth, so cos 90° is 0.
const tidy = <T extends object>(value: T): T =>
  JSON.parse(JSON.stringify(value, (_, v) => (typeof v === "number" ? Math.round(v * 1000) / 1000 + 0 : v)));

describe("the Crop", () => {
  test("each edge is held to 0..0.9, and a pair that would leave less than a tenth is pulled back", () => {
    expect(tidyCrop({ left: -0.2, top: 1.2, right: 0.1, bottom: 0 })).toEqual({ left: 0, top: 0.9, right: 0.1, bottom: 0 });
    const tidied = tidyCrop({ left: 0.6, top: 0.5, right: 0.6, bottom: 0.2 });
    expect(tidied.left).toBe(0.6);
    expect(tidied.right).toBeCloseTo(0.3);
    expect(tidied.top + tidied.bottom).toBeLessThanOrEqual(0.9);
  });

  test("it is taken first: the cropped size is what is fitted", () => {
    expect(croppedSize({ width: 1000, height: 1000 }, crop({ left: 0.25 }))).toEqual({ width: 750, height: 1000 });
    expect(croppedSize(ITEM, crop({ top: 0.5 }))).toEqual({ width: 1920, height: 540 });
  });
});

describe("Crop mode shows the whole picture in place, the kept part bright", () => {
  test("uncropped, the whole picture is the picture", () => {
    expect(wholePicture(entry({ scale: 0.5 }))).toEqual({ x: 540, y: 960, width: 540, height: 303.75, rotation: 0 });
  });

  test("cropped, the whole picture reaches past the kept part on the side cut off", () => {
    // The right 3/4 kept at scale 0.75: 810 px of a 1080 px picture, 270..1080 across.
    const cropped = entry({ x: 675, scale: 0.75 }, crop({ left: 0.25 }));
    expect(wholePicture(cropped)).toEqual({ x: 540, y: 960, width: 1080, height: 607.5, rotation: 0 });
    expect(keptPart(cropped, crop({ left: 0.25 }))).toEqual({ x: 675, y: 960, width: 810, height: 607.5, rotation: 0 });
  });

  test("on a picture flipped across, the left cut is on its right", () => {
    expect(keptPart(entry({ flip_h: true }), crop({ left: 0.25 }))).toMatchObject({ x: 405, width: 810 });
  });
});

describe("the crop handles", () => {
  test("an edge handle moves its edge to the pointer, as a fraction of the whole picture", () => {
    const next = cropDragged(entry(), NO_CROP, "left", { x: 0, y: 960 }, { x: 270, y: 1000 });
    expect(next).toEqual(crop({ left: 0.25 }));
    expect(cropDragged(entry(), NO_CROP, "bottom", { x: 540, y: 1263.75 }, { x: 540, y: 1111.875 })).toMatchObject({ bottom: 0.25 });
  });

  test("a corner handle moves both its edges", () => {
    const next = cropDragged(entry(), NO_CROP, "bottom-right", { x: 1080, y: 1263.75 }, { x: 810, y: 1111.875 });
    expect(next).toEqual(crop({ right: 0.25, bottom: 0.25 }));
  });

  test("on a picture rotated 90° they work in its own axes", () => {
    // Its own left is at the top of the frame: down the frame is into the picture.
    const turned = entry({ rotation: 90 });
    expect(cropDragged(turned, NO_CROP, "left", { x: 540, y: 420 }, { x: 540, y: 690 })).toEqual(crop({ left: 0.25 }));
    expect(cropDragged(turned, NO_CROP, "left", { x: 540, y: 420 }, { x: 300, y: 420 })).toEqual(NO_CROP);
  });

  test("on a picture flipped across, the handle on its left moves the cut off the item's right", () => {
    expect(cropDragged(entry({ flip_h: true }), NO_CROP, "left", { x: 0, y: 960 }, { x: 270, y: 960 })).toEqual(crop({ right: 0.25 }));
  });

  test("a handle goes back out from a crop already made, and no further than the edge", () => {
    const cropped = entry({ x: 675, scale: 0.75 }, crop({ left: 0.25 }));
    expect(cropDragged(cropped, crop({ left: 0.25 }), "left", { x: 270, y: 960 }, { x: 135, y: 960 })).toEqual(crop({ left: 0.125 }));
    expect(cropDragged(cropped, crop({ left: 0.25 }), "left", { x: 270, y: 960 }, { x: -500, y: 960 })).toEqual(NO_CROP);
  });

  test("the tenth is kept: a handle stops a tenth short of the opposite edge", () => {
    const next = cropDragged(entry(), crop({ right: 0.3 }), "left", { x: 0, y: 960 }, { x: 1080, y: 960 });
    expect(next.left).toBeCloseTo(0.6);
    expect(next.right).toBe(0.3);
  });
});

describe("the commit keeps the kept part where it was", () => {
  test("cropping the left 0.25 at scale 1: the kept part covers the same frame pixels", () => {
    // Before, the picture covered 0..1080 across and 656.25..1263.75 down; its right 3/4 is 270..1080.
    const next = cropCommitted(entry(), crop({ left: 0.25 }));
    expect(next).toEqual(transform({ x: 675, scale: 0.75 }));
    expect(boundsOf(drawn(next, crop({ left: 0.25 })))).toEqual({ x: 270, y: 656.25, width: 810, height: 607.5 });
  });

  test("the same on a picture rotated 90°: the centre moves along its own axis", () => {
    // Before, it covered 236.25..843.75 across and 420..1500 down; its own left is at the top.
    const next = cropCommitted(entry({ rotation: 90 }), crop({ left: 0.25 }));
    expect(tidy(next)).toEqual(transform({ y: 1095, scale: 0.75, rotation: 90 }));
    expect(tidy(boundsOf(drawn(next, crop({ left: 0.25 }))))).toEqual({ x: 236.25, y: 690, width: 607.5, height: 810 });
  });

  test("taking the crop off again gives the picture back", () => {
    const cropped = entry({ x: 675, scale: 0.75 }, crop({ left: 0.25 }));
    expect(cropCommitted(cropped, NO_CROP)).toEqual(transform());
  });

  test("a crop past the tenth is tidied first", () => {
    expect(cropCommitted(entry(), crop({ left: 0.95 }))).toEqual(cropCommitted(entry(), crop({ left: 0.9 })));
  });

  test("turned, flipped and stretched, the kept part's corners stay put and the stretch is kept", () => {
    const from = crop({ top: 0.1, right: 0.2 });
    const changes = { x: 300, y: 700, scale: 0.6, stretch_x: 1.5, stretch_y: 0.8, rotation: 30, flip_h: true, flip_v: true };
    const opened = entry(changes, from);
    const next = crop({ left: 0.3, top: 0.2, right: 0.1, bottom: 0.15 });
    const committed = cropCommitted(opened, next);
    expect(committed).toMatchObject({ stretch_x: 1.5, stretch_y: 0.8, rotation: 30, flip_h: true, flip_v: true });
    expect(tidy(cornersOf(drawn(committed, next)))).toEqual(tidy(cornersOf(keptPart(opened, next))));
  });
});
