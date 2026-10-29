// .scratch/agent-mode/issues/04-agent-tab.md: the Agent tab's views. A tool row names its tool without
// its `mcp__…__` prefix, and the tab shows the provider's setup until a provider is ready, then the
// composer. No jsdom: the markup is checked with renderToStaticMarkup.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentProviderListing, AgentUi, Candidate } from "../../../../api";
import { AgentTab } from "./AgentTab";
import { transcriptText } from "./ChatHeader";
import { ToolGroup } from "./ToolGroup";
import { prettyJson, toolLabel, ToolRow, type ToolPart } from "./ToolRow";
import { grouped, TurnView } from "./TurnView";
import { EMPTY_STREAM, type AgentTurnView } from "./agentStream";
import type { AgentStream } from "./useAgentStream";
import { frameUrl } from "./ui/CandidateCard";
import { ChoicesCard, emphasized } from "./ui/ChoicesCard";
import { AgentUiContext, GenerativeUi, type AgentUiHost } from "./ui/GenerativeUi";

// The editor's stream, with no turns yet.
const idle: AgentStream = { state: EMPTY_STREAM, running: null, ownTurns: new Set(), lost: false, prompted: () => {}, subscribe: () => () => {} };

const deepseek = (ready: boolean): AgentProviderListing => ({
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
  },
  status: {
    id: "deepseek",
    ready,
    installed: null,
    command: null,
    version: null,
    login: null,
    has_key: ready,
    key_source: ready ? "saved" : null,
    base_url: null,
    model: null,
  },
});

const antigravity: AgentProviderListing = {
  provider: {
    kind: "acp",
    id: "antigravity",
    label: "Antigravity",
    command: ["agy_acp_server"],
    npx_package: null,
    install_hint: "brew install antigravity",
    login: "terminal",
    login_command: ["agy", "login"],
    docs_url: "https://antigravity.google/docs/ide/extensions",
    warning: "Google's terms may not allow a personal Antigravity login to be used from other apps. Use it at your own risk, or use Gemini CLI or a Gemini API key.",
    setup_note: "Choose how Antigravity signs in, in Antigravity's own settings, before its first turn.",
  },
  status: { id: "antigravity", ready: false, installed: false, command: null, version: null, login: null, has_key: null, key_source: null, base_url: null, model: null },
};

describe("ToolRow", () => {
  test("strips the mcp prefix and turns underscores into spaces", () => {
    expect(toolLabel("mcp__ai-clipper__edit_candidate")).toBe("edit candidate");
    expect(toolLabel("read_candidate")).toBe("read candidate");
    const html = renderToStaticMarkup(
      <ToolRow part={{ type: "tool", call: "c1", tool: "mcp__ai-clipper__edit_candidate", summary: "Title at 0s", ok: true, error: null, revision: 3 }} />,
    );
    expect(html).toContain("edit candidate");
    expect(html).not.toContain("mcp__");
    expect(html).toContain("Title at 0s");
  });

  test("a failed call shows its message", () => {
    const html = renderToStaticMarkup(<ToolRow part={{ type: "tool", call: "c1", tool: "edit_candidate", summary: "", ok: false, error: "No Segment s9", revision: null }} />);
    expect(html).toContain("No Segment s9");
  });
});

describe("TurnView", () => {
  test("the prompt with its line breaks, the text, and thoughts folded", () => {
    const html = renderToStaticMarkup(
      <TurnView
        turn={{
          id: "t1",
          tab: null,
          thread: null,
          provider: "deepseek",
          model: null,
          prompt: "Add a title",
          parts: [
            { type: "thought", text: "Hmm" },
            { type: "text", text: "Line one\nLine two" },
          ],
          stop: "end_turn",
          first_revision: null,
          last_revision: null,
          error: null,
        }}
      />,
    );
    expect(html).toContain("Add a title");
    expect(html).toMatch(/<details[^>]*>.*Hmm/s);
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain("data-markdown");
  });

  // .scratch/agent-mode/issues/08: a finished turn that saved Revisions can be reverted and restored.
  const turn = (change: Partial<AgentTurnView>): AgentTurnView => ({
    id: "t1",
    tab: null,
    thread: null,
    provider: "deepseek",
    model: null,
    prompt: "Add a title",
    parts: [],
    stop: "end_turn",
    first_revision: 4,
    last_revision: 6,
    error: null,
    ...change,
  });

  test("a finished turn that saved Revisions offers Revert and Restore", () => {
    const html = renderToStaticMarkup(<TurnView turn={turn({})} onUndo={async () => {}} />);
    expect(html).toContain("Revert");
    expect(html).toContain("Restore");
  });

  test("no Revert or Restore on a running turn, one that saved nothing, or without a handler", () => {
    for (const html of [
      renderToStaticMarkup(<TurnView turn={turn({ stop: null })} onUndo={async () => {}} />),
      renderToStaticMarkup(<TurnView turn={turn({ first_revision: null, last_revision: null })} onUndo={async () => {}} />),
      renderToStaticMarkup(<TurnView turn={turn({})} />),
    ]) {
      expect(html).not.toContain("Revert");
    }
  });
});

