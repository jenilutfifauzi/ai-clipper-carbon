// .scratch/export-settings/issues/06: a rendering Clip's progress line says roughly how long it has left.
import { describe, expect, test } from "vitest";
import { formatTimeLeft, timeLeft } from "./format";

describe("the time left", () => {
  test("is worded almost done, in seconds under a minute, and in minutes and seconds after", () => {
    expect(formatTimeLeft(0.5)).toBe("almost done");
    expect(formatTimeLeft(1)).toBe("almost done");
    expect(formatTimeLeft(40)).toBe("40s left");
    expect(formatTimeLeft(59.7)).toBe("1:00 left");
    expect(formatTimeLeft(130)).toBe("2:10 left");
  });

  const started = "2026-10-18T10:00:00Z";
  const at = (secs: number) => Date.parse(started) + secs * 1000;

  test("is what the time so far says the rest takes at that pace", () => {
    // 30 s for a quarter: 90 s for the three quarters left.
    expect(timeLeft(started, 25, at(30))).toBe("1:30 left");
    // 20 s for 80%: 5 s for the rest.
    expect(timeLeft(started, 80, at(20))).toBe("5s left");
    expect(timeLeft(started, 99, at(60))).toBe("almost done");
  });

  test("isn't shown until progress passes 2%", () => {
    expect(timeLeft(started, null, at(10))).toBeNull();
    expect(timeLeft(started, 0, at(10))).toBeNull();
    expect(timeLeft(started, 2, at(10))).toBeNull();
    expect(timeLeft(started, 3, at(3))).toBe("1:37 left");
  });
});
