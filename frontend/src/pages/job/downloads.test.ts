// .scratch/captions-advanced/issues/10-srt-and-vtt.md: a Clip's downloads (its MP4 and its caption
// files) are named after its Candidate's title, in both the Clips list and the Advanced Edit's menu.
import { describe, expect, test } from "vitest";
import { clipFileName } from "./downloads";

describe("a Clip's download name", () => {
  test("is the Candidate's title without the characters file systems refuse", () => {
    expect(clipFileName("Rugi 500 juta: gimana?", "4aace5bd")).toBe("Rugi 500 juta gimana");
    expect(clipFileName('  "Podcast"  seru / banget  ', "4aace5bd")).toBe("Podcast seru banget");
  });

  test("falls back to the Candidate's id for a Candidate with no title, or no usable one", () => {
    expect(clipFileName(undefined, "4aace5bd")).toBe("clip-4aace5bd");
    expect(clipFileName("???", "4aace5bd")).toBe("clip-4aace5bd");
  });
});
