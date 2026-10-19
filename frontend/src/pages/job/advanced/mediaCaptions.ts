import type { ClipSegment, WordsStatus } from "../../../api";
import { LANGUAGES } from "../../../languages";

/** Whether a video's Segment is captioned: its Captions switch is on unless it is false (ADR 0020). */
export const captionsOn = (segment: ClipSegment) => segment.captions !== false;

/** The Segment with its Captions switch turned: off is false, on is empty, as every Segment saved before it. */
export const withCaptions = (segment: ClipSegment, on: boolean): ClipSegment => ({ ...segment, captions: on ? null : false });

/**
 * The choices of a video's language: first the Job's (the empty value, which follows each Job's),
 * then the languages offered, and the item's own when they don't name it.
 */
export function languageChoices(jobLanguage: string, current: string | null | undefined): { value: string; label: string }[] {
  const named = LANGUAGES.map(([code, name]) => ({ value: code as string, label: `${name} (${code})` }));
  const own = current && !named.some((choice) => choice.value === current) ? [{ value: current, label: current }] : [];
  return [{ value: "", label: `Job's language (${jobLanguage})` }, ...named, ...own];
}

/**
 * What a video's Segment's inspector says of its Words status, and what it offers: Retry when its
 * transcription failed, "Transcribe again" when it is ready; nothing for a Segment that isn't captioned.
 */
export function wordsState(
  status: WordsStatus | undefined,
  error: string | undefined,
): { text: string; tone: "muted" | "danger"; action: "retry" | "again" | null } | null {
  switch (status) {
    case "failed":
      return { text: `Transcribing failed${error ? `: ${error}` : ""}`, tone: "danger", action: "retry" };
    case "media":
      return { text: "Transcribed", tone: "muted", action: "again" };
    case "pending":
      return { text: "Transcribing…", tone: "muted", action: null };
    case "none":
      return { text: "Not transcribed yet", tone: "muted", action: "retry" };
    default:
      return null;
  }
}
