// .scratch/agent-mode/issues/04-agent-tab.md: the Agent tab's views. A tool row names its tool without
// its `mcp__…__` prefix, and the tab shows the provider's setup until a provider is ready, then the
// composer. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentProviderListing } from "../../../../api";
import { AgentTab } from "./AgentTab";
import { toolLabel, ToolRow } from "./ToolRow";
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
    docs_url: "https://example.com",
    warning: "Google's terms may not allow a personal login through other apps.",
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
  test("the prompt, text with its line breaks, and thoughts folded", () => {
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

  test("an ACP provider's setup: its install hint, Login and its warning", () => {
    const html = renderToStaticMarkup(<AgentTab jobId="j" candidateId="c" stream={idle} initialProviders={[antigravity]} />);
    expect(html).toContain("brew install antigravity");
    expect(html).toContain("Log in");
    expect(html).toContain("Google&#x27;s terms");
  });
});
