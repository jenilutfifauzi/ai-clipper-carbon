// .scratch/agent-mode/issues/04-agent-tab.md: the Agent tab's pure reducer folds an Agent Turn's
// events into turns and their parts, and loads the Candidate's chat.
import { describe, expect, test } from "vitest";
import type { AgentEvent, AgentTranscriptTurn } from "../../../../api";
import { agentStream, EMPTY_STREAM, loadTranscript, ownTurns, runningTurn, type AgentStreamAction, type AgentStreamState } from "./agentStream";

const fold = (actions: AgentStreamAction[], from: AgentStreamState = EMPTY_STREAM) => actions.reduce(agentStream, from);

const started: AgentEvent = { type: "turn_started", turn: "t1", tab: "tab-a", provider: "deepseek", model: "deepseek-chat" };

describe("agentStream", () => {
  test("a scripted turn gives one turn with text, a thought, and a tool row that goes from running to done", () => {
    const running = fold([
      started,
      { type: "prompted", turn: "t1", prompt: "Add a title" },
      { type: "thought", turn: "t1", delta: "Let me " },
      { type: "thought", turn: "t1", delta: "look." },
      { type: "text", turn: "t1", delta: "Adding " },
      { type: "text", turn: "t1", delta: "a title." },
      { type: "tool_started", turn: "t1", call: "c1", tool: "edit_candidate", summary: "Text Layer at 0s" },
    ]);
    expect(running.turns).toHaveLength(1);
    expect(running.turns[0].parts).toEqual([
      { type: "thought", text: "Let me look." },
      { type: "text", text: "Adding a title." },
      { type: "tool", call: "c1", tool: "edit_candidate", summary: "Text Layer at 0s", ok: null, error: null, revision: null },
    ]);
    expect(runningTurn(running, "tab-a")?.id).toBe("t1");

    const done = fold(
      [
        { type: "tool_finished", turn: "t1", call: "c1", ok: true, revision: 7 },
        { type: "text", turn: "t1", delta: "Done." },
        { type: "turn_finished", turn: "t1", stop: "end_turn", first_revision: 7, last_revision: 7 },
      ],
      running,
    );
    const [turn] = done.turns;
    expect(turn).toMatchObject({ id: "t1", tab: "tab-a", provider: "deepseek", prompt: "Add a title", stop: "end_turn", first_revision: 7, last_revision: 7 });
    expect(turn.parts[2]).toMatchObject({ type: "tool", ok: true, revision: 7 });
    expect(turn.parts[3]).toEqual({ type: "text", text: "Done." });
    expect(runningTurn(done, "tab-a")).toBeNull();
  });

  test("a failed tool call is marked failed with its message; a cancelled turn is stopped", () => {
    const state = fold([
      started,
      { type: "tool_started", turn: "t1", call: "c1", tool: "edit_candidate", summary: "" },
      { type: "tool_finished", turn: "t1", call: "c1", ok: false, error: "No Segment s9" },
      { type: "turn_finished", turn: "t1", stop: "cancelled" },
    ]);
    expect(state.turns[0].parts[0]).toMatchObject({ ok: false, error: "No Segment s9" });
    expect(state.turns[0].stop).toBe("cancelled");
  });

  test("an error names its turn's message, or the stream's when it names none", () => {
    const state = fold([started, { type: "error", turn: "t1", message: "401 Unauthorized" }, { type: "error", message: "Down" }]);
    expect(state.turns[0].error).toBe("401 Unauthorized");
    expect(state.error).toBe("Down");
  });

  test("the prompt sent may come before the turn starts", () => {
    const state = fold([{ type: "prompted", turn: "t1", prompt: "Hi" }, started]);
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]).toMatchObject({ prompt: "Hi", provider: "deepseek", tab: "tab-a" });
  });

  test("ready says which turns run, by tab", () => {
    const state = fold([{ type: "ready", running: { "tab-b": "t9" } }]);
    expect(runningTurn(state, "tab-b")?.id).toBe("t9");
  });

  test("the turns started by a tab", () => {
    const state = fold([started, { ...started, turn: "t2", tab: "tab-b" }, { type: "turn_finished", turn: "t1", stop: "end_turn" }]);
    expect([...ownTurns(state, "tab-a")]).toEqual(["t1"]);
  });

  test("loadTranscript puts the chat's finished turns before the live ones", () => {
    const old: AgentTranscriptTurn = {
      id: "t0",
      provider: "deepseek",
      model: null,
      prompt: "Earlier",
      parts: [{ type: "text", text: "Ok" }],
      first_revision: 3,
      last_revision: 4,
      stop: "end_turn",
      started_at: "2026-10-24T00:00:00Z",
    };
    const live = fold([started]);
    const state = loadTranscript([old], live);
    expect(state.turns.map((turn) => turn.id)).toEqual(["t0", "t1"]);
    expect(state.turns[0]).toMatchObject({ prompt: "Earlier", stop: "end_turn", tab: null, last_revision: 4 });
    // A turn the chat has already is kept as the chat has it, once.
    expect(loadTranscript([old], loadTranscript([old])).turns).toHaveLength(1);
  });
});
