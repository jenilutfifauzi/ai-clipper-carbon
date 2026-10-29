// .scratch/agent-chat-ui/issues/07-status-line.md: the live status line, at the seams the ticket agreed.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentTurnView } from "./agentStream";
import { agentStatus, thoughtLabel } from "./status";
import type { ToolPart } from "./ToolRow";
import { TurnView } from "./TurnView";

const turn = (parts: AgentTurnView["parts"], stop: AgentTurnView["stop"] = null): AgentTurnView => ({
  id: "t1",
  tab: null,
  thread: null,
  provider: "claude-code",
  model: null,
  prompt: "Make the hook punchier",
  parts,
  stop,
  first_revision: null,
  last_revision: null,
  error: null,
});
const tool = (name: string, ok: boolean | null): ToolPart => ({ type: "tool", call: "c1", tool: name, summary: "", ok, error: null, revision: null });

describe("agentStatus", () => {
  test.each([
    ["nothing yet", [], "Working…"],
    ["a thought streaming", [{ type: "thought", text: "Hmm" }], "Thinking…"],
    ["text streaming", [{ type: "text", text: "Here" }], "Writing…"],
    ["a call running", [tool("edit_candidate", null)], "Editing the Candidate…"],
    ["a prefixed call running", [tool("mcp__ai-clipper__get_transcript", null)], "Reading the transcript…"],
    ["a tool it has no verb for", [tool("mcp__other__fetch_weather", null)], "Running fetch weather…"],
    ["between steps", [tool("get_candidate", true)], "Working…"],
  ] as [string, AgentTurnView["parts"], string][])("%s", (_, parts, label) => {
    expect(agentStatus(turn(parts))).toBe(label);
  });

  test("none once the turn has stopped", () => {
    expect(agentStatus(turn([{ type: "text", text: "Done." }], "end_turn"))).toBeNull();
  });
});

describe("thoughtLabel", () => {
  test("how long the Agent thought, a second at least; just Thought when it wasn't timed", () => {
    expect(thoughtLabel(0.3)).toBe("Thought for 1s");
    expect(thoughtLabel(4.4)).toBe("Thought for 4s");
    expect(thoughtLabel(null)).toBe("Thought");
  });
});

describe("the status line in a turn", () => {
  test("a running turn says what the Agent is doing, moving only where motion is welcome", () => {
    const html = renderToStaticMarkup(<TurnView turn={turn([tool("edit_candidate", null)])} />);
    const line = html.match(/<div[^>]*data-agent-status[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(line).toContain('role="status"');
    expect(line).toContain("Editing the Candidate…");
    expect(html).not.toContain("animate-bounce");
    // Every animation is the motion-safe variant: none of them runs for an owner who asked for less motion.
    expect(html.match(/(?<![\w-]:)animate-\[?[\w-]+/g) ?? []).toEqual([]);
  });

  test("a finished turn has none", () => {
    expect(renderToStaticMarkup(<TurnView turn={turn([{ type: "text", text: "Done." }], "end_turn")} />)).not.toContain("data-agent-status");
  });
});
