import { describe, expect, it } from "vitest";
import { frameFileName } from "./saveFrame";

describe("frameFileName", () => {
  it("is the title and the time of the name the backend gave the frame", () => {
    expect(frameFileName("Halo semua", "ab12", { name: "ab12-00.00.12.png" })).toBe("Halo semua-00.00.12.png");
    expect(frameFileName("Halo", "ab12", { name: "ab12-01.01.01.png" })).toBe("Halo-01.01.01.png");
  });

  it("keeps the title to what a file name can hold, as other downloads do", () => {
    expect(frameFileName('a/b: c?"d"', "ab12", { name: "ab12-00.00.00.png" })).toBe("a b c d-00.00.00.png");
    expect(frameFileName("   ", "ab12", { name: "ab12-00.00.00.png" })).toBe("clip-ab12-00.00.00.png");
  });
});
