// .scratch/transitions-expanded/issues/08: the actions on every join of the Clip (Apply to all,
// Randomise all) and the Random card's kind, with a seeded random source.
import { describe, expect, test } from "vitest";
import type { Transition } from "../../../api";
import { TRANSITION_KINDS } from "../editor/transitions";
import { appliedToAll, randomCardKind, randomisedTransitions } from "./actions";

// A seeded random source (mulberry32), so that a run is the same each time.
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const segmentsOf = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `s${i}` }));

describe("Randomise all joins", () => {
  const model: Transition = { after: "s3", kind: "dipcolour", secs: 0.8, strength: 0.4, colour: "#3366FF", sound: "cut" };

  test("gives every join a kind, never its neighbour's, keeping the picked join's length, knobs and sound", () => {
    const transitions = randomisedTransitions(model, segmentsOf(2001), seeded(8));
    expect(transitions.map((transition) => transition.after)).toEqual(segmentsOf(2000).map((segment) => segment.id));
    for (const [i, transition] of transitions.entries()) {
      expect(transition).toEqual({ ...model, after: `s${i}`, kind: transition.kind });
      if (i > 0) expect(transition.kind).not.toBe(transitions[i - 1].kind);
    }
  });

  test("can reach every kind", () => {
    const kinds = new Set(randomisedTransitions(model, segmentsOf(2001), seeded(21)).map((transition) => transition.kind));
    expect([...kinds].sort()).toEqual([...TRANSITION_KINDS].sort());
  });

  test("a Clip of one Segment has no joins to give one", () => {
    expect(randomisedTransitions(model, segmentsOf(1), seeded(1))).toEqual([]);
  });
});

describe("Apply to all joins", () => {
  test("writes the picked join's whole Transition over every join, each with its own `after`", () => {
    const model: Transition = { after: "s1", kind: "dipcolour", secs: 1.2, strength: 0.3, colour: "#FF0000", sound: "equal_power" };
    expect(appliedToAll(model, segmentsOf(4))).toEqual([
      { after: "s0", kind: "dipcolour", secs: 1.2, strength: 0.3, colour: "#FF0000", sound: "equal_power" },
      { after: "s1", kind: "dipcolour", secs: 1.2, strength: 0.3, colour: "#FF0000", sound: "equal_power" },
      { after: "s2", kind: "dipcolour", secs: 1.2, strength: 0.3, colour: "#FF0000", sound: "equal_power" },
    ]);
  });
});

describe("the Random card's kind", () => {
  // Five Segments: joins after s0 (Fade), s1 (none yet), s2 (Push left) and s3 (Dissolve).
  const transitions: Transition[] = [
    { after: "s0", kind: "fade", secs: 0.5 },
    { after: "s2", kind: "slideleft", secs: 0.5 },
    { after: "s3", kind: "dissolve", secs: 0.5 },
  ];
  const kindsAt = (after: string, seed: number) => {
    const random = seeded(seed);
    return new Set(Array.from({ length: 2000 }, () => randomCardKind(transitions, segmentsOf(5), after, random)));
  };

  test("is never a neighbouring join's kind, and can be any other", () => {
    const kinds = kindsAt("s1", 5);
    expect(kinds.has("fade")).toBe(false);
    expect(kinds.has("slideleft")).toBe(false);
    expect(kinds.size).toBe(TRANSITION_KINDS.length - 2);
  });

  test("at the last join, has the one before to avoid", () => {
    const kinds = kindsAt("s3", 9);
    expect(kinds.has("slideleft")).toBe(false);
    expect(kinds.size).toBe(TRANSITION_KINDS.length - 1);
  });
});
