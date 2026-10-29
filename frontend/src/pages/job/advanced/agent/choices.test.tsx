// .scratch/agent-chat-ui/issues/09-choice-popup.md: the choices pop up, at the seams the ticket agreed.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentUi } from "../../../../api";
import type { AgentTurnView } from "./agentStream";
import { ChoicePopup } from "./ChoicePopup";
import { choiceKey, openChoices } from "./choices";
import type { ToolPart } from "./ToolRow";

type Choices = Extract<AgentUi, { kind: "choices" }>;

const hooks: Choices = {
  kind: "choices",
  title: "Which hook?",
  options: [
    { label: "Short", prompt: "Use the short hook", detail: "Four words" },
    { label: "Long", prompt: "Use the long hook" },
  ],
};
const kickers: Choices = { kind: "choices", title: "Which Kicker?", options: [{ label: "A", prompt: "Kicker A" }, { label: "B", prompt: "Kicker B" }] };

const shown = (call: string, ui: AgentUi): ToolPart => ({ type: "tool", call, tool: "mcp__ai-clipper__show_ui", summary: "", ok: true, error: null, revision: null, ui });
const turn = (id: string, parts: AgentTurnView["parts"], stop: AgentTurnView["stop"] = "end_turn"): AgentTurnView => ({
  id,
  tab: null,
  thread: null,
  provider: "claude-code",
  model: null,
  prompt: "Give me hooks",
  parts,
  stop,
  first_revision: null,
  last_revision: null,
  error: null,
});

describe("openChoices", () => {
  test("the latest finished turn's choices, the last when it showed two", () => {
    expect(openChoices([turn("t1", [{ type: "text", text: "Here:" }, shown("c1", hooks)])])).toEqual({ call: "c1", ui: hooks });
    expect(openChoices([turn("t1", [shown("c1", hooks), shown("c2", kickers)])])).toEqual({ call: "c2", ui: kickers });
  });

  test("none while that turn runs, when it offered none, or once another turn followed", () => {
    expect(openChoices([turn("t1", [shown("c1", hooks)], null)])).toBeNull();
    expect(openChoices([turn("t1", [{ type: "text", text: "Done." }])])).toBeNull();
    expect(openChoices([turn("t1", [shown("c1", hooks)]), turn("t2", [{ type: "text", text: "Used it." }])])).toBeNull();
    expect(openChoices([turn("t1", [shown("c1", { kind: "callout", tone: "info", body: "Note" })])])).toBeNull();
    expect(openChoices([])).toBeNull();
  });
});

describe("choiceKey", () => {
  // Three options, "Something else…" the fourth row (index 3).
  const at = (active: number) => ({ active, count: 3 });

  test("a digit sends its option; the one after the last goes to Something else; past that, nothing", () => {
    expect(choiceKey(at(0), "2")).toEqual({ send: 1 });
    expect(choiceKey(at(2), "1")).toEqual({ send: 0 });
    expect(choiceKey(at(0), "4")).toEqual({ other: true });
    expect(choiceKey(at(0), "5")).toBeNull();
    expect(choiceKey(at(0), "0")).toBeNull();
  });

  test("the arrows move the highlight, round from either end", () => {
    expect(choiceKey(at(0), "ArrowDown")).toEqual({ active: 1 });
    expect(choiceKey(at(3), "ArrowDown")).toEqual({ active: 0 });
    expect(choiceKey(at(0), "ArrowUp")).toEqual({ active: 3 });
  });

  test("Enter sends the highlighted option, or goes to Something else; Escape closes", () => {
    expect(choiceKey(at(1), "Enter")).toEqual({ send: 1 });
    expect(choiceKey(at(3), "Enter")).toEqual({ other: true });
    expect(choiceKey(at(1), "Escape")).toEqual({ close: true });
    expect(choiceKey(at(1), "a")).toBeNull();
  });
});

describe("ChoicePopup", () => {
  test("a dialog named by its title: the numbered options, the first highlighted, Something else, the keys", () => {
    const html = renderToStaticMarkup(<ChoicePopup ui={hooks} onChoose={() => {}} onClose={() => {}} />);
    const title = html.match(/<[^>]*id="([^"]+)"[^>]*>Which hook\?</)?.[1];
    expect(title).toBeTruthy();
    expect(html).toMatch(new RegExp(`role="dialog"[^>]*aria-labelledby="${title}"|aria-labelledby="${title}"[^>]*role="dialog"`));
    const options = [...html.matchAll(/<[^>]*role="option"[^>]*>/g)].map((match) => match[0]);
    expect(options).toHaveLength(3);
    expect(options[0]).toContain('aria-selected="true"');
    expect(options[1]).toContain('aria-selected="false"');
    expect(html).toMatch(/1\.[\s\S]*Short[\s\S]*Four words[\s\S]*2\.[\s\S]*Long[\s\S]*3\.[\s\S]*Something else…/);
    expect(html).toMatch(/<input[^>]*aria-label="Something else"/);
    expect(html).toContain("Esc");
  });
});
