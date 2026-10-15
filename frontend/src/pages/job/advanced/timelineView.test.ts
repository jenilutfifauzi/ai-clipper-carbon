// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, as worked
// examples of numbers and edits in and the view out.
import { describe, expect, test } from "vitest";
import type { ClipSegment, MusicClip, TextLayer } from "../../../api";
import { playedFrom } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import {
  canvasWindow,
  chunksAcross,
  chunksOf,
  filmstripTiles,
  gainAt,
  peaksExtremes,
  peaksLevel,
  peaksPyramid,
  tileWidth,
  volumeHeight,
  volumeOfHeight,
  zoomToFit,
  type Peaks,
} from "./timelineView";

describe("zoom to fit", () => {
  // A Clip of 110 s on a Timeline 1100 px wide: 10 px a second at 1×. Segments of 30, 20 and 60 s
  // played back to back (0–30, 30–50, 50–110), a Text Layer from 60 to 70 s, one from 55 to 55.5 s,
  // a Music Clip from 40 to 50 s and the hook from 2 to 5 s.
  const text = (id: string, start: number, secs: number) => ({ id, start, secs }) as TextLayer;
  const song = (id: string, start: number, secs: number) => ({ id, start, secs }) as MusicClip;
  const segment = (id: string, start: number, end: number): ClipSegment => ({ id, start, end });
  const edits = {
    hook_start: 2,
    hook_secs: 3,
    segments: [segment("s1", 100, 130), segment("s2", 200, 220), segment("s3", 300, 360)],
    text_layers: [text("t1", 60, 10), text("t2", 55, 0.5)],
    music: [song("m1", 40, 10)],
    overlays: [],
  } as unknown as AdvancedEdits;
  const fitted = (pick: Pick, zoom = 1) =>
    zoomToFit({ pick, edits, played: playedFrom(edits.segments), duration: 110 }, { width: 1100, zoom });

  test("one picked item fills the Timeline with a 5% margin each side", () => {
    // 40–50 s with its margins is 39.5–50.5 s: 11 s across 1100 px is 100 px a second, 10×.
    const view = fitted(picked({ kind: "music", id: "m1" }));
    expect(view.zoom).toBeCloseTo(10);
    expect(view.scroll).toBeCloseTo(3950);
  });

  test("several picked items fit together, from the first one's start to the last one's end", () => {
    // Segment 2 plays 30–50 s, the Text Layer is at 60–70 s: 30–70 s, 44 s with its margins, 2.5×.
    const view = fitted(picked({ kind: "text", id: "t1" }, { kind: "segment", id: "s2" }));
    expect(view.zoom).toBeCloseTo(2.5);
    expect(view.scroll).toBeCloseTo(700);
  });

  test("nothing picked is the whole Clip from its start", () => {
    expect(fitted(null, 7)).toEqual({ zoom: 1, scroll: 0 });
  });

  test("a Pick too short to fill the Timeline is centred at 40×", () => {
    // 55–55.5 s would be 200×: at 40× (400 px a second) its middle, 55.25 s, is 22100 px in.
    const view = fitted(picked({ kind: "text", id: "t2" }));
    expect(view.zoom).toBe(40);
    expect(view.scroll).toBeCloseTo(22100 - 550);
  });

  test("a picked join is centred at the current zoom", () => {
    // The join after Segment 1 is at 30 s: at 3×, 30 px a second, 900 px in.
    expect(fitted({ kind: "join", after: "s1" }, 3)).toEqual({ zoom: 3, scroll: 900 - 550 });
  });

  test("the hook fits its span, and the captions the whole Clip", () => {
    // The hook's 2–5 s is 1.85–5.15 s with its margins: 3.3 s across 1100 px, 333⅓ px a second.
    const hook = fitted({ kind: "hook" });
    expect(hook.zoom).toBeCloseTo(110 / 3.3);
    expect(hook.scroll).toBeCloseTo(1.85 * (1100 / 3.3));
    expect(fitted({ kind: "captions" }, 5)).toEqual({ zoom: 1, scroll: 0 });
  });

  test("the view never scrolls past the Clip's ends", () => {
    // The join after Segment 1, at 30 s, centred at 1× would start 25 s before the Clip.
    expect(fitted({ kind: "join", after: "s1" })).toEqual({ zoom: 1, scroll: 0 });
    // Segment 3 plays 50–110 s: 66 s with its margins, 110 / 66×, which would centre 80 s.
    const view = fitted(picked({ kind: "segment", id: "s3" }));
    expect(view.zoom).toBeCloseTo(110 / 66);
    expect(view.scroll).toBeCloseTo(110 * 1100 / 66 - 1100);
  });
});

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

