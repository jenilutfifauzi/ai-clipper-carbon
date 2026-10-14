import type { Candidate } from "../../../api";

/** What the Advanced Edit changes of a Candidate, saved and undone together. */
export type AdvancedEdits = Pick<Candidate, "hook_start" | "hook_secs" | "text_layers" | "music" | "source_volume">;

export function editsOf(candidate: Candidate): AdvancedEdits {
  const { hook_start, hook_secs, text_layers, music, source_volume } = candidate;
  return { hook_start, hook_secs, text_layers, music, source_volume };
}

/** The item the inspector shows: the hook, the Clip's video, or a Text Layer or Music Clip. */
export type Selection = { kind: "hook" } | { kind: "video" } | { kind: "text"; id: string } | { kind: "music"; id: string } | null;

export const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);
