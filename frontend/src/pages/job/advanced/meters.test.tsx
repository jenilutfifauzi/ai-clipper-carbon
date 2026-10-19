// .scratch/audio-mixing/issues/13-meters.md: the Meters read the master bus on each frame while the
// preview plays. Pausing lets the bars fall, and the reading stops once they are down. The column has
// its legend, and its tooltip says the render is normalized afterwards.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Playback, playedFrom } from "../editor/playback";
import { harness } from "../editor/playbackHarness";
import { FLOOR_DB, type Meter } from "./ballistics";
import { MeterFeed } from "./meterFeed";
import { Meters } from "./Meters";

afterEach(() => {
  vi.unstubAllGlobals();
});

function stage() {
  const clock = harness();
  const playback = new Playback();
  playback.setSegments(playedFrom([{ start: 100, end: 110 }]));
  clock.decks(playback);
  playback.seek(0);
  clock.settle();
  const reads = { count: 0 };
  const drawn: Meter[] = [];
  const feed = new MeterFeed(
    playback,
    (meter) => drawn.push(meter),
    () => {
      reads.count++;
      return [0.5, 1];
    },
  );
  return { clock, playback, reads, drawn, feed };
}

describe("the Meters' feed", () => {
  test("reads nothing until the preview plays", () => {
    const { clock, reads, drawn, feed } = stage();
    const stop = feed.start();
    clock.advance(1);
    expect(reads.count).toBe(0);
    expect(drawn).toHaveLength(0);
    stop();
  });

  test("moves the bars while playing, and once paused lets them fall and stops reading", () => {
    const { clock, playback, reads, drawn, feed } = stage();
    const stop = feed.start();
    playback.play();
    clock.advance(0.2);
    expect(reads.count).toBeGreaterThan(5);
    const loud = drawn.at(-1)!;
    expect(loud.left.level).toBeCloseTo(-6.02, 2);
    expect(loud.right.level).toBe(0);
    expect(loud.clipped).toBe(true);

    playback.toggle();
    const read = reads.count;
    clock.advance(1);
    expect(reads.count).toBe(read);
    expect(drawn.at(-1)!.right.level).toBeCloseTo(-24, 0);

    // Down after the hold and the fall (1.5 s + 60 dB at 24 dB/s): no more frames are drawn.
    clock.advance(4);
    const down = drawn.length;
    expect(drawn.at(-1)!.right.held).toBe(FLOOR_DB);
    clock.advance(1);
    expect(drawn).toHaveLength(down);
    // The clip light stays on until it is clicked.
    expect(feed.meter.clipped).toBe(true);
    feed.clearClip();
    expect(drawn.at(-1)!.clipped).toBe(false);

    // Played again, it reads again.
    playback.play();
    clock.advance(0.1);
    expect(reads.count).toBeGreaterThan(read);
    stop();
  });

  test("stops when it is stopped", () => {
    const { clock, playback, reads, feed } = stage();
    const stop = feed.start();
    playback.play();
    clock.advance(0.1);
    stop();
    const read = reads.count;
    clock.advance(0.5);
    expect(reads.count).toBe(read);
  });
});

describe("the Meters' column", () => {
  test("names its scale and sides, says the render is normalized, and holds no peak before playing", () => {
    const markup = renderToStaticMarkup(<Meters playback={new Playback()} />);
    expect(markup).toContain('aria-label="Meters"');
    expect(markup).toMatch(/>dB<.*>L<.*>R</s);
    expect(markup).toContain("normalized to −14 LUFS afterwards");
    expect(markup).toContain("Clip light");
    expect(markup).toContain(">–<");
  });
});
