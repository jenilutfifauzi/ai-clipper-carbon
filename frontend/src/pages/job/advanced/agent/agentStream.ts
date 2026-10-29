import type { AgentEvent, AgentStop, AgentTranscriptTurn, AgentTurnPart } from "../../../../api";

/**
 * The Agent tab's chat as its events tell it: a pure reducer (`agentStream`) that folds each
 * AgentEvent into its turn's parts — a delta extends the text or thought run before it, a tool call
 * adds a row that its finish fills in, by `call` — as the backend's transcript_store.with_event does.
 */

export interface AgentTurnView {
  id: string;
  // The browser tab that sent it; null for a turn loaded from the chat, or one joined midway.
  tab: string | null;
  // The Agent Thread it is a turn of; null for one joined midway (its turn_started unheard).
  thread: string | null;
  provider: string;
  model: string | null;
  // The owner's message: from turn_started, the tab that sent it, or the chat; empty for a turn joined midway.
  prompt: string;
  parts: AgentTurnPart[];
  // Null while it runs.
  stop: AgentStop | null;
  first_revision: number | null;
  last_revision: number | null;
  // What failed, from an `error` event naming it.
  error: string | null;
}

export interface AgentStreamState {
  // Oldest first: the chat's finished turns, then those seen live, of any Thread (`threadTurns` picks one's).
  turns: AgentTurnView[];
  // The turns running now, by tab, as `ready` told and turn events since.
  running: Record<string, string>;
  // An error naming no turn.
  error: string | null;
}

export const EMPTY_STREAM: AgentStreamState = { turns: [], running: {}, error: null };

export type AgentStreamAction =
  | AgentEvent
  // The stream (re)connected: the turns running now, by tab.
  | { type: "ready"; running: Record<string, string> }
  // This tab sent `prompt` to Thread `thread` and the backend named its turn (which may have started already).
  | { type: "prompted"; turn: string; prompt: string; thread?: string | null }
  // Thread `thread`'s finished turns.
  | { type: "transcript"; turns: AgentTranscriptTurn[]; thread?: string | null };

const blankTurn = (id: string): AgentTurnView => ({
  id,
  tab: null,
  thread: null,
  provider: "",
  model: null,
  prompt: "",
  parts: [],
  stop: null,
  first_revision: null,
  last_revision: null,
  error: null,
});

// `state` with turn `id` changed by `change`; a turn not seen yet is added (joined midway, or prompted first).
function withTurn(state: AgentStreamState, id: string, change: (turn: AgentTurnView) => AgentTurnView): AgentStreamState {
  const index = state.turns.findIndex((turn) => turn.id === id);
  if (index === -1) return { ...state, turns: [...state.turns, change(blankTurn(id))] };
  return { ...state, turns: state.turns.map((turn, i) => (i === index ? change(turn) : turn)) };
}

function withDelta(parts: AgentTurnPart[], kind: "text" | "thought", delta: string): AgentTurnPart[] {
  const last = parts.at(-1);
  if (last?.type === kind) return [...parts.slice(0, -1), { type: kind, text: last.text + delta }];
  return [...parts, { type: kind, text: delta }];
}

const withoutTurn = (running: Record<string, string>, id: string) =>
  Object.fromEntries(Object.entries(running).filter(([, turn]) => turn !== id));

export function agentStream(state: AgentStreamState, action: AgentStreamAction): AgentStreamState {
  switch (action.type) {
    case "ready":
      return { ...state, running: action.running, error: null };
    case "transcript":
      return loadTranscript(action.turns, state, action.thread ?? null);
    case "prompted":
      return withTurn(state, action.turn, (turn) => ({ ...turn, prompt: action.prompt, thread: turn.thread ?? action.thread ?? null }));
    case "turn_started":
      return withTurn({ ...state, running: { ...state.running, [action.tab]: action.turn } }, action.turn, (turn) => ({
        ...turn,
        tab: action.tab,
        thread: action.thread ?? turn.thread,
        provider: action.provider,
        model: action.model,
        prompt: action.prompt || turn.prompt,
      }));
    case "text":
    case "thought":
      return withTurn(state, action.turn, (turn) => ({ ...turn, parts: withDelta(turn.parts, action.type, action.delta) }));
    case "tool_started":
      return withTurn(state, action.turn, (turn) => ({
        ...turn,
        parts: [
          ...turn.parts,
          { type: "tool", call: action.call, tool: action.tool, summary: action.summary, ok: null, error: null, revision: null, input: action.input ?? null },
        ],
      }));
    case "tool_finished":
      // The finish's input fills one the start didn't carry.
      return withTurn(state, action.turn, (turn) => ({
        ...turn,
        parts: turn.parts.map((part) =>
          part.type === "tool" && part.call === action.call
            ? {
                ...part,
                ok: action.ok,
                error: action.error ?? null,
                revision: action.revision ?? null,
                input: part.input ?? action.input ?? null,
                output: action.output ?? null,
              }
            : part,
        ),
      }));
    case "turn_finished":
      return withTurn({ ...state, running: withoutTurn(state.running, action.turn) }, action.turn, (turn) => ({
        ...turn,
        stop: action.stop,
        first_revision: action.first_revision ?? null,
        last_revision: action.last_revision ?? null,
      }));
    case "error":
      return action.turn ? withTurn(state, action.turn, (turn) => ({ ...turn, error: action.message })) : { ...state, error: action.message };
  }
}

/**
 * Thread `thread`'s finished turns, oldest first, then the turns of `live` they haven't got (still
 * running, or of other Threads).
 */
export function loadTranscript(turns: AgentTranscriptTurn[], live: AgentStreamState = EMPTY_STREAM, thread: string | null = null): AgentStreamState {
  const loaded = new Set(turns.map((turn) => turn.id));
  return {
    ...live,
    turns: [
      ...turns.map((turn): AgentTurnView => ({
        id: turn.id,
        tab: live.turns.find((seen) => seen.id === turn.id)?.tab ?? null,
        thread: thread ?? live.turns.find((seen) => seen.id === turn.id)?.thread ?? null,
        provider: turn.provider,
        model: turn.model,
        prompt: turn.prompt,
        parts: turn.parts,
        stop: turn.stop,
        first_revision: turn.first_revision,
        last_revision: turn.last_revision,
        error: null,
      })),
      ...live.turns.filter((turn) => !loaded.has(turn.id)),
    ],
  };
}

/**
 * The turns the chat of Thread `thread` shows: its own, and any joined midway, whose Thread is unknown.
 * Another Thread's running turn isn't among them (it still counts for `runningTurn`).
 */
export function threadTurns(turns: AgentTurnView[], thread: string | null): AgentTurnView[] {
  return turns.filter((turn) => turn.thread === null || turn.thread === thread);
}

/** The turn tab `tab` runs now, if any. */
export function runningTurn(state: AgentStreamState, tab: string): AgentTurnView | null {
  const id = state.running[tab];
  if (!id) return null;
  return state.turns.find((turn) => turn.id === id) ?? blankTurn(id);
}

/** The ids of the turns tab `tab` started, seen live: its Revisions are its undo steps (ADR 0028). */
export function ownTurns(state: AgentStreamState, tab: string): Set<string> {
  return new Set(state.turns.filter((turn) => turn.tab === tab).map((turn) => turn.id));
}
