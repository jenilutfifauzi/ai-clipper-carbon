// .scratch/agent-mode/issues/04-agent-tab.md: the Agent tab's views. A tool row names its tool without
// its `mcp__…__` prefix, and the tab shows the provider's setup until a provider is ready, then the
// composer. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentProviderListing } from "../../../../api";
import { AgentTab } from "./AgentTab";
import { transcriptText } from "./ChatHeader";
import { ToolGroup } from "./ToolGroup";
import { prettyJson, toolLabel, ToolRow, type ToolPart } from "./ToolRow";
import { TurnView } from "./TurnView";
import { EMPTY_STREAM, type AgentTurnView } from "./agentStream";
import type { AgentStream } from "./useAgentStream";

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
    provider: "deepseek",
    model: null,
    prompt: "Add a title",
    parts,
    stop: null,
    first_revision: null,
    last_revision: null,
    error: null,
  });

  test("dots while a turn runs with nothing streaming, none while its text streams", () => {
    expect(renderToStaticMarkup(<TurnView turn={running([])} />)).toContain("The Agent is working");
    const tool = { type: "tool", call: "c1", tool: "edit_candidate", summary: "", ok: true, error: null, revision: 1 } as const;
    expect(renderToStaticMarkup(<TurnView turn={running([tool])} />)).toContain("The Agent is working");
    expect(renderToStaticMarkup(<TurnView turn={running([{ type: "text", text: "Done" }])} />)).not.toContain("The Agent is working");
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
