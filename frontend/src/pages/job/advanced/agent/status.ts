import type { AgentTurnView } from "./agentStream";
import { toolLabel } from "./ToolRow";

// What the Agent is doing while each of its tools runs, by the tool's name (its MCP prefix aside).
const TOOL_VERBS: Record<string, string> = {
  get_candidate: "Reading the Candidate…",
  edit_candidate: "Editing the Candidate…",
  merge_candidate_items: "Editing the Candidate…",
  remove_candidate_items: "Editing the Candidate…",
  get_transcript: "Reading the transcript…",
  get_media_words: "Reading the transcript…",
  list_assets: "Looking through the library…",
  list_presets: "Looking through the library…",
  apply_template: "Applying a Template…",
  generate_speech: "Generating speech…",
  save_frame: "Saving a frame…",
  list_candidate_revisions: "Checking the Revisions…",
  restore_candidate_revision: "Checking the Revisions…",
  show_ui: "Laying it out…",
};

/**
 * What a running turn's status line says it is doing, from its last part: thinking, writing, a tool's
 * verb while that tool runs, else working (before anything arrives and between steps). Null once the
 * turn has stopped.
 */
export function agentStatus(turn: AgentTurnView): string | null {
  if (turn.stop !== null) return null;
  const last = turn.parts.at(-1);
  if (!last) return "Working…";
  if (last.type === "thought") return "Thinking…";
  if (last.type === "text") return "Writing…";
  if (last.ok !== null) return "Working…";
  const name = toolLabel(last.tool).replaceAll(" ", "_");
  return TOOL_VERBS[name] ?? `Running ${toolLabel(last.tool)}…`;
}

/** A finished thought's header: how long it streamed, a second at least; just "Thought" when untimed (history). */
export function thoughtLabel(seconds: number | null): string {
  return seconds === null ? "Thought" : `Thought for ${Math.max(1, Math.round(seconds))}s`;
}
