import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { WordsStatus } from "../../../api";
import type { PlayedSegment } from "./playback";

// How often the Preview Plan is asked for again while a Segment's Words are being transcribed.
export const PENDING_REFRESH_MS = 1500;

/**
 * Where each Segment whose Words are pending (a video's Media Words being transcribed) plays on the
 * Timeline: `played` and `segments` are the Main Track, one for one; `status` is the Preview Plan's
 * `words_status`, by Segment id.
 */
export function pendingSpans(
  played: Pick<PlayedSegment, "start" | "end">[],
  segments: { id: string }[],
  status: Record<string, WordsStatus> | undefined,
): { id: string; start: number; end: number }[] {
  if (!status) return [];
  return segments.flatMap((segment, i) =>
    status[segment.id] === "pending" && played[i] ? [{ id: segment.id, start: played[i].start, end: played[i].end }] : [],
  );
}

/** The Segments whose Words failed (their video's transcription), by id. */
export function failedSegments(status: Record<string, WordsStatus> | undefined): Set<string> {
  return new Set(Object.entries(status ?? {}).flatMap(([id, words]) => (words === "failed" ? [id] : [])));
}

/** How long to wait before asking for the Preview Plan again: while any Segment's Words are pending, else never (null). */
export function refreshWhilePending(status: Record<string, WordsStatus> | undefined): number | null {
  return Object.values(status ?? {}).includes("pending") ? PENDING_REFRESH_MS : null;
}

/**
 * Counts `replan` up every so often while any Segment's Words are pending (`refreshWhilePending`),
 * each time after the plan last came, so that the editor plans again until they are there.
 */
export function useReplanWhilePending(status: Record<string, WordsStatus> | undefined, replan: Dispatch<SetStateAction<number>>) {
  const wait = refreshWhilePending(status);
  useEffect(() => {
    if (wait === null) return;
    const timer = setTimeout(() => replan((n) => n + 1), wait);
    return () => clearTimeout(timer);
  }, [wait, status, replan]);
}
