// The commands a key and its button share (./commands.ts), run on a `Playback` driven by fake videos
// and a fake clock (Seam F's harness).
import { afterEach, describe, expect, test, vi } from "vitest";
import { Playback, playedFrom } from "../editor/playback";
import { harness } from "../editor/playbackHarness";
import { commandsOf } from "./commands";

afterEach(() => {
  vi.unstubAllGlobals();
});

// A 10 s Clip at 30 fps, its Edit Points at 0, 2.5, 6 and 10 s.
function setUp(move: ((delta: number, group: string) => void) | null = null, keyframes: Parameters<typeof commandsOf>[3]["keyframes"] = null) {
  const stage = harness();
  const playback = new Playback();
  playback.setSegments(playedFrom([{ start: 100, end: 110 }]));
  stage.decks(playback);
  const commands = commandsOf({ undo: () => {}, redo: () => {} }, playback, null, {
    pickAll: () => {},
    pickNone: () => {},
    paste: null,
    move,
    split: () => {},
    fit: () => {},
    zoom: () => {},
    shortcuts: () => {},
    editPoints: [0, 2.5, 6, 10],
    markIn: () => {},
    markOut: () => {},
    loop: () => {},
    clearMarks: () => {},
    fps: 30,
    setFullscreen: () => {},
    keyframes,
  });
  return { stage, playback, commands };
}

describe("frame steps", () => {
  test("a step forward while playing pauses on the next frame", () => {
    const { stage, playback, commands } = setUp();
    playback.seek(1.01);
    stage.settle();
    playback.play();
    expect(playback.playing).toBe(true);
    commands["step-forward"]();
    expect(playback.playing).toBe(false);
    expect(playback.time).toBeCloseTo(31 / 30, 9);
  });

  test("ten frames back from near the start stops at 0", () => {
    const { playback, commands } = setUp();
    playback.seek(0.2);
    commands["step-back-10"]();
    expect(playback.time).toBe(0);
  });

  test("End goes to the last frame", () => {
    const { playback, commands } = setUp();
    commands.end();
    expect(playback.time).toBeCloseTo(299 / 30, 9);
  });
});

describe("Edit Point jumps", () => {
  test("next and previous go from point to point", () => {
    const { playback, commands } = setUp();
    playback.seek(1);
    commands["edit-point-next"]();
    expect(playback.time).toBeCloseTo(2.5, 9);
    commands["edit-point-next"]();
    expect(playback.time).toBeCloseTo(6, 9);
    commands["edit-point-previous"]();
    expect(playback.time).toBeCloseTo(2.5, 9);
  });

  test("the Clip's end is its last frame, and there is nothing past it", () => {
    const { playback, commands } = setUp();
    playback.seek(7);
    commands["edit-point-next"]();
    expect(playback.time).toBeCloseTo(299 / 30, 9);
    commands["edit-point-next"]();
    expect(playback.time).toBeCloseTo(299 / 30, 9);
  });

  test("before the first point there is nothing to go back to", () => {
    const { playback, commands } = setUp();
    commands["edit-point-previous"]();
    expect(playback.time).toBe(0);
  });
});

describe("Keyframes of the picked item", () => {
  // Its Keyframes at 1.5 and 4 s.
  const around = (time: number, direction: -1 | 1) => (direction > 0 ? ([1.5, 4].find((at) => at > time) ?? null) : ([1.5, 4].findLast((at) => at < time) ?? null));

  test("[ and ] take the playhead to its previous and next Keyframe, paused", () => {
    const { stage, playback, commands } = setUp(null, { toggle: () => {}, around });
    playback.seek(2);
    stage.settle();
    playback.play();
    commands["key-next"]();
    expect(playback.playing).toBe(false);
    expect(playback.time).toBeCloseTo(4, 9);
    commands["key-previous"]();
    expect(playback.time).toBeCloseTo(1.5, 9);
    // With none before, it stays.
    commands["key-previous"]();
    expect(playback.time).toBeCloseTo(1.5, 9);
  });

  test("K keys it; with no such item picked, K, [ and ] are left to the browser", () => {
    const toggle = vi.fn();
    setUp(null, { toggle, around }).commands["key-toggle"]();
    expect(toggle).toHaveBeenCalled();
    const { commands } = setUp();
    for (const id of ["key-toggle", "key-previous", "key-next"] as const) expect(commands[id]()).toBe(false);
  });
});

describe("moving the Pick", () => {
  test("a frame later, in one undo group", () => {
    const move = vi.fn();
    const { commands } = setUp(move);
    commands["move-forward"]();
    expect(move).toHaveBeenCalledWith(1 / 30, "key:move");
  });

  test("with nothing to move, the key is still taken, so that Alt+← isn't the browser's Back", () => {
    const { commands } = setUp();
    for (const id of ["move-back", "move-forward", "move-back-10", "move-forward-10"] as const) {
      expect(commands[id]()).not.toBe(false);
    }
    // Copy with nothing picked is left to the browser.
    expect(commands.copy()).toBe(false);
  });
});
