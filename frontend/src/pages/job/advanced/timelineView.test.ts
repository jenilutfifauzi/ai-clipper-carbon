// Seam E (.scratch/timeline-visuals/spec.md): what the Advanced Edit's Timeline shows, as worked
// examples of numbers and edits in and the view out.
import { describe, expect, test } from "vitest";
import type { ClipSegment, MusicClip, TextLayer } from "../../../api";
import { playedFrom } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { zoomToFit } from "./timelineView";

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
