// .scratch/timeline-compact/spec.md: the Timeline draws only the Tracks with something on them, the
// Video Track always; an empty Track shows as a row to drop on while something it takes is dragged.
import { describe, expect, test } from "vitest";
import { assetDragTypes, DRAG_EFFECT, DRAG_LOOK, DRAG_MEDIA, DRAG_MEDIA_PICTURE, DRAG_MEDIA_SOUND, DRAG_SHAPE, DRAG_TEXT, DRAG_TRANSITION } from "./drag";
import { captionsShown, rowLanes, takesDrag } from "./timelineRows";

const item = (id: string, start: number, secs: number) => ({ id, start, secs });

describe("a layer Track's rows", () => {
  test("an empty Track draws no row", () => {
    expect(rowLanes([], "text", true, null)).toEqual([]);
    expect(rowLanes([], "music", false, null)).toEqual([]);
  });

  test("a Track with items draws a row per lane", () => {
    const lanes = rowLanes([item("a", 0, 2), item("b", 1, 2), item("c", 3, 1)], "shape", false, null);
    expect(lanes.map((lane) => lane.map(({ id }) => id))).toEqual([["a", "c"], ["b"]]);
  });

  test("above the Video Track, the first lane is drawn last, next to it", () => {
    const lanes = rowLanes([item("a", 0, 2), item("b", 1, 2)], "text", true, null);
    expect(lanes.map((lane) => lane.map(({ id }) => id))).toEqual([["b"], ["a"]]);
  });

  test("an empty Track shows one empty row while something it takes is dragged", () => {
    expect(rowLanes([], "text", true, [DRAG_TEXT])).toEqual([[]]);
    expect(rowLanes([], "shape", true, [DRAG_SHAPE])).toEqual([[]]);
    expect(rowLanes([], "adjust", true, [DRAG_LOOK])).toEqual([[]]);
    expect(rowLanes([], "adjust", true, [DRAG_EFFECT])).toEqual([[]]);
  });

  test("but not while something it doesn't take is dragged", () => {
    expect(rowLanes([], "text", true, [DRAG_SHAPE])).toEqual([]);
    expect(rowLanes([], "music", false, [DRAG_TEXT])).toEqual([]);
    expect(rowLanes([], "overlay", true, [DRAG_TRANSITION])).toEqual([]);
  });

  test("a Track with items gets no extra row while dragging", () => {
    expect(rowLanes([item("a", 0, 2)], "text", true, [DRAG_TEXT])).toHaveLength(1);
  });
});

describe("a Media Library item dragged", () => {
  test("a video with sound shows the Overlay, Behind and Music Tracks", () => {
    const dragging = [DRAG_MEDIA, DRAG_MEDIA_PICTURE, DRAG_MEDIA_SOUND];
    expect(takesDrag("overlay", dragging)).toBe(true);
    expect(takesDrag("behind", dragging)).toBe(true);
    expect(takesDrag("music", dragging)).toBe(true);
    expect(takesDrag("text", dragging)).toBe(false);
  });

  test("a song shows the Music Track alone", () => {
    const dragging = [DRAG_MEDIA, DRAG_MEDIA_SOUND];
    expect(takesDrag("overlay", dragging)).toBe(false);
    expect(takesDrag("behind", dragging)).toBe(false);
    expect(takesDrag("music", dragging)).toBe(true);
  });

  test("an image, or a video without sound, shows no Music Track", () => {
    const dragging = [DRAG_MEDIA, DRAG_MEDIA_PICTURE];
    expect(takesDrag("overlay", dragging)).toBe(true);
    expect(takesDrag("music", dragging)).toBe(false);
  });

  test("an item without its kind said shows every Track that takes media", () => {
    expect(takesDrag("overlay", [DRAG_MEDIA])).toBe(true);
    expect(takesDrag("behind", [DRAG_MEDIA])).toBe(true);
    expect(takesDrag("music", [DRAG_MEDIA])).toBe(true);
  });
});

describe("what is dragged", () => {
  test("is the asset panel's types alone, or nothing", () => {
    expect(assetDragTypes(["Files"])).toBeNull();
    expect(assetDragTypes([])).toBeNull();
    expect(assetDragTypes(["text/plain", DRAG_TEXT])).toEqual([DRAG_TEXT]);
    expect(assetDragTypes([DRAG_MEDIA, DRAG_MEDIA_SOUND])).toEqual([DRAG_MEDIA, DRAG_MEDIA_SOUND]);
  });
});

describe("the Captions Track", () => {
  test("shows while it has captions or captions on their way", () => {
    expect(captionsShown({ planned: true, cues: 3, pending: 0, captioned: true })).toBe(true);
    expect(captionsShown({ planned: true, cues: 0, pending: 1, captioned: true })).toBe(true);
  });

  test("is not drawn without any, captions off for the Job or not", () => {
    expect(captionsShown({ planned: true, cues: 0, pending: 0, captioned: true })).toBe(false);
    expect(captionsShown({ planned: true, cues: 0, pending: 0, captioned: false })).toBe(false);
  });

  test("before the plan, it shows if the Job is captioned, so that it doesn't jump in", () => {
    expect(captionsShown({ planned: false, cues: 0, pending: 0, captioned: true })).toBe(true);
    expect(captionsShown({ planned: false, cues: 0, pending: 0, captioned: false })).toBe(false);
  });
});
