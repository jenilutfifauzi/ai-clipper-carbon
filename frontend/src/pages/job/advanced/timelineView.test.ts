// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, as worked
// examples of numbers in and out.
import { describe, expect, test } from "vitest";
import { canvasWindow, chunksOf, filmstripTiles, tileWidth } from "./timelineView";

describe("the Filmstrip", () => {
  test("a media Segment needs the chunks of its range of the video", () => {
    // Showing 25 s to 62 s of its video.
    expect(chunksOf(25, 62)).toEqual([0, 30, 60]);
    expect(chunksOf(30, 59)).toEqual([30]);
    expect(chunksOf(0, 0)).toEqual([0]);
  });

  test("a tile is as wide as a frame at the row's height", () => {
    // A 16:9 frame is 200 px wide at 112 px (199.1, rounded to even): 85.7 px at 48 px.
    expect(tileWidth(48, 1920, 1080)).toBeCloseTo((200 * 48) / 112);
    // 4:3 is 150 px wide at 112 px (149.3).
    expect(tileWidth(112, 320, 240)).toBe(150);
  });

  // An item 300 px wide showing its video from 10 s, of a 90 s video, in tiles 80 px wide.
  const item = { width: 300, mediaStart: 10, frames: 90, tile: 80 };
  const all = { left: 0, right: 300 };

  test("at 1×, each tile shows the frame under its middle", () => {
    // 5 px a second: a tile is 16 s.
    expect(filmstripTiles({ ...item, pps: 5, view: all, span: all })).toEqual([
      { left: 0, width: 80, frame: 18 },
      { left: 80, width: 80, frame: 34 },
      { left: 160, width: 80, frame: 50 },
      // Cut short by the item's end: the middle of what is left, 54 s in.
      { left: 240, width: 80, frame: 64 },
    ]);
  });

  test("at 40×, neighbouring tiles show the same frame", () => {
    // 200 px a second: a tile is 0.4 s, from 12.2 s.
    const tiles = filmstripTiles({ ...item, width: 320, mediaStart: 12.2, pps: 200, view: { left: 0, right: 320 }, span: { left: 0, right: 320 } });
    expect(tiles.map((tile) => tile.frame)).toEqual([12, 13, 13, 14]);
  });

  test("a tile half off-screen shows the frame under the middle of its visible part", () => {
    // The first 40 px are scrolled off: the first tile's visible part is 40 to 80 px, its middle 60.
    const tiles = filmstripTiles({ ...item, pps: 5, view: { left: 40, right: 300 }, span: all });
    expect(tiles[0]).toEqual({ left: 0, width: 80, frame: 22 });
    expect(tiles[1].frame).toBe(34);
  });

  test("only the tiles across the stretch drawn are given, and frames stay in the video", () => {
    expect(filmstripTiles({ ...item, pps: 5, view: all, span: { left: 100, right: 170 } }).map((tile) => tile.left)).toEqual([80, 160]);
    // 20.6 s of video has frames 0 to 20; 20.5 s rounds to 21, past the last.
    expect(filmstripTiles({ width: 20, mediaStart: 20.4, frames: 21, tile: 80, pps: 100, view: all, span: all })).toEqual([
      { left: 0, width: 80, frame: 20 },
    ]);
  });
});

describe("an item's canvas", () => {
  // A viewport 400 px wide, scrolled to 1000 px.
  const view = { left: 1000, right: 1400 };

  test("covers the item's visible part and half a viewport each side", () => {
    // From 800 to 1600 px: 300 to 1100 px into an item from 500 px.
    expect(canvasWindow({ left: 500, width: 2000 }, view, 2)).toEqual({ left: 300, right: 1100 });
    // An item ending on screen: up to its end.
    expect(canvasWindow({ left: 1100, width: 100 }, view, 2)).toEqual({ left: 0, right: 100 });
  });

  test("draws nothing for an item wholly outside the margin", () => {
    expect(canvasWindow({ left: 1700, width: 100 }, view, 2)).toBeNull();
    expect(canvasWindow({ left: 0, width: 700 }, view, 2)).toBeNull();
  });

  test("is at most 4096 device pixels wide, about the visible part", () => {
    // A 4000 px viewport at 2×: the margin is 8000 px wide, the cap 2048 CSS px about its middle.
    expect(canvasWindow({ left: 0, width: 20000 }, { left: 5000, right: 9000 }, 2)).toEqual({ left: 5976, right: 8024 });
    // Kept inside the item when its visible part is at an end: 1024 CSS px at 4×.
    expect(canvasWindow({ left: 0, width: 20000 }, { left: 0, right: 1000 }, 4)).toEqual({ left: 0, right: 1024 });
  });
});
