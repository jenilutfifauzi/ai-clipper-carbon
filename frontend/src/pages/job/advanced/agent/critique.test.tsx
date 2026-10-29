// .scratch/agent-chat-ui/issues/10-critique-fixes.md: the critique's fixes, at the seams the ticket agreed.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentProviderListing, AgentUi } from "../../../../api";
import type { AgentTurnView } from "./agentStream";
import { Composer } from "./Composer";
import { agentStatus, cleanError, toolSummary, toolTitle } from "./status";
import type { ToolPart } from "./ToolRow";
import { grouped, TurnView } from "./TurnView";
import { ChoicesCard } from "./ui/ChoicesCard";
import { AgentUiContext, type AgentUiHost } from "./ui/GenerativeUi";

const tool = (name: string, ok: boolean | null): ToolPart => ({ type: "tool", call: name, tool: name, summary: "", ok, error: null, revision: null });

describe("the editor's words for a tool call", () => {
  test("its title: what it is doing, what it did, what it couldn't", () => {
    expect(toolTitle(tool("mcp__ai-clipper__get_transcript", null))).toBe("Reading the transcript");
    expect(toolTitle(tool("mcp__ai-clipper__get_transcript", true))).toBe("Read the transcript");
    expect(toolTitle(tool("edit_candidate", true))).toBe("Edited the Candidate");
    expect(toolTitle(tool("edit_candidate", false))).toBe("Couldn't edit the Candidate");
    expect(toolTitle(tool("mcp__other__fetch_weather", true))).toBe("Fetch weather");
  });

  test("its summary: ranges as times, fields as words, nothing for nothing", () => {
    expect(toolSummary("start=0, end=40")).toBe("0:00–0:40");
    expect(toolSummary("start=12.5, end=75")).toBe("0:12–1:15");
    expect(toolSummary("sets hook_text, kicker")).toBe("hook text, kicker");
    expect(toolSummary("sets nothing")).toBe("");
    expect(toolSummary("kind=style, include_looks=true")).toBe("style · true");
    expect(toolSummary("merges text_layers ×2")).toBe("merges text layers ×2");
  });
});

describe("cleanError", () => {
  test("without the code fence and the tool's prefix", () => {
    expect(cleanError("```\nError executing tool edit_candidate: Kicker is longer than 24 characters\n```")).toBe("Kicker is longer than 24 characters");
    expect(cleanError("No Segment s9")).toBe("No Segment s9");
  });
});

describe("grouped", () => {
  test("leaves out the provider's own meta tools", () => {
    const shown = grouped([tool("ToolSearch", true), tool("mcp__ai-clipper__get_candidate", true), tool("TodoWrite", true)]);
    expect(shown).toEqual([{ type: "tools", parts: [tool("mcp__ai-clipper__get_candidate", true)] }]);
  });
});

const turn = (change: Partial<AgentTurnView> = {}): AgentTurnView => ({
  id: "t1",
  tab: null,
  thread: null,
  provider: "claude-code",
  model: null,
  prompt: "Make the hook punchier",
  parts: [{ type: "text", text: "Done: the hook is shorter." }],
  stop: "end_turn",
  first_revision: 33,
  last_revision: 34,
  error: null,
  ...change,
});
const host = (change: Partial<AgentUiHost> = {}): AgentUiHost => ({ jobId: "j1", candidate: null, busy: false, choose: () => {}, popup: null, ...change });

describe("a turn, quieter", () => {
  test("the Agent's text sits on the panel, no bubble; the owner's keeps its own", () => {
    const html = renderToStaticMarkup(<TurnView turn={turn()} onUndo={async () => {}} />);
    const answer = html.match(/<div[^>]*>(?=<div[^>]*data-markdown)/)?.[0] ?? "";
    expect(answer).not.toContain("bg-fill");
    expect(html).toMatch(/<p class="raised[^"]*"[^>]*>Make the hook punchier/);
  });

  test("a finished turn ends with Copy, Undo, Redo and its revision, always shown", () => {
    const html = renderToStaticMarkup(<TurnView turn={turn()} onUndo={async () => {}} />);
    const footer = html.match(/<div[^>]*data-turn-actions[\s\S]*$/)?.[0] ?? "";
    expect(footer).toContain('aria-label="Copy response"');
    expect(footer).toContain(">Undo<");
    expect(footer).toContain(">Redo<");
    expect(footer).toContain("rev 34");
    expect(footer).not.toContain("opacity-0");
  });

  test("a failed turn says so plainly and offers to try again", () => {
    const sent: string[] = [];
    const html = renderToStaticMarkup(
      <AgentUiContext.Provider value={host({ choose: (prompt) => sent.push(prompt) })}>
        <TurnView turn={turn({ parts: [], stop: "error", error: "```\nError executing tool edit_candidate: No Segment s9\n```", first_revision: null, last_revision: null })} />
      </AgentUiContext.Provider>,
    );
    expect(html).toContain("bg-danger-surface");
    expect(html).toContain("No Segment s9");
    expect(html).not.toContain("```");
    expect(html).toContain(">Try again<");
  });

  test("before anything arrives, it is starting", () => {
    expect(agentStatus(turn({ parts: [], stop: null }))).toBe("Starting…");
  });
});

const deepseek: AgentProviderListing = {
  provider: {
    kind: "api",
    id: "deepseek",
    label: "DeepSeek",
    base_url: "https://api.deepseek.com",
    base_url_editable: false,
    models: ["deepseek-chat"],
    default_model: "deepseek-chat",
    key_env: ["LLM_API_KEY"],
    docs_url: "https://platform.deepseek.com",
    sees_images: false,
  },
  status: { id: "deepseek", ready: true, installed: null, command: null, version: null, login: null, has_key: true, key_source: "saved", base_url: null, model: null },
};
const composer = (running: boolean) =>
  renderToStaticMarkup(
    <Composer providers={[deepseek]} listing={deepseek} models={[]} model={null} onChoose={() => {}} setup={false} setupOpen={false} onSetup={() => {}} busy={running} running={running} onSend={async () => true} onStop={() => {}} />,
  );

describe("the composer, roomier", () => {
  test("its message box starts at one line", () => {
    expect(composer(false)).toMatch(/<textarea[^>]*rows="1"/);
  });

  test("Stop always shows its square, the orb small behind it, and says Esc stops", () => {
    const stop = composer(true).match(/<button[^>]*aria-label="Stop"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(stop).toContain('title="Stop (Esc)"');
    const square = stop.match(/<svg[^>]*lucide-square[^>]*>/)?.[0] ?? "";
    expect(square).not.toBe("");
    expect(square).not.toContain("opacity-0");
    expect(stop).toMatch(/<canvas/);
  });
});

describe("a choice answered in its pop up", () => {
  const hooks: Extract<AgentUi, { kind: "choices" }> = { kind: "choices", title: "Which hook?", options: [{ label: "Short", prompt: "Use the short hook" }, { label: "Long", prompt: "Use the long hook" }] };

  test("its card folds to its title while the pop up is open, and shows its options otherwise", () => {
    const folded = renderToStaticMarkup(<ChoicesCard call="c1" ui={hooks} nextPrompt={null} host={host({ popup: "c1" })} />);
    expect(folded).toContain("Which hook?");
    expect(folded).toContain("Answer below");
    expect(folded).not.toContain("Short");
    expect(renderToStaticMarkup(<ChoicesCard call="c1" ui={hooks} nextPrompt={null} host={host({ popup: "c2" })} />)).toContain("Short");
  });
});
