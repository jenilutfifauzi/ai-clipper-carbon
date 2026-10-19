// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, as worked
// examples of numbers and edits in and the view out.
import { describe, expect, test } from "vitest";
import type { ClipSegment, Keyframe, MusicClip, Overlay, TextLayer } from "../../../api";
import { EASE_IN, LINEAR } from "../editor/keyframes";
import { playedFrom } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import {
  canvasWindow,
  chunksAcross,
  chunksOf,
  edgesOf,
  editPoints,
  filmstripTiles,
  gainAt,
  keyMarks,
  nextEditPoint,
  segmentHeard,
  peaksExtremes,
  peaksLevel,
  peaksPyramid,
  previousEditPoint,
  sourceGain,
  tileWidth,
  seamDragged,
  volumeDragged,
  volumeHeight,
  volumeLine,
  volumeOfHeight,
  zoomAboutPlayhead,
  zoomToFit,
  type Peaks,
} from "./timelineView";
import type { TrackKind } from "./trackState";

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

describe("zoom about the playhead (.scratch/navigation-playback/spec.md)", () => {
  // A Clip of 110 s on a Timeline 1100 px wide: 10 px a second at 1×.
  const zoomed = (zoom: number, scroll: number, playhead: number, factor: number) =>
    zoomAboutPlayhead({ zoom, scroll, width: 1100, duration: 110, playhead, factor });

  test("the playhead in view keeps its place on screen", () => {
    // At 2× (20 px a second) scrolled 400 px, the playhead at 30 s is 600 px in: 200 px across the view.
    // At 3× it is 900 px in, so the view scrolls 700 px; at 4/3× it is 400 px in, so 200 px.
    expect(zoomed(2, 400, 30, 1.5)).toEqual({ zoom: 3, scroll: 700 });
    const out = zoomed(2, 400, 30, 1 / 1.5);
    expect(out.zoom).toBeCloseTo(4 / 3);
    expect(out.scroll).toBeCloseTo(200);
  });

  test("the playhead out of view is centred", () => {
    // At 2× scrolled 400 px (20–75 s), the playhead at 80 s is past the right edge: at 3× it is
    // 2400 px in, and centred the view scrolls 2400 − 550 px.
    expect(zoomed(2, 400, 80, 1.5)).toEqual({ zoom: 3, scroll: 1850 });
    // At 4× scrolled 2000 px (50–77.5 s), the playhead at 20 s is before the left edge: at 6× it is
    // 1200 px in.
    expect(zoomed(4, 2000, 20, 1.5)).toEqual({ zoom: 6, scroll: 650 });
  });

  test("the zoom stays between 1× and 40×", () => {
    // At 30× (300 px a second) scrolled 9000 px, the playhead at 31 s is 300 px across the view;
    // ×1.5 stops at 40×, 400 px a second, where 31 s is 12400 px in.
    expect(zoomed(30, 9000, 31, 1.5)).toEqual({ zoom: 40, scroll: 12100 });
    // At 1.2×, ÷1.5 stops at 1×, where the whole Clip fits and nothing scrolls.
    expect(zoomed(1.2, 100, 50, 1 / 1.5)).toEqual({ zoom: 1, scroll: 0 });
  });

  test("at 1× or 40× already, the view stays as it is", () => {
    expect(zoomed(40, 12100, 31, 1.5)).toEqual({ zoom: 40, scroll: 12100 });
    expect(zoomed(1, 0, 50, 1 / 1.5)).toEqual({ zoom: 1, scroll: 0 });
  });

  test("the view never scrolls past the Clip's ends", () => {
    // At 3× scrolled to the end (2200 px), the playhead at 100 s is 800 px across the view. At 2× it
    // would keep that place 1200 px in, but the Clip ends 1100 px in.
    expect(zoomed(3, 2200, 100, 1 / 1.5)).toEqual({ zoom: 2, scroll: 1100 });
    // At 2× scrolled 400 px, the playhead at 2 s is before the view: centred at 3× it would be at
    // −490 px.
    expect(zoomed(2, 400, 2, 1.5)).toEqual({ zoom: 3, scroll: 0 });
  });
});