// .scratch/agent-chat-ui/issues/01: the open-pencil look.
describe("chat look", () => {
  const running = (parts: AgentTurnView["parts"]): AgentTurnView => ({
    id: "t1",
    tab: null,
    thread: null,
    provider: "deepseek",
    model: null,
    prompt: "Add a title",
    parts,
    stop: null,
    first_revision: null,
    last_revision: null,
    error: null,
  });

  test("a thought streaming last reads Thinking… and is open", () => {
    const html = renderToStaticMarkup(<TurnView turn={running([{ type: "thought", text: "Hmm" }])} />);
    expect(html).toMatch(/<details[^>]*open/);
    expect(html).toContain("Thinking…");
  });

  test("the transcript as text", () => {
    const turn = { ...running([{ type: "text", text: "Added." }]), stop: "end_turn" as const };
    expect(transcriptText([turn])).toBe("You: Add a title\n\nAgent: Added.");
  });
});

// .scratch/agent-chat-ui/issues/03: tool cards that open to their input and output, long runs folded.
describe("tool cards", () => {
  const call = (id: string, change: Partial<ToolPart> = {}): ToolPart => ({
    type: "tool",
    call: id,
    tool: "edit_candidate",
    summary: "sets hook_text",
    ok: true,
    error: null,
    revision: null,
    ...change,
  });

  test("a card with an output starts closed and can open; one with nothing to show can't", () => {
    const closed = renderToStaticMarkup(<ToolRow part={call("c1", { input: '{"a":1}', output: "Saved" })} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("<pre");
    expect(closed).toContain('aria-label="Done"');
    const empty = renderToStaticMarkup(<ToolRow part={call("c1")} />);
    expect(empty).toContain("disabled");
    expect(empty).not.toContain("aria-expanded");
  });

  test("a failed card starts open, its error above its Input/Output switch and the output", () => {
    const html = renderToStaticMarkup(<ToolRow part={call("c1", { ok: false, error: "No Segment s9", input: '{"a":1}', output: '{"b":2}' })} />);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/text-danger[^>]*>No Segment s9.*Input.*Output.*<pre aria-label="Output"/s);
    expect(html).toContain("&quot;b&quot;: 2");
  });

  test("JSON is pretty-printed, anything else shown as it is", () => {
    expect(prettyJson('{"a":[1]}')).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(prettyJson('{"cut": "abc…')).toBe('{"cut": "abc…');
  });

  test("a run of three is three cards; a longer run folds all but its latest into N steps", () => {
    const three = renderToStaticMarkup(<ToolGroup parts={[call("c1"), call("c2"), call("c3")]} />);
    expect(three.match(/data-tool-row/g)).toHaveLength(3);
    expect(three).not.toContain("data-tool-group");

    const five = renderToStaticMarkup(
      <ToolGroup parts={[call("c1"), call("c2", { ok: false, error: "x", tool: "get_candidate" }), call("c3"), call("c4"), call("c5")]} />,
    );
    expect(five).toMatch(/<details data-tool-group="".*4 steps.*edit candidate · get candidate · edit candidate · edit candidate.*1 failed/s);
    expect(five).toContain('aria-label="4 steps, 1 failed"');
    expect(five.match(/data-tool-row/g)).toHaveLength(5);
    // The latest card comes after the folded ones.
    expect(five.lastIndexOf("data-tool-row")).toBeGreaterThan(five.indexOf("</details>"));
  });

  test("a turn groups consecutive tool calls only", () => {
    const turn: AgentTurnView = {
      id: "t1",
      tab: null,
      thread: null,
      provider: "deepseek",
      model: null,
      prompt: "Go",
      parts: [call("c1"), call("c2"), call("c3"), call("c4"), { type: "text", text: "Half way." }, call("c5")],
      stop: "end_turn",
      first_revision: null,
      last_revision: null,
      error: null,
    };
    const html = renderToStaticMarkup(<TurnView turn={turn} />);
    expect(html.match(/data-tool-group/g)).toHaveLength(1);
    expect(html).toContain("3 steps");
    expect(html.match(/data-tool-row/g)).toHaveLength(5);
  });
});

