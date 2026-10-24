// .scratch/agent-mode/issues/10-presence-preview-follow.md: Follow agent's step, and the stage's outlines
// of what a Revision changed (ADR 0029), as pure functions.
import { describe, expect, test } from "vitest";
import type { Picture } from "../../../../api";
import { agentOutlines, followStep } from "./follow";

// 100 pixels a second, showing 10 s to 20 s.
const view = { left: 1000, right: 2000, pps: 100, follow: true };
const target = { kind: "text_layers", id: "t1", time: 12 } as const;

describe("followStep", () => {
  test("a target in view with the playhead in view: nothing to do", () => {
    expect(followStep(view, target, 15)).toBeNull();
  });

  test("a target in view with the playhead out of it: the playhead goes to the target", () => {
    expect(followStep(view, target, 3)).toEqual({ scroll: null, seek: 12 });
  });

  test("a target out of view: scrolled into it, and the playhead, now out of view, goes to it", () => {
    const step = followStep(view, { ...target, time: 30 }, 15);
    expect(step?.seek).toBe(30);
    expect(step!.scroll).toBeGreaterThan(2000);
    expect(step!.scroll! + 1000).toBeGreaterThanOrEqual(3000);
    expect(step!.scroll!).toBeLessThanOrEqual(3000);
  });

  test("a target out of view with the playhead still in view after the scroll: scrolled only", () => {
    const step = followStep(view, { ...target, time: 21 }, 19.9);
    expect(step?.seek).toBeNull();
    expect(step!.scroll).toBeGreaterThan(1000);
  });

  test("Follow off, or no target: nothing", () => {
    expect(followStep({ ...view, follow: false }, { ...target, time: 30 }, 15)).toBeNull();
    expect(followStep(view, null, 3)).toBeNull();
  });
});

describe("agentOutlines", () => {
  const picture = { centre: [10, 10], width: 5, height: 5, rotation: 0 } as unknown as Picture;
  const pictures = [
    { id: "text:t1", picture },
    { id: "shape:s1", picture },
    { id: "overlay:o1", picture },
    { id: "overlay:o2", picture: null },
    { id: "picture:0", picture, behind: true },
    { id: "text:t2", picture },
  ];

  test("outlines the flashing Text Layers, Shapes and Overlays drawn on the stage", () => {
    const flashing = new Set(["t1", "s1", "o1", "o2", "0"]);
    expect(agentOutlines(pictures, flashing).map((each) => each.id)).toEqual(["text:t1", "shape:s1", "overlay:o1"]);
  });

  test("nothing flashing, nothing outlined", () => {
    expect(agentOutlines(pictures, new Set())).toEqual([]);
  });
});
