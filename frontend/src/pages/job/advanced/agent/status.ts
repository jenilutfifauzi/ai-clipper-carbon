import type { AgentTurnView } from "./agentStream";
import { formatClock } from "../../../../format";
import { toolLabel, type ToolPart } from "./ToolRow";

// Each of the Agent's tools in the editor's words, by its name (its MCP prefix aside): what it is
// doing while it runs, what it did, and what it couldn't do.
const TOOL_WORDS: Record<string, [doing: string, done: string, failed: string]> = {
  get_candidate: ["Reading the Candidate", "Read the Candidate", "Couldn't read the Candidate"],
  edit_candidate: ["Editing the Candidate", "Edited the Candidate", "Couldn't edit the Candidate"],
  merge_candidate_items: ["Editing the Candidate", "Edited the Candidate", "Couldn't edit the Candidate"],
  remove_candidate_items: ["Editing the Candidate", "Edited the Candidate", "Couldn't edit the Candidate"],
  get_transcript: ["Reading the transcript", "Read the transcript", "Couldn't read the transcript"],
  get_media_words: ["Reading the transcript", "Read the transcript", "Couldn't read the transcript"],
  list_assets: ["Looking through the library", "Looked through the library", "Couldn't open the library"],
  list_presets: ["Looking through the library", "Looked through the library", "Couldn't open the library"],
  apply_template: ["Applying a Template", "Applied a Template", "Couldn't apply the Template"],
  generate_speech: ["Generating speech", "Generated speech", "Couldn't generate speech"],
  save_frame: ["Saving a frame", "Saved a frame", "Couldn't save a frame"],
  list_candidate_revisions: ["Checking the Revisions", "Checked the Revisions", "Couldn't check the Revisions"],
  restore_candidate_revision: ["Checking the Revisions", "Restored a Revision", "Couldn't restore the Revision"],
  show_ui: ["Laying it out", "Laid it out", "Couldn't lay it out"],
};

// The tool's own name, its MCP prefix aside.
const bareName = (tool: string) => toolLabel(tool).replaceAll(" ", "_");

/**
 * A tool call's title, in the editor's words: what it is doing while it runs, then what it did or
 * couldn't do. A tool this chat has no words for is its name, as a sentence.
 */
export function toolTitle(part: ToolPart): string {
  const words = TOOL_WORDS[bareName(part.tool)];
  if (!words) {
    const label = toolLabel(part.tool);
    return label.charAt(0).toUpperCase() + label.slice(1);
  }
  return words[part.ok === null ? 0 : part.ok ? 1 : 2];
}

/**
 * A call's summary (the backend's tool_summary) in the editor's terms: a range as times, the fields
 * an edit sets as words, nothing for "sets nothing", other arguments by their values.
 */
export function toolSummary(summary: string): string {
  const range = summary.match(/\bstart=([\d.]+)\b.*\bend=([\d.]+)/);
  if (range) return `${formatClock(Math.floor(Number(range[1])))}–${formatClock(Math.floor(Number(range[2])))}`;
  if (summary === "sets nothing") return "";
  if (summary.startsWith("sets ")) return summary.slice(5).replaceAll("_", " ");
  const pairs = summary.split(/,\s*/).map((pair) => pair.match(/^\w+=(.*)$/));
  if (pairs.length > 0 && pairs.every(Boolean)) return pairs.map((pair) => pair![1].replaceAll("_", " ")).join(" · ");
  return summary.replaceAll("_", " ");
}

/** A tool's error as the owner reads it: without its code fence or the "Error executing tool X:" prefix. */
export function cleanError(raw: string): string {
  return raw
    .replace(/^\s*```\w*\n?|\n?```\s*$/g, "")
    .replace(/^Error executing tool [\w-]+:\s*/, "")
    .trim();
}

/**
 * What a running turn's status line says it is doing, from its last part: starting before anything
 * arrives, then thinking, writing, a tool's verb while that tool runs, working between steps. Null once the
 * turn has stopped.
 */
export function agentStatus(turn: AgentTurnView): string | null {
  if (turn.stop !== null) return null;
  const last = turn.parts.at(-1);
  if (!last) return "Starting…";
  if (last.type === "thought") return "Thinking…";
  if (last.type === "text") return "Writing…";
  if (last.ok !== null) return "Working…";
  const words = TOOL_WORDS[bareName(last.tool)];
  return words ? `${words[0]}…` : `Running ${toolLabel(last.tool)}…`;
}

/** A finished thought's header: how long it streamed, a second at least; just "Thought" when untimed (history). */
export function thoughtLabel(seconds: number | null): string {
  return seconds === null ? "Thought" : `Thought for ${Math.max(1, Math.round(seconds))}s`;
}
