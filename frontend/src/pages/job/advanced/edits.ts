import { piecesOf, type Candidate } from "../../../api";

/**
 * What the Advanced Edit changes of a Candidate, saved and undone together. Its Main Track is always
 * its Segments here, one for a Clip that isn't cut (the backend keeps that one as `start` and `end`).
 */
export type AdvancedEdits = Pick<
  Candidate,
  "hook_start" | "hook_secs" | "text_layers" | "music" | "source_volume" | "segments" | "overlays"
>;

export function editsOf(candidate: Candidate): AdvancedEdits {
  const { hook_start, hook_secs, text_layers, music, source_volume, overlays } = candidate;
  return { hook_start, hook_secs, text_layers, music, source_volume, overlays, segments: piecesOf(candidate) };
}

/** The item the inspector shows: the hook, the Clip's video, or a Text Layer or Music Clip. */
export type Selection =
  | { kind: "hook" }
  | { kind: "segment"; id: string }
  | { kind: "text"; id: string }
  | { kind: "music"; id: string }
  | { kind: "overlay"; id: string }
  | null;

export const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);
