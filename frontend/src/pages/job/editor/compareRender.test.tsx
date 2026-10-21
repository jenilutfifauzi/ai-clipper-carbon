// The before view and Compare render (.scratch/color-adjust/issues/08-before-view-and-compare-render.md):
// the Compare render's frame cleared on a playhead move and on an edit, and the hold button dropping
// every Grade filter while held, restoring them when let go.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { Grade, Picture } from "../../../api";
import { CompareRender, holdHandlers } from "./compareRender";
import { DecksGraded, GradeFilters, ShowOriginal } from "./GradeFilters";
import { adjusted, NEUTRAL_GRADE } from "./grading";
import { PicturePanel } from "./PicturePanel";
import { Playback, playedFrom } from "./playback";
import { AdjustedStack } from "./PreviewAdjustments";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

// A paused Playback over one 10 s Segment, at `at`.
function pausedAt(at: number) {
  const playback = new Playback();
  playback.setSegments(playedFrom([{ start: 0, end: 10 }]));
  playback.seek(at);
  return playback;
}

// Pictures as plain names, so that each made is seen let go.
function pictures() {
  const made: string[] = [];
  const dropped: string[] = [];
  return {
    made,
    dropped,
    make: () => {
      made.push(`blob:${made.length}`);
      return made[made.length - 1];
    },
    drop: (url: string) => void dropped.push(url),
  };
}

describe("Compare render", () => {
  test("asks for the frame at the playhead, of the draft, and shows it once it comes", async () => {
    const playback = pausedAt(2.5);
    const urls = pictures();
    const compare = new CompareRender(playback, "draft-1", urls);
    const stop = compare.watch();
    const fetch = vi.fn((_at: number, _signal: AbortSignal) => Promise.resolve(new Blob(["png"])));
    compare.request(fetch);
    expect(fetch).toHaveBeenCalledWith(2.5, expect.any(AbortSignal));
    expect(compare.state).toEqual({ kind: "loading", at: 2.5 });
    await settle();
    expect(compare.state).toEqual({ kind: "shown", at: 2.5, url: "blob:0" });
    stop();
  });

  test("is cleared on a playhead move, its picture let go", async () => {
    const playback = pausedAt(2.5);
    const urls = pictures();
    const compare = new CompareRender(playback, "draft-1", urls);
    compare.watch();
    compare.request(() => Promise.resolve(new Blob(["png"])));
    await settle();
    expect(compare.state.kind).toBe("shown");

    playback.seek(2.5);
    expect(compare.state.kind).toBe("shown");
    playback.seek(3);
    expect(compare.state).toEqual({ kind: "idle" });
    expect(urls.dropped).toEqual(["blob:0"]);
  });

  test("is cleared on a skim and on a play", async () => {
    const playback = pausedAt(1);
    const compare = new CompareRender(playback, "draft-1", pictures());
    compare.watch();
    compare.request(() => Promise.resolve(new Blob(["png"])));
    await settle();
    playback.skim(4);
    expect(compare.state).toEqual({ kind: "idle" });
  });

  test("is cleared on an edit, and one on its way is aborted and never shown", async () => {
    const playback = pausedAt(2);
    const urls = pictures();
    const compare = new CompareRender(playback, "draft-1", urls);
    compare.watch();
    compare.request(() => Promise.resolve(new Blob(["png"])));
    await settle();
    compare.edited("draft-1");
    expect(compare.state.kind).toBe("shown");
    compare.edited("draft-2");
    expect(compare.state).toEqual({ kind: "idle" });
    expect(urls.dropped).toEqual(["blob:0"]);

    let answer: (blob: Blob) => void = () => {};
    let signal: AbortSignal | null = null;
    compare.request((_at, given) => {
      signal = given;
      return new Promise<Blob>((resolve) => (answer = resolve));
    });
    expect(compare.state.kind).toBe("loading");
    compare.edited("draft-3");
    expect(signal!.aborted).toBe(true);
    answer(new Blob(["late"]));
    await settle();
    expect(compare.state).toEqual({ kind: "idle" });
    expect(urls.made).toEqual(["blob:0"]);
  });

  test("is refused while playing, and says why when the server can't draw it", async () => {
    const playback = pausedAt(2);
    const compare = new CompareRender(playback, "draft-1", pictures());
    const fetch = vi.fn(() => Promise.reject(new Error("ffmpeg failed")));
    playback.playing = true;
    compare.request(fetch);
    expect(fetch).not.toHaveBeenCalled();
    playback.playing = false;
    compare.request(fetch);
    await settle();
    expect(compare.state).toEqual({ kind: "failed", at: 2, message: "ffmpeg failed" });
  });
});