describe("a Source Segment's Filmstrip", () => {
  // A Source Segment from 28 s to 95 s of an hour-long Source, played after one of 10 s.
  const shown = playedFrom([
    { start: 300, end: 310 },
    { start: 28, end: 95 },
  ])[1];

  test("needs the chunks of its range of the Source", () => {
    expect(chunksOf(shown.source_start, shown.source_end)).toEqual([0, 30, 60, 90]);
  });

  test("shows the Source's frames, not the Timeline's time", () => {
    // 5 px a second, from 50 px on the Timeline: 335 px wide, in tiles of 80 px (16 s).
    const width = (shown.end - shown.start) * 5;
    const all = { left: 0, right: width };
    const tiles = filmstripTiles({ width, mediaStart: shown.source_start, frames: 3600, tile: 80, pps: 5, view: all, span: all });
    // The middles of the tiles, 8 s, 24 s, 40 s and 56 s in, and of the last 15 px, 65.5 s in.
    expect(tiles.map((tile) => tile.frame)).toEqual([36, 52, 68, 84, 94]);
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

describe("the Waveform", () => {
  test("a Music Clip needs the chunks of the part of its song it plays", () => {
    // From 25 s into a 100 s song, 400 px long at 10 px a second: 25 to 65 s of it.
    const clip = { mediaStart: 25, pps: 10, width: 400, duration: 100 };
    expect(chunksAcross({ ...clip, span: { left: 0, right: 400 } })).toEqual([0, 30, 60]);
    // A canvas over its second half, and past its end: 45 to 65 s.
    expect(chunksAcross({ ...clip, span: { left: 200, right: 900 } })).toEqual([30, 60]);
    // Ending on a chunk's start doesn't need that chunk: 35 to 60 s.
    expect(chunksAcross({ ...clip, mediaStart: 35, width: 250, span: { left: 0, right: 250 } })).toEqual([30]);
    // Nothing past the song's end: 50 to 60 s of a 60 s song.
    expect(chunksAcross({ ...clip, mediaStart: 50, duration: 60, span: { left: 0, right: 400 } })).toEqual([30]);
  });

  // A chunk's Peaks, `count` buckets at 1000 a second, silent but for what `set` puts in.
  const chunk = (count: number, set: (peaks: Peaks) => void = () => {}): Peaks => {
    const peaks = { perSecond: 1000, min: new Int8Array(count), max: new Int8Array(count) };
    set(peaks);
    return peaks;
  };

  test("the pyramid halves the Peaks down to 64 buckets or fewer, keeping their extremes", () => {
    const pyramid = peaksPyramid(
      chunk(130, (peaks) => {
        peaks.min[3] = -50;
        // In the trailing bucket, which a halving still counts.
        peaks.max[129] = 100;
      }),
    );
    expect(pyramid.map((level) => [level.min.length, level.perSecond])).toEqual([[130, 1000], [65, 500], [33, 250]]);
    expect([pyramid[1].min[1], pyramid[2].min[0]]).toEqual([-50, -50]);
    expect([pyramid[1].max[64], pyramid[2].max[32]]).toEqual([100, 100]);
    // A whole chunk, 30 s: ten levels, to 59 buckets, about 2 a second.
    expect(peaksPyramid(chunk(30000)).map((level) => level.min.length)).toEqual([30000, 15000, 7500, 3750, 1875, 938, 469, 235, 118, 59]);
  });

  test("the level for a zoom is the coarsest with a bucket for each device pixel", () => {
    // Its levels have 1000, 500, 250, 125, 62.5, 31.25, 15.6, 7.8, 3.9 and 2 buckets a second.
    const pyramid = peaksPyramid(chunk(30000));
    // A 60 s Clip at 1× on a phone 360 px wide at 3 device pixels to a pixel: 6 px a second, 18
    // device pixels. 31.25 buckets a second is the coarsest with one for each.
    expect(peaksLevel(pyramid, 6, 3).perSecond).toBe(31.25);
    // At 1× on a desktop 1200 px wide at 2×: 40 device pixels a second.
    expect(peaksLevel(pyramid, 20, 2).perSecond).toBe(62.5);
    // At 40× there: 1600 device pixels a second, more than the finest has; it is the finest.
    expect(peaksLevel(pyramid, 800, 2).perSecond).toBe(1000);
    // Never fewer buckets than columns while a finer level has them.
    for (const pps of [1, 7, 33, 100, 499]) expect(peaksLevel(pyramid, pps, 1).perSecond).toBeGreaterThanOrEqual(pps);
  });

  test("a column reads the extremes of the buckets that begin in it", () => {
    // 10 buckets a second.
    const peaks = { perSecond: 10, min: Int8Array.from([-127, -64, 0, -32, 0]), max: Int8Array.from([127, 64, 32, 0, 0]) };
    expect(peaksExtremes(peaks, 0.1, 0.3)).toEqual([-64 / 127, 64 / 127]);
    // Narrower than a bucket: the bucket it is in.
    expect(peaksExtremes(peaks, 0.12, 0.13)).toEqual([-64 / 127, 64 / 127]);
    // Past the end is silence.
    expect(peaksExtremes(peaks, 0.6, 0.7)).toEqual([0, 0]);
  });

  test("the gain is the volume through the fades' linear ramps", () => {
    // 10 s at 150%, fading in over 4 s and out over 2 s.
    const clip = { volume: 1.5, secs: 10, fade_in: 4, fade_out: 2 };
    expect(gainAt(2, clip)).toBeCloseTo(0.75);
    expect(gainAt(0, clip)).toBe(0);
    expect(gainAt(10, clip)).toBe(0);
    expect(gainAt(5, clip)).toBe(1.5);
    expect(gainAt(9.5, clip)).toBeCloseTo(0.375);
    // Without fades, the volume all along.
    expect(gainAt(0, { volume: 0.8, secs: 10, fade_in: 0, fade_out: 0 })).toBe(0.8);
  });

  test("fades that meet peak where they meet", () => {
    // 4 s fading in over 3 s and out over 1 s.
    const clip = { volume: 1, secs: 4, fade_in: 3, fade_out: 1 };
    expect(gainAt(3, clip)).toBe(1);
    expect(gainAt(1.5, clip)).toBeCloseTo(0.5);
    expect(gainAt(3.5, clip)).toBeCloseTo(0.5);
  });
});

describe("the Volume Line", () => {
  test("silence is at the bottom, 100% at two thirds of the height and 200% at the top", () => {
    expect(volumeOfHeight(0)).toBe(0);
    expect(volumeOfHeight(2 / 3)).toBe(1);
    expect(volumeOfHeight(1)).toBe(2);
    expect(volumeHeight(0)).toBe(0);
    expect(volumeHeight(1)).toBeCloseTo(2 / 3);
    expect(volumeHeight(2)).toBe(1);
  });

  test("the quiet range has room: halfway up is 61%, rounded to a hundredth", () => {
    // 2 · 0.5^1.7095 = 0.6115.
    expect(volumeOfHeight(0.5)).toBe(0.61);
    // 150% is at 0.845 of the height: (0.75)^(1/1.7095).
    expect(volumeHeight(1.5)).toBeCloseTo(0.845, 3);
  });

  test("past either end, the line stops there", () => {
    expect(volumeOfHeight(-0.2)).toBe(0);
    expect(volumeOfHeight(1.3)).toBe(2);
    expect(volumeHeight(3)).toBe(1);
  });

  test("a volume's height gives the volume back", () => {
    for (const volume of [0, 0.05, 0.25, 0.61, 1, 1.37, 1.99, 2]) expect(volumeOfHeight(volumeHeight(volume))).toBe(volume);
  });
});
