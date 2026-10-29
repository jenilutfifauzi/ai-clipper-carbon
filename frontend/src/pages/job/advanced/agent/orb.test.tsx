// .scratch/agent-chat-ui/issues/08-thinking-orb.md: the thinking orb, at the seams the ticket agreed.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { orbFrame } from "./orb";
import { StatusLine } from "./StatusLine";

describe("orbFrame", () => {
  test("a frame is the same for the same moment, its dots inside the canvas, far to near", () => {
    const dots = orbFrame(20, 3.7);
    expect(orbFrame(20, 3.7)).toEqual(dots);
    expect(dots.length).toBeGreaterThan(10);
    for (const dot of dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0);
      expect(dot.x).toBeLessThanOrEqual(20);
      expect(dot.y).toBeGreaterThanOrEqual(0);
      expect(dot.y).toBeLessThanOrEqual(20);
    }
    expect(dots.map((dot) => dot.z)).toEqual([...dots.map((dot) => dot.z)].sort((a, b) => a - b));
  });

  test("the nearest dot is larger and brighter than the farthest", () => {
    const dots = orbFrame(20, 0.6);
    const [far, near] = [dots[0], dots[dots.length - 1]];
    expect(near.r).toBeGreaterThan(far.r);
    expect(near.ink).toBeLessThan(far.ink);
  });
});

describe("the orb in place", () => {
  test("the status line turns the orb, not the old glyphs, and keeps it from screen readers", () => {
    const html = renderToStaticMarkup(<StatusLine label="Working…" />);
    expect(html).toMatch(/<canvas[^>]*aria-hidden="true"/);
    expect(html).not.toMatch(/[·✢✳✶✻✽]/);
  });
});
