// The Advanced Edit's deck Transport (ADR 0025): the timecode on the left, go to start, a frame back,
// Play, a frame on and go to end centred, the tools on the right, and no position slider. The player
// panel's header says the Canvas and frame rate. No jsdom in this repo, so the markup is checked with
// renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { DeckTransport } from "../editor/DeckTransport";
import { Playback, playedFrom } from "../editor/playback";
import { DeckButtons, PreviewHeader, previewFormat } from "./Chrome";
import type { Commands } from "./commands";

// The playhead's hooks read the playback straight away: a page rendered without a browser has no
// store to subscribe to.
vi.mock("../editor/playback", async (original) => ({
  ...(await original<typeof import("../editor/playback")>()),
  usePlayback: (playback: Playback, select: (time: number, playback: Playback) => unknown) => select(playback.time, playback),
}));

function playback() {
  const made = new Playback();
  made.setSegments(playedFrom([{ start: 100, end: 110 }]));
  return made;
}

const commands = { start: () => {}, end: () => {}, "step-back": () => {}, "step-forward": () => {} } as unknown as Commands;

describe("the deck Transport", () => {
  test("has no position slider, and puts the timecode, the buttons round Play and the tools in that order", () => {
    const html = renderToStaticMarkup(
      <DeckTransport
        playback={playback()}
        before={<button type="button">Before</button>}
        after={<button type="button">After</button>}
        tools={<button type="button">Tools</button>}
      />,
    );
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain("Position in the clip");
    const order = [" / ", ">Before<", 'aria-label="Play"', ">After<", ">Tools<"].map((mark) => html.indexOf(mark));
    expect(order.every((at, i) => at > -1 && (i === 0 || at > order[i - 1]))).toBe(true);
  });

  test("goes to the start and a frame back before Play, a frame on and to the end after it, with their keys", () => {
    const shown = playback();
    const before = renderToStaticMarkup(<DeckButtons side="before" playback={shown} fps={30} commands={commands} />);
    const after = renderToStaticMarkup(<DeckButtons side="after" playback={shown} fps={30} commands={commands} />);
    expect(before.indexOf('aria-label="Go to start"')).toBeLessThan(before.indexOf('aria-label="One frame back"'));
    expect(before).toContain('title="Go to start (Home)"');
    expect(after.indexOf('aria-label="One frame forward"')).toBeLessThan(after.indexOf('aria-label="Go to end"'));
    expect(after).toContain('title="Go to end (End)"');
  });
});

describe("the Preview header", () => {
  test("says the Canvas in output pixels and the frame rate", () => {
    expect(previewFormat({ width: 1080, height: 1920 }, 30)).toBe("1080 × 1920 · 30 fps");
    expect(previewFormat({ width: 1920, height: 1080 }, 29.97)).toBe("1920 × 1080 · 29.97 fps");
  });

  test("is Preview, the format, then the picker", () => {
    const html = renderToStaticMarkup(<PreviewHeader format="1080 × 1920 · 30 fps" picker={<span>Picker</span>} />);
    expect(html.indexOf(">Preview<")).toBeLessThan(html.indexOf("1080 × 1920 · 30 fps"));
    expect(html.indexOf("1080 × 1920 · 30 fps")).toBeLessThan(html.indexOf(">Picker<"));
  });
});
