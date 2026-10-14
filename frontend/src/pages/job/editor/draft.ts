import type { Candidate, CandidateChange } from "../../../api";

/**
 * Every edit of the Candidate that its Clip shows, as a draft for its Preview Plan. The clip editor
 * and the Advanced Edit lay their unsaved changes over it.
 */
export function candidateDraft(candidate: Candidate): CandidateChange {
  return {
    hook_text: candidate.hook_text,
    hook_kicker: candidate.hook_kicker,
    layout: candidate.layout,
    preset_id: candidate.preset_id,
    style_overrides: candidate.style_overrides,
    word_edits: candidate.word_edits,
    hook_start: candidate.hook_start,
    hook_secs: candidate.hook_secs,
    layout_overrides: candidate.layout_overrides,
    text_layers: candidate.text_layers,
    music: candidate.music,
    source_volume: candidate.source_volume,
  };
}
