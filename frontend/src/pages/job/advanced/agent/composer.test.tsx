// .scratch/agent-chat-ui/issues/06-calm-composer.md: the composer's markup, at the seams the ticket
// agreed. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentProviderListing, AgentUi } from "../../../../api";
import type { AgentTurnView } from "./agentStream";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { TurnView } from "./TurnView";
import { ChoicesCard } from "./ui/ChoicesCard";

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
  },
  status: { id: "deepseek", ready: true, installed: null, command: null, version: null, login: null, has_key: true, key_source: "saved", base_url: null, model: null },
};

const composer = (change: { running?: boolean } = {}) =>
  renderToStaticMarkup(
    <Composer
      providers={[deepseek]}
      listing={deepseek}
      models={["deepseek-chat"]}
      model="deepseek-chat"
      onChoose={() => {}}
      setup={false}
      setupOpen={false}
      onSetup={() => {}}
      busy={false}
      running={change.running ?? false}
      onSend={async () => true}
      onStop={() => {}}
    />,
  );

describe("Composer", () => {
  test("its toolbar reads Provider, Model, set-up, Send", () => {
    const html = composer();
    const at = (needle: string) => html.indexOf(needle);
    expect(at('title="Provider"')).toBeGreaterThan(-1);
    expect(at('title="Provider"')).toBeLessThan(at('title="Model"'));
    expect(at('title="Model"')).toBeLessThan(at('aria-label="Set up DeepSeek"'));
    expect(at('aria-label="Set up DeepSeek"')).toBeLessThan(at('aria-label="Send"'));
  });

  // The <button> carrying `label`, as markup.
  const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

  test("Send is a round button, off while there is nothing to send", () => {
    const send = button(composer(), "Send");
    expect(send).toContain("rounded-full");
    expect(send).toMatch(/ disabled=""/);
  });

  test("while a turn runs, a round Stop takes Send's place", () => {
    const html = composer({ running: true });
    expect(button(html, "Send")).toBe("");
    expect(button(html, "Stop")).toContain("rounded-full");
  });

  // .scratch/agent-chat-ui/issues/08-thinking-orb.md
  test("while a turn runs, Stop holds the turning orb and, under it, the square it shows on hover", () => {
    const html = composer({ running: true });
    const stop = html.match(/<button[^>]*aria-label="Stop"[\s\S]*?<\/button>/)?.[0] ?? "";
    expect(stop).toMatch(/<canvas[^>]*aria-hidden="true"/);
    expect(stop).toContain("lucide-square");
  });

  test("the message box is a form's, its text 16px so iOS doesn't zoom in on it", () => {
    const html = composer();
    const form = html.match(/<form[\s\S]*<\/form>/)?.[0] ?? "";
    const area = form.match(/<textarea[^>]*>/)?.[0] ?? "";
    expect(area).toContain('aria-label="Message the Agent"');
    expect(area).toMatch(/\btext-base\b/);
    expect(button(form, "Send")).toContain('type="submit"');
  });
});

// The Agent's chat keeps the app's orange for nothing: its controls and bubbles are neutral.
describe("the chat without orange", () => {
  const turn: AgentTurnView = {
    id: "t1",
    tab: null,
    thread: null,
    provider: "deepseek",
    model: null,
    prompt: "Make the hook punchier",
    parts: [{ type: "text", text: "Done." }],
    stop: "end_turn",
    first_revision: null,
    last_revision: null,
    error: null,
  };
  const choices: Extract<AgentUi, { kind: "choices" }> = {
    kind: "choices",
    title: "Which hook?",
    options: [
      { label: "A *short* one", prompt: "Use the short hook" },
      { label: "A long one", prompt: "Use the long hook" },
    ],
  };

  test.each([
    ["the composer", () => composer()],
    ["the composer while a turn runs", () => composer({ running: true })],
    ["the header", () => renderToStaticMarkup(<ChatHeader turns={[turn]} />)],
    ["the owner's bubble", () => renderToStaticMarkup(<TurnView turn={turn} onUndo={async () => {}} />)],
    [
      "a choice made, with Emphasis",
      () => renderToStaticMarkup(<ChoicesCard ui={choices} nextPrompt="Use the short hook" host={{ jobId: "j1", candidate: null, busy: false, choose: () => {} }} />),
    ],
  ])("%s", (_, html) => {
    expect(html()).not.toMatch(/accent/);
  });
});