describe("Edit Points (.scratch/navigation-playback/spec.md)", () => {
  // A Clip of 10 s: Segments of 4, 3 and 3 s played back to back (joins at 4 and 7 s), the hook
  // from 1 to 3 s, a Text Layer from 2 to 4 s (ending on the first join), a Music Clip from 0 to 7 s
  // (from the Clip's start to the second join), and an Overlay from 5.5 s that runs past the end.
  const text = (id: string, start: number, secs: number) => ({ id, start, secs }) as TextLayer;
  const song = (id: string, start: number, secs: number) => ({ id, start, secs }) as MusicClip;
  const overlay = (id: string, start: number, secs: number) => ({ id, start, secs }) as Overlay;
  const segment = (id: string, start: number, end: number): ClipSegment => ({ id, start, end });
  const edits = {
    hook_text: "Wait for it",
    hook_start: 1,
    hook_secs: 2,
    segments: [segment("s1", 10, 14), segment("s2", 20, 23), segment("s3", 30, 33)],
    text_layers: [text("t1", 2, 2)],
    shapes: [],
    music: [song("m1", 0, 7)],
    overlays: [overlay("o1", 5.5, 6)],
  } as unknown as AdvancedEdits;
  const played = playedFrom(edits.segments);
  const points = (hidden: TrackKind[] = [], changed: Partial<AdvancedEdits> = {}) =>
    editPoints({ ...edits, ...changed }, played, { duration: 10, hidden });

  test("the joins, the items' and the hook's edges and the Clip's ends, sorted, each once", () => {
    // 0 (the Clip and the Music Clip), 1 and 3 (the hook), 2 (the Text Layer), 4 (a join and the
    // Text Layer), 5.5 (the Overlay; its end is past the Clip), 7 (a join and the Music Clip), 10
    // (the Clip's end and the last Segment's).
    expect(points()).toEqual([0, 1, 2, 3, 4, 5.5, 7, 10]);
  });

  test("a hidden Text Track drops its Text Layers' edges", () => {
    // 2 goes; 4 stays, a join.
    expect(points(["text"])).toEqual([0, 1, 3, 4, 5.5, 7, 10]);
  });

  test("a hidden Hook, Overlay or Video Track drops the hook's, the Overlays' or the joins' edges", () => {
    expect(points(["hook"])).toEqual([0, 2, 4, 5.5, 7, 10]);
    expect(points(["overlay"])).toEqual([0, 1, 2, 3, 4, 7, 10]);
    // 4 stays (the Text Layer ends there), and so do 7 (the Music Clip) and 10 (the Clip's end).
    expect(points(["video"])).toEqual([0, 1, 2, 3, 4, 5.5, 7, 10]);
    expect(points(["video", "text"])).toEqual([0, 1, 3, 5.5, 7, 10]);
  });

  test("a hook without text has no edges", () => {
    expect(points([], { hook_text: " " })).toEqual([0, 2, 4, 5.5, 7, 10]);
  });

  test("items snap to the same edges, but those of a Pick of several, which move together", () => {
    // The Music Clip and the Overlay picked together: their edges go, and the rest stay.
    const pick = picked({ kind: "music", id: "m1" }, { kind: "overlay", id: "o1" });
    expect([...edgesOf(edits, played, { moving: pick })].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 4, 7, 10]);
    // A Pick of one moves alone, and its edges stay.
    expect(edgesOf(edits, played, { moving: picked({ kind: "music", id: "m1" }) })).toContain(0);
    expect(edgesOf(edits, played, { hidden: ["text"] })).not.toContain(2);
  });

  // At 30 fps, half a frame is 1/60 s, about 0.0167 s.
  const all = [0, 1, 2, 3, 4, 5.5, 7, 10];

  test("from a point, the next and the previous", () => {
    expect(nextEditPoint(all, 4, 30)).toBe(5.5);
    expect(previousEditPoint(all, 4, 30)).toBe(3);
  });

  test("within half a frame of a point is at it", () => {
    // 3.99 s is 0.01 s before 4: 4 is here, so the next is 5.5 and the previous 3.
    expect(nextEditPoint(all, 3.99, 30)).toBe(5.5);
    expect(previousEditPoint(all, 3.99, 30)).toBe(3);
    // 3.98 s is 0.02 s before 4, more than half a frame: 4 is next. And 4.02 s is past it.
    expect(nextEditPoint(all, 3.98, 30)).toBe(4);
    expect(previousEditPoint(all, 4.02, 30)).toBe(4);
  });

  test("between points, the nearest each way", () => {
    expect(nextEditPoint(all, 6, 30)).toBe(7);
    expect(previousEditPoint(all, 6, 30)).toBe(5.5);
  });

  test("at either end, nothing: the jump doesn't wrap", () => {
    expect(nextEditPoint(all, 10, 30)).toBeNull();
    expect(nextEditPoint(all, 9.995, 30)).toBeNull();
    expect(previousEditPoint(all, 0, 30)).toBeNull();
    expect(previousEditPoint(all, 0.01, 30)).toBeNull();
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

  test("volume Keyframes set the volume in its place, and the fades multiply them", () => {
    // 10 s fading in over 1 s and out over 2 s, dipped from 100% at 2 s to 25% at 4 s, eased in.
    const keys: Keyframe[] = [
      { at: 2, value: 1, ease: LINEAR },
      { at: 4, value: 0.25, ease: EASE_IN },
    ];
    const clip = { volume: 1.8, secs: 10, fade_in: 1, fade_out: 2, keys };
    expect(gainAt(0.5, clip)).toBeCloseTo(0.5);
    expect(gainAt(2, clip)).toBe(1);
    // Half way, eased in: 1 - 0.75 · 0.3153.
    expect(gainAt(3, clip)).toBeCloseTo(0.7635, 3);
    expect(gainAt(6, clip)).toBe(0.25);
    expect(gainAt(9, clip)).toBeCloseTo(0.125);
    expect(gainAt(10, clip)).toBe(0);
    // Without Keyframes, the volume.
    expect(gainAt(6, { ...clip, keys: [] })).toBe(1.8);
  });

  test("fades that meet peak where they meet", () => {
    // 4 s fading in over 3 s and out over 1 s.
    const clip = { volume: 1, secs: 4, fade_in: 3, fade_out: 1 };
    expect(gainAt(3, clip)).toBe(1);
    expect(gainAt(1.5, clip)).toBeCloseTo(0.5);
    expect(gainAt(3.5, clip)).toBeCloseTo(0.5);
  });
});

describe("a Source Segment's Waveform", () => {
  const segment: ClipSegment = { id: "s1", start: 28, end: 95 };

  test("is as loud as the Clip's own sound all along, and follows its volume", () => {
    expect(sourceGain({ source_volume: 1 }, segment)).toBe(1);
    // Turned down to 60% in the inspector, then up to 150%, then to silence.
    expect(sourceGain({ source_volume: 0.6 }, segment)).toBe(0.6);
    expect(sourceGain({ source_volume: 1.5 }, segment)).toBe(1.5);
    expect(sourceGain({ source_volume: 0 }, segment)).toBe(0);
  });

  test("is scaled by a volume of the Segment's own, as the renderer hears it", () => {
    expect(sourceGain({ source_volume: 0.8 }, { ...segment, volume: 0.5 })).toBeCloseTo(0.4);
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

  test("follows a Music Clip's volume Keyframes through its fades", () => {
    const keys: Keyframe[] = [
      { at: 2, value: 1, ease: LINEAR },
      { at: 4, value: 0.25, ease: EASE_IN },
    ];
    const heard = { volume: 1.8, secs: 10, fade_in: 1, fade_out: 2, keys };
    const line = volumeLine(heard);
    // From its start to its end, in order, with a point at each Keyframe and each fade's end.
    expect(line[0]).toEqual({ time: 0, height: 0 });
    expect(line[line.length - 1]).toEqual({ time: 10, height: 0 });
    for (let i = 1; i < line.length; i++) expect(line[i].time).toBeGreaterThan(line[i - 1].time);
    for (const time of [1, 2, 4, 8]) expect(line.map((point) => point.time)).toContain(time);
    // Drawn straight between its points, it is the gain's height all along, within a hair.
    const drawn = (time: number) => {
      const after = line.findIndex((point) => point.time >= time);
      const [a, b] = [line[Math.max(after - 1, 0)], line[after]];
      return b.time === a.time ? b.height : a.height + ((b.height - a.height) * (time - a.time)) / (b.time - a.time);
    };
    for (const [time, gain] of [[0.5, 0.5], [1, 1], [3, 0.7635], [6, 0.25], [9, 0.125]]) {
      expect(drawn(time)).toBeCloseTo(volumeHeight(gain), 2);
    }
  });

  test("follows a video Segment's volume Keyframes, with no fades, over what is drawn of it from where it starts", () => {
    const keys: Keyframe[] = [
      { at: 1, value: 1, ease: LINEAR },
      { at: 3, value: 0.25, ease: LINEAR },
    ];
    // 4 s of its video, its last half second under the Transition into the next one.
    const heard = segmentHeard({ volume: 0.8, keys: { volume: keys, scale: [] } }, { start: 10, end: 13.5 });
    expect(heard).toEqual({ volume: 0.8, secs: 3.5, fade_in: 0, fade_out: 0, keys });
    const line = volumeLine(heard);
    expect(line[0]).toEqual({ time: 0, height: volumeHeight(1) });
    expect(line.at(-1)).toEqual({ time: 3.5, height: volumeHeight(0.25) });
    expect(line.map((point) => point.time)).toContain(1);
    expect(gainAt(2, heard)).toBeCloseTo(0.625);
    // Unkeyed: its volume, 1 when it has none of its own.
    expect(segmentHeard({}, { start: 0, end: 2 })).toEqual({ volume: 1, secs: 2, fade_in: 0, fade_out: 0, keys: undefined });
  });

  test("a volume's height gives the volume back", () => {
    for (const volume of [0, 0.05, 0.25, 0.61, 1, 1.37, 1.99, 2]) expect(volumeOfHeight(volumeHeight(volume))).toBe(volume);
  });
});

describe("the ruler's diamonds (.scratch/keyframes/spec.md)", () => {
  const key = (at: number, value = 1): Keyframe => ({ at, value, ease: LINEAR });

  test("one per instant of the picked item, every property together, at their Timeline times, in order", () => {
    const item = { start: 2, keys: { x: [key(0, 200), key(3, 500)], scale: [key(1), key(3)], opacity: [key(4.5, 0)] } };
    expect(keyMarks(item)).toEqual([2, 3, 5, 6.5]);
  });

  test("Keyframes within half a frame of one another are one diamond, at the first of them", () => {
    const item = { start: 1, keys: { x: [key(1)], y: [key(1.012)], scale: [key(1.03)] } };
    expect(keyMarks(item)).toEqual([2, 2.03]);
  });

  test("an item without Keyframes has none", () => {
    expect(keyMarks({ start: 1, keys: {} })).toEqual([]);
  });
});

describe("dragging the Volume Line", () => {
  test("in a short lane (a phone's Music lane), a drag goes as if over 120 px, so small moves are small", () => {
    // 14 px down from 100% in a 35 px lane: 14/120 of the height, from 2/3 to 0.55, 72%.
    expect(volumeDragged(1, 14, 35)).toBe(0.72);
    expect(volumeDragged(1, -14, 35)).toBe(1.32);
  });

  test("in a lane at least 120 px tall, the line follows the pointer", () => {
    // A third of 240 px down from 100% (2/3) lands at 1/3 of the height: 31%.
    expect(volumeDragged(1, 80, 240)).toBe(0.31);
  });
});

describe("dragging a Seam's grip", () => {
  test("a grip dragged outward by x Timeline seconds lengthens the Transition by 2x, inward shortens it", () => {
    // A 0.5 s Transition between Segments of 10 and 8 s.
    expect(seamDragged(0.5, 0.25, 10, 8)).toBe(1);
    expect(seamDragged(0.5, -0.1, 10, 8)).toBe(0.3);
  });

  test("it stops at 0.1 s and at 3 s", () => {
    expect(seamDragged(0.5, -1, 10, 8)).toBe(0.1);
    expect(seamDragged(0.5, 5, 10, 8)).toBe(3);
  });

  test("it stops at half the shorter Segment", () => {
    // Segments of 10 and 1.6 s: 0.8 s at most.
    expect(seamDragged(0.5, 1, 10, 1.6)).toBe(0.8);
    expect(seamDragged(0.5, 1, 1.6, 10)).toBe(0.8);
  });

  test("a Transition longer than its Segments allow is dragged from the length it overlaps them by", () => {
    // 3 s stored, between Segments of 2 and 8 s: it overlaps them by 1 s, which a 0.1 s pull inward makes 0.8.
    expect(seamDragged(3, -0.1, 2, 8)).toBe(0.8);
  });
});
