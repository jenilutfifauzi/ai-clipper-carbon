import { describe, expect, it } from "vitest";
import { frameFileName } from "./saveFrame";

describe("frameFileName", () => {
  it("is the title and the time of the frame shown, mm.ss.ff", () => {
    expect(frameFileName("Halo semua", 0.5, 25, 10)).toBe("Halo semua-00.00.12.png");
    expect(frameFileName("Halo semua", 61.04, 25, 90)).toBe("Halo semua-01.01.01.png");
    expect(frameFileName("Halo", 0, 30, 10)).toBe("Halo-00.00.00.png");
  });

  it("counts the frames of a fractional rate within each second", () => {
    expect(frameFileName("Halo", 1.0, 29.97, 10)).toBe("Halo-00.00.29.png");
    expect(frameFileName("Halo", 1.05, 29.97, 10)).toBe("Halo-00.01.01.png");
  });

  it("stops at the Clip's last frame", () => {
    expect(frameFileName("Halo", 10, 25, 2)).toBe("Halo-00.01.24.png");
  });

  it("keeps the title to what a file name can hold", () => {
    expect(frameFileName('a/b: c?"d"', 0, 25, 10)).toBe("a-b- c--d--00.00.00.png");
    expect(frameFileName("   ", 0, 25, 10)).toBe("Frame-00.00.00.png");
  });
});
