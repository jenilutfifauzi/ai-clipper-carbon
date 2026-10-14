import type { Candidate } from "../../../api";

/** What the Advanced Edit changes of a Candidate, saved and undone together. */
export type AdvancedEdits = Pick<Candidate, "hook_start" | "hook_secs">;

export function editsOf(candidate: Candidate): AdvancedEdits {
  return { hook_start: candidate.hook_start, hook_secs: candidate.hook_secs };
}

/** The item the inspector shows. */
export type Selection = { kind: "hook" } | null;

export const sameSelection = (a: Selection, b: Selection) => JSON.stringify(a) === JSON.stringify(b);
