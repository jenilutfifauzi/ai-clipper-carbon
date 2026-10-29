// .scratch/agent-chat-ui/issues/04-threads.md: Agent Threads. Switching Threads reloads the transcript,
// a chat shows only its Thread's turns, and the header lists the Threads. No jsdom: the markup is
// checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { AgentEvent, AgentThread, AgentTranscriptTurn } from "../../../../api";
import { agentStream, EMPTY_STREAM, runningTurn, threadTurns, type AgentStreamAction, type AgentStreamState } from "./agentStream";
import { ChatHeader } from "./ChatHeader";
import { matchingThreads, pickThread, rememberedThread, type AgentThreads } from "./threads";
import { loadThread } from "./useAgentStream";

const kept = (id: string, prompt: string): AgentTranscriptTurn => ({
  id,
  provider: "deepseek",
  model: null,
  prompt,
  parts: [{ type: "text", text: "Ok" }],
  first_revision: null,
  last_revision: null,
  stop: "end_turn",
  started_at: "2026-10-29T00:00:00Z",
});

const thread = (id: string, title: string, updated_at = "2026-10-29T00:00:00Z"): AgentThread => ({ id, title, created_at: updated_at, updated_at });

// The transcripts the fake backend answers with, by Thread, and each request made.
function backend(transcripts: Record<string, AgentTranscriptTurn[]>) {
  const asked: string[] = [];
  const answers: (() => void)[] = [];
  const transcript = (_job: string, _candidate: string, id: string) => {
    asked.push(id);
    return new Promise<AgentTranscriptTurn[]>((resolve) => answers.push(() => resolve(transcripts[id] ?? [])));
  };
  return { asked, answers, transcript };
}

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe("switching Threads", () => {
  test("reloads the transcript, and the chat shows only the open Thread's turns", async () => {
    const { asked, answers, transcript } = backend({ a: [kept("t1", "In A")], b: [kept("t2", "In B")] });
    let state: AgentStreamState = EMPTY_STREAM;
    const dispatch = (action: AgentStreamAction) => void (state = agentStream(state, action));

    loadThread("job", "cand", "a", dispatch, transcript);
    answers.shift()?.();
    await flush();
    expect(threadTurns(state.turns, "a").map((turn) => turn.prompt)).toEqual(["In A"]);

    loadThread("job", "cand", "b", dispatch, transcript);
    answers.shift()?.();
    await flush();
    expect(asked).toEqual(["a", "b"]);
    expect(threadTurns(state.turns, "b").map((turn) => turn.prompt)).toEqual(["In B"]);
    // Back to A: loaded again, still A's alone.
    loadThread("job", "cand", "a", dispatch, transcript);
    answers.shift()?.();
    await flush();
    expect(asked).toEqual(["a", "b", "a"]);
    expect(threadTurns(state.turns, "a").map((turn) => turn.prompt)).toEqual(["In A"]);
  });

  test("an answer for a Thread switched away from before it came is dropped", async () => {
    const { answers, transcript } = backend({ a: [kept("t1", "In A")] });
    const heard: AgentStreamAction[] = [];

    const drop = loadThread("job", "cand", "a", (action) => heard.push(action), transcript);
    drop();
    answers.shift()?.();
    await flush();

    expect(heard).toEqual([]);
    // No Thread open yet: nothing is asked.
    loadThread("job", "cand", null, (action) => heard.push(action), transcript);
    expect(answers).toHaveLength(0);
  });

  test("another Thread's running turn isn't shown, but still runs for the Stop button", () => {
    const started: AgentEvent = { type: "turn_started", turn: "t9", tab: "tab-a", thread: "a", provider: "deepseek", model: null, prompt: "Long one" };
    const state = [started, { type: "transcript", turns: [kept("t2", "In B")], thread: "b" } as AgentStreamAction].reduce(agentStream, EMPTY_STREAM);

    expect(threadTurns(state.turns, "b").map((turn) => turn.id)).toEqual(["t2"]);
    expect(runningTurn(state, "tab-a")?.id).toBe("t9");
  });

  test("a prompt sent from the chat is its Thread's", () => {
    const state = agentStream(EMPTY_STREAM, { type: "prompted", turn: "t1", prompt: "Hi", thread: "b" });
    expect(threadTurns(state.turns, "b")).toHaveLength(1);
    expect(threadTurns(state.turns, "a")).toHaveLength(0);
  });
});

describe("threads", () => {
  test("the remembered Thread while it is listed, else the newest", () => {
    const listed = [thread("b", "Newer"), thread("a", "Older")];
    expect(pickThread(listed, "a")?.id).toBe("a");
    expect(pickThread(listed, "gone")?.id).toBe("b");
    expect(pickThread(listed, null)?.id).toBe("b");
    expect(pickThread([], "a")).toBeNull();
  });

  test("search matches titles in any case", () => {
    const listed = [thread("b", "Bigger captions"), thread("a", "Title over the intro")];
    expect(matchingThreads(listed, "  CAPTIONS ").map((each) => each.id)).toEqual(["b"]);
    expect(matchingThreads(listed, "")).toHaveLength(2);
  });

  test("without storage, no Thread is remembered", () => {
    expect(rememberedThread("job", "cand")).toBeNull();
  });
});

describe("ChatHeader", () => {
  const threads: AgentThreads = {
    threads: [thread("b", "Bigger captions"), thread("a", "Title over the intro", "2026-10-28T00:00:00Z")],
    active: thread("a", "Title over the intro", "2026-10-28T00:00:00Z"),
    error: null,
    select: () => {},
    create: async () => {},
    rename: async () => {},
    remove: async () => {},
    refresh: () => {},
  };

  test("names the open Thread, lists them newest first with the open one marked, and offers a new one", () => {
    const html = renderToStaticMarkup(<ChatHeader turns={[]} threads={threads} />);
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*>.*Title over the intro/s);
    expect(html).toContain('aria-label="New chat"');
    expect(html).toContain('aria-label="Search chats"');
    expect(html.indexOf('data-thread="b"')).toBeLessThan(html.indexOf('data-thread="a"'));
    expect(html).toMatch(/data-thread="a" aria-current="true"/);
    expect(html).not.toMatch(/data-thread="b" aria-current/);
    expect(html).toContain("Rename");
    expect(html).toContain("Delete chat");
  });

  test("without Threads, it is the Agent's chat with Copy transcript alone", () => {
    const html = renderToStaticMarkup(<ChatHeader turns={[]} />);
    expect(html).toContain("Agent");
    expect(html).not.toContain("New chat");
    expect(html).not.toContain("Delete chat");
  });
});