describe("AgentTab", () => {
  test("with no ready provider, the provider's setup", () => {
    const html = renderToStaticMarkup(<AgentTab jobId="j" candidateId="c" stream={idle} initialProviders={[deepseek(false)]} />);
    expect(html).toContain("data-provider-setup");
    expect(html).toContain('type="password"');
    expect(html).not.toContain("data-composer");
  });

  test("with a ready provider, the composer and the example prompts", () => {
    const html = renderToStaticMarkup(<AgentTab jobId="j" candidateId="c" stream={idle} initialProviders={[deepseek(true)]} />);
    expect(html).toContain("data-composer");
    expect(html).not.toContain("data-provider-setup");
    expect(html.match(/data-example/g)).toHaveLength(3);
  });

  test("an ACP provider's setup: its install hint, Login, its warning and what to do first", () => {
    const html = renderToStaticMarkup(<AgentTab jobId="j" candidateId="c" stream={idle} initialProviders={[antigravity]} />);
    expect(html).toContain("brew install antigravity");
    expect(html).toContain("Log in");
    expect(html).toContain("Google&#x27;s terms may not allow a personal Antigravity login to be used from other apps.");
    expect(html).toContain("or use Gemini CLI or a Gemini API key.");
    expect(html).toContain("in Antigravity&#x27;s own settings");
  });
});

