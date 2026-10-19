// .scratch/captions-advanced/issues/05-media-caption-controls.md: a media Segment's Captions switch,
// its item's language, and what its Words status offers.
import { describe, expect, test } from "vitest";
import type { ClipSegment } from "../../../api";
import { failedSegments } from "../editor/wordsStatus";
import { captionsOn, languageChoices, withCaptions, wordsState } from "./mediaCaptions";

const intro: ClipSegment = { id: "i", start: 0, end: 1.5, media: "red", framing: null, volume: 1 };

describe("the Captions switch", () => {
  test("is on when empty, off when false", () => {
    expect(captionsOn(intro)).toBe(true);
    expect(captionsOn({ ...intro, captions: null })).toBe(true);
    expect(captionsOn({ ...intro, captions: false })).toBe(false);
  });

  test("off writes false; on again empties it, as every saved Segment has it", () => {
    expect(withCaptions(intro, false)).toEqual({ ...intro, captions: false });
    expect(withCaptions({ ...intro, captions: false }, true)).toEqual({ ...intro, captions: null });
  });
});

describe("languageChoices", () => {
  test("starts with the Job's language, then the languages, named", () => {
    const choices = languageChoices("id", null);
    expect(choices[0]).toEqual({ value: "", label: "Job's language (id)" });
    expect(choices).toContainEqual({ value: "en", label: "English (en)" });
  });

  test("keeps an item's language the list doesn't name", () => {
    expect(languageChoices("id", "pt-BR")).toContainEqual({ value: "pt-BR", label: "pt-BR" });
    expect(languageChoices("id", "en").filter((choice) => choice.value === "en")).toHaveLength(1);
  });
});

describe("wordsState", () => {
  test("offers Retry when failed, with the error, and Transcribe again when ready", () => {
    expect(wordsState("failed", "Whisper fell over")).toEqual({ text: "Transcribing failed: Whisper fell over", tone: "danger", action: "retry" });
    expect(wordsState("media", undefined)).toEqual({ text: "Transcribed", tone: "muted", action: "again" });
    expect(wordsState("pending", undefined)).toEqual({ text: "Transcribing…", tone: "muted", action: null });
    expect(wordsState("off", undefined)).toBeNull();
  });
});

describe("failedSegments", () => {
  test("are the Segments whose Words failed", () => {
    expect(failedSegments({ i: "failed", e: "clip", o: "media" })).toEqual(new Set(["i"]));
    expect(failedSegments(undefined)).toEqual(new Set());
  });
});