describe("the before view", () => {
  const grade: Grade = adjusted(NEUTRAL_GRADE, { saturation: -60, vignette: 50 });
  const box = { x: 0, y: 0, width: 540, height: 960 };
  const picture: Picture = {
    crop: box,
    item_size: [540, 960],
    width: 540,
    height: 960,
    centre: [540, 960],
    rotation: 0,
    flip_h: false,
    flip_v: false,
    opacity: 1,
    bounds: box,
    radius: 0,
    border: null,
    shadow: null,
  };

  // The player's Grade-drawing pieces: the Candidate's and a Segment's decks, an Overlay, an Adjustment Layer.
  const stage = (original: boolean) =>
    renderToStaticMarkup(
      <ShowOriginal on={original}>
        <GradeFilters grades={[grade]} />
        <AdjustedStack filters={[{ id: "a1", grade, effects: [], start: 0, weight: 0.5, filterId: "adjust-a1" }]}>
          <DecksGraded grade={grade}>
            <DecksGraded grade={grade}>
              <video />
            </DecksGraded>
          </DecksGraded>
          <PicturePanel picture={picture} frame={{ width: 1080, height: 1920 }} media={<img alt="" />} grade={grade} />
        </AdjustedStack>
      </ShowOriginal>,
    );

  test("holding its button drops every Grade filter and vignette; letting go restores them", () => {
    let held = false;
    const handlers = holdHandlers((next) => (held = next));
    const drawn = () => stage(held);
    const graded = drawn();
    expect(graded).toMatch(/filter:url\(#grade-/);
    expect(graded).toContain("url(#adjust-a1)");
    expect(graded).toContain("data-vignette");

    const pointer = { button: 0, pointerId: 1, preventDefault() {}, currentTarget: { setPointerCapture() {} } };
    handlers.onPointerDown(pointer as never);
    const original = drawn();
    expect(original).not.toMatch(/filter:url\(/);
    expect(original).not.toContain("data-vignette");
    // The videos stay where they were: nothing remounts.
    expect(original).toContain("<video>");

    handlers.onPointerUp();
    expect(drawn()).toBe(graded);
  });

  test("the keyboard holds it too: Space or Enter down, its repeats ignored, and up lets go", () => {
    const holds: boolean[] = [];
    const handlers = holdHandlers((next) => holds.push(next));
    const key = (key: string, repeat = false) => ({ key, repeat, preventDefault() {}, stopPropagation: vi.fn() });
    const down = key(" ");
    handlers.onKeyDown(down as never);
    handlers.onKeyDown(key(" ", true) as never);
    handlers.onKeyUp(key(" ") as never);
    handlers.onKeyDown(key("Enter") as never);
    handlers.onBlur();
    handlers.onKeyDown(key("a") as never);
    expect(holds).toEqual([true, false, true, false]);
    // Space goes no further, so that it doesn't play.
    expect(down.stopPropagation).toHaveBeenCalled();
  });

  test("a stage outside it keeps its Grades", () => {
    const markup = (children: ReactNode) => renderToStaticMarkup(<>{children}</>);
    expect(markup(<DecksGraded grade={grade}>x</DecksGraded>)).toMatch(/filter:url\(#grade-/);
  });
});