// .scratch/agent-chat-ui/issues/05-show-ui.md: a show_ui call's Agent UI is drawn in place of its card.
describe("Agent UI", () => {
  const choices: AgentUi = {
    kind: "choices",
    title: "Which hook?",
    options: [
      { label: "Short", prompt: "Use the short hook", detail: "Four words" },
      { label: "Long", prompt: "Use the long hook" },
    ],
  };
  test("a choice's *words* are shown as Emphasis, an odd last asterisk as it is", () => {
    expect(renderToStaticMarkup(<>{emphasized("Buka 24 jam tapi kok *KEABISAN* terus?!")}</>)).toBe(
      'Buka 24 jam tapi kok <strong class="font-semibold text-text">KEABISAN</strong> terus?!',
    );
    expect(renderToStaticMarkup(<>{emphasized("*a* b *c")}</>)).toBe('<strong class="font-semibold text-text">a</strong> b *c');
  });
  const shown = (call: string, ui: AgentUi): ToolPart => ({ type: "tool", call, tool: "show_ui", summary: "", ok: true, error: null, revision: null, ui });
  const host = (change: Partial<AgentUiHost> = {}): AgentUiHost => ({ jobId: "j1", candidate: null, busy: false, choose: () => {}, ...change });
  const turn = (id: string, prompt: string, parts: AgentTurnView["parts"]): AgentTurnView => ({
    id,
    tab: null,
    thread: null,
    provider: "deepseek",
    model: null,
    prompt,
    parts,
    stop: "end_turn",
    first_revision: null,
    last_revision: null,
    error: null,
  });

  // The <button>s of an element tree, as ChoicesCard returns it.
  function buttons(node: ReactNode): ReactElement<{ disabled?: boolean; onClick: () => void }>[] {
    if (Array.isArray(node)) return node.flatMap(buttons);
    if (!isValidElement<{ children?: ReactNode; disabled?: boolean; onClick: () => void }>(node)) return [];
    return [...(node.type === "button" ? [node] : []), ...buttons(node.props.children)];
  }

  test("clicking a choice sends its prompt", () => {
    const sent: string[] = [];
    const card = ChoicesCard({ ui: choices as Extract<AgentUi, { kind: "choices" }>, nextPrompt: null, host: host({ choose: (prompt) => sent.push(prompt) }) });
    const [short, long] = buttons(card);
    expect([short.props.disabled, long.props.disabled]).toEqual([false, false]);
    long.props.onClick();
    expect(sent).toEqual(["Use the long hook"]);
  });

  test("the options are disabled while a turn runs and once the Thread goes on, the one sent marked chosen", () => {
    const ui = choices as Extract<AgentUi, { kind: "choices" }>;
    expect(buttons(ChoicesCard({ ui, nextPrompt: null, host: host({ busy: true }) })).every((button) => button.props.disabled)).toBe(true);
    expect(buttons(ChoicesCard({ ui, nextPrompt: "Something else", host: host() })).every((button) => button.props.disabled)).toBe(true);

    // In the chat: the turn after it sent the short one's prompt.
    const html = renderToStaticMarkup(
      <AgentUiContext.Provider value={host()}>
        <TurnView turn={turn("t1", "Offer hooks", [shown("c1", choices)])} nextPrompt="Use the short hook" />
      </AgentUiContext.Provider>,
    );
    expect(html).toContain('data-agent-ui="choices"');
    expect(html).not.toContain("data-tool-row");
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    expect(html).toMatch(/border-text\/40.*Short.*, chosen/s);
    expect(html.match(/, chosen/g)).toHaveLength(1);
  });

  test("an unknown kind renders nothing", () => {
    expect(renderToStaticMarkup(<GenerativeUi ui={{ kind: "chart" } as unknown as AgentUi} nextPrompt={null} />)).toBe("");
  });

  test("an Agent UI breaks a run of tool calls and is never folded into N steps", () => {
    const call = (id: string): ToolPart => ({ type: "tool", call: id, tool: "edit_candidate", summary: "", ok: true, error: null, revision: null });
    const parts = [call("c1"), call("c2"), shown("c3", choices), call("c4"), call("c5"), call("c6"), call("c7")];
    expect(grouped(parts).map((each) => each.type)).toEqual(["tools", "ui", "tools"]);
    const html = renderToStaticMarkup(<TurnView turn={turn("t1", "Go", parts)} />);
    expect(html.match(/data-tool-group/g)).toHaveLength(1);
    expect(html.match(/data-agent-ui/g)).toHaveLength(1);
  });

  test("a table, labelled values and a callout with its Markdown body and checklist", () => {
    const table = renderToStaticMarkup(<GenerativeUi ui={{ kind: "table", columns: ["Part", "Secs"], rows: [["Intro", 3.5]] }} nextPrompt={null} />);
    expect(table).toMatch(/<th[^>]*>Part<\/th>.*<td[^>]*>3.5<\/td>/s);
    const values = renderToStaticMarkup(<GenerativeUi ui={{ kind: "key_values", items: [{ label: "Length", value: 42 }] }} nextPrompt={null} />);
    expect(values).toMatch(/<dt[^>]*>Length<\/dt><dd[^>]*>42<\/dd>/);
    const callout = renderToStaticMarkup(
      <GenerativeUi
        ui={{ kind: "callout", tone: "danger", title: "Too long", body: "Cut **two** seconds.", checklist: [{ text: "Trim the end", done: true }] }}
        nextPrompt={null}
      />,
    );
    expect(callout).toContain("text-danger");
    expect(callout).toContain("<strong>two</strong>");
    expect(callout).toContain("Trim the end<span class=\"sr-only\">, done</span>");
  });

  test("the Candidate as the editor holds it, with the Agent's note and the frame it saved", () => {
    const candidate = {
      id: "c1",
      title: "Why we ship",
      start: 12,
      end: 40,
      origin: "ai",
      edited: false,
      emotion: null,
      hook_strength: 8,
      predicted_score: 77,
      aspect: "9:16",
      hook_text: "Ship it *today*",
    } as unknown as Candidate;
    const html = renderToStaticMarkup(
      <AgentUiContext.Provider value={host({ candidate: { value: candidate, name: "Why we ship" } })}>
        <GenerativeUi ui={{ kind: "candidate", note: "Hook moved up", frame: "/data/jobs/j1/exports/c1-00.03.00.png" }} nextPrompt={null} />
      </AgentUiContext.Provider>,
    );
    expect(html).toContain("Why we ship");
    expect(html).toContain("Score 77 out of 100");
    expect(html).toContain("Ship it *today*");
    expect(html).toContain("Hook moved up");
    expect(html).toContain('src="/media/j1/exports/c1-00.03.00.png"');
    expect(frameUrl("j1", "/elsewhere/c1.png")).toBeNull();
    // Without a Candidate to show (outside the Advanced Edit), nothing.
    expect(renderToStaticMarkup(<GenerativeUi ui={{ kind: "candidate" }} nextPrompt={null} />)).toBe("");
  });
});
