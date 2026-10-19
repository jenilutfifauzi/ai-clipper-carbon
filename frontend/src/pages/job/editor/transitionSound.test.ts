// .scratch/transitions-expanded/issues/06: how loud each side of a Transition is heard in the
// preview, by its sound, as the render's acrossfade has it.
import { describe, expect, test } from "vitest";
import type { TransitionSound } from "../../../api";
import { broughtIn, crossedBy, crossedVolumes } from "./transitionSound";

// Each side's share of its own loudness, `time` seconds into a Clip with a Transition from 2 s to 3 s.
const at = (sound: TransitionSound | undefined, time: number) => {
  const { outgoing, incoming } = crossedVolumes({ start: 2, end: 3, sound }, time);
  return [outgoing, incoming].map((share) => Number(share.toFixed(4)));
};

describe("a Transition's sound in the preview", () => {
  test("is linear when left out: straight lines, half of each in the middle", () => {
    expect(at(undefined, 2)).toEqual([1, 0]);
    expect(at(undefined, 2.25)).toEqual([0.75, 0.25]);
    expect(at("linear", 2.5)).toEqual([0.5, 0.5]);
    expect(at("linear", 3)).toEqual([0, 1]);
  });

  test("by equal power follows quarter sines, keeping the summed power whole", () => {
    expect(at("equal_power", 2)).toEqual([1, 0]);
    expect(at("equal_power", 2.25)).toEqual([0.9239, 0.3827]);
    expect(at("equal_power", 2.5)).toEqual([0.7071, 0.7071]);
    expect(at("equal_power", 3)).toEqual([0, 1]);
  });

  test("by a cut is the first side alone until the middle, then the second", () => {
    expect(at("cut", 2.05)).toEqual([1, 0]);
    expect(at("cut", 2.48)).toEqual([1, 0]);
    expect(at("cut", 2.5)).toEqual([0.5, 0.5]);
    expect(at("cut", 2.52)).toEqual([0, 1]);
    expect(at("cut", 2.95)).toEqual([0, 1]);
  });

  test("the Segment a Transition brings in is heard by its share within it, and whole elsewhere", () => {
    const transitions = [
      { start: 2, end: 3 },
      { start: 5, end: 5.5, sound: "cut" as const },
    ];
    expect([1.5, 2.25, 3, 5.2, 5.3].map((time) => Number(broughtIn(transitions, time).toFixed(4)))).toEqual([1, 0.25, 1, 0, 1]);
  });

  test("a Segment between two Transitions is brought in by one and taken away by the other", () => {
    const share = crossedBy({ start: 2, end: 3, sound: "equal_power" }, { start: 6, end: 7 });
    expect([2.5, 4, 6.25].map((time) => Number(share(time).toFixed(4)))).toEqual([0.7071, 1, 0.75]);
    expect(crossedBy()(4)).toBe(1);
  });

  test("outside the Transition only one side is heard", () => {
    for (const sound of ["linear", "equal_power", "cut"] as const) {
      expect(at(sound, 1)).toEqual([1, 0]);
      expect(at(sound, 4)).toEqual([0, 1]);
    }
  });
});
