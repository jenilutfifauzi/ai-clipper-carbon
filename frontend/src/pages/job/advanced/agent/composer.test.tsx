// .scratch/agent-chat-ui/issues/06-calm-composer.md: the composer's markup, at the seams the ticket
// agreed. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentAttachment, AgentProviderListing, AgentUi } from "../../../../api";
import type { AgentTurnView } from "./agentStream";
import { attachTextFiles, MAX_ATTACHMENTS } from "./attachments";
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

const composer = (change: { running?: boolean; attachments?: AgentAttachment[] } = {}) =>
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
      defaultAttachments={change.attachments}
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

// .scratch/agent-attachments/issues/01: the + menu and text-file Agent Attachments.
describe("the composer's attachments", () => {
  const brief: AgentAttachment = { kind: "text", name: "brief.md", text: "Short hooks only." };
  const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

  test("a + first in the toolbar, labelled Add to message, opens a menu offering a text file", () => {
    const html = composer();
    const plus = button(html, "Add to message");
    expect(plus).toContain('aria-haspopup="menu"');
    expect(html.indexOf('aria-label="Add to message"')).toBeLessThan(html.indexOf('title="Provider"'));
    expect(html).toContain("lucide-plus");
    const menu = html.match(/<div[^>]*role="menu"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(menu).toContain('aria-label="Add to message"');
    expect(menu).toMatch(/role="menuitem"[^>]*>.*Add text file/s);
  });

  test("a hidden file input takes several text files of the kinds the Agent reads", () => {
    const input = composer().match(/<input[^>]*type="file"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('accept=".txt,.md,.srt,.vtt,.json,.csv"');
    expect(input).toContain("multiple");
    expect(input).toMatch(/\bhidden\b/);
  });

  test("attached files are chips above the message box, each with a ×; none, no chip row", () => {
    const html = composer({ attachments: [brief, { ...brief, name: "style.txt" }] });
    expect(html.indexOf("brief.md")).toBeGreaterThan(-1);
    expect(html.indexOf("brief.md")).toBeLessThan(html.indexOf("<textarea"));
    expect(html.indexOf("style.txt")).toBeLessThan(html.indexOf("<textarea"));
    expect(button(html, "Remove brief.md")).toContain('type="button"');
    expect(button(html, "Remove style.txt")).not.toBe("");
    expect(composer()).not.toContain("data-attachments");
  });

  test("a message still needs words: Send stays off with only a file", () => {
    expect(button(composer({ attachments: [brief] }), "Send")).toMatch(/ disabled=""/);
  });

  const file = (name: string, text: BlobPart) => new File([text], name);

  test("a text file is attached as its name and text", async () => {
    const added = await attachTextFiles([], [file("brief.md", "Short hooks only."), file("subs.SRT", "1\n00:00 --> 00:01\nHi")]);
    expect(added).toEqual({
      attached: [
        { kind: "text", name: "brief.md", text: "Short hooks only." },
        { kind: "text", name: "subs.SRT", text: "1\n00:00 --> 00:01\nHi" },
      ],
      error: null,
    });
  });

  test("a file too big or not text isn't attached, and says why; the others are", async () => {
    const big = await attachTextFiles([brief], [file("huge.txt", "x".repeat(50 * 1024 + 1)), file("ok.txt", "fine")]);
    expect(big.attached.map((each) => each.name)).toEqual(["brief.md", "ok.txt"]);
    expect(big.error).toBe("huge.txt is over 50 KB.");

    const pdf = await attachTextFiles([], [file("deck.pdf", "%PDF")]);
    expect(pdf).toEqual({ attached: [], error: "deck.pdf isn't a text file: attach a .txt, .md, .srt, .vtt, .json or .csv." });

    const binary = await attachTextFiles([], [file("data.json", new Uint8Array([0x7b, 0, 0x7d]))]);
    expect(binary.error).toBe("data.json isn't a text file: attach a .txt, .md, .srt, .vtt, .json or .csv.");
  });

  test(`at most ${MAX_ATTACHMENTS} go with a message, told when there are more`, async () => {
    const five = Array.from({ length: 5 }, (_, n) => ({ ...brief, name: `${n}.md` }));
    const added = await attachTextFiles(five, [file("a.md", "a"), file("b.md", "b")]);
    expect(added.attached.map((each) => each.name)).toEqual(["0.md", "1.md", "2.md", "3.md", "4.md", "a.md"]);
    expect(added.error).toBe(`At most ${MAX_ATTACHMENTS} attachments go with a message.`);
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
      () => renderToStaticMarkup(<ChoicesCard call="c1" ui={choices} nextPrompt="Use the short hook" host={{ jobId: "j1", candidate: null, busy: false, choose: () => {} }} />),
    ],
  ])("%s", (_, html) => {
    expect(html()).not.toMatch(/accent/);
  });
});
