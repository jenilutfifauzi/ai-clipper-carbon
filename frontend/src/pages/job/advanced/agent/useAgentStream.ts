import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { agentEventsUrl, api, TAB_ID, type AgentEvent, type AgentTranscriptTurn } from "../../../../api";
import {
  agentStream,
  EMPTY_STREAM,
  ownTurns,
  runningTurn,
  threadTurns,
  type AgentStreamAction,
  type AgentStreamState,
  type AgentTurnView,
} from "./agentStream";

// The events an Agent Turn sends, by their SSE name (each is its `type`).
const EVENT_TYPES: AgentEvent["type"][] = ["turn_started", "text", "thought", "tool_started", "tool_finished", "turn_finished", "error"];

// What the stream hears, as it hears it: each (re)connection's `ready` with the turns running then
// (by tab), and each Agent Turn's events.
export type AgentStreamEvent = AgentEvent | { type: "ready"; running: Record<string, string> };

export interface AgentStream {
  // Its turns are the open Thread's alone.
  state: AgentStreamState;
  // The turn this tab runs now, if any, whichever Thread it is in.
  running: AgentTurnView | null;
  // The ids of the turns this tab started, in any Thread (its Revisions are its undo steps, ADR 0028).
  ownTurns: ReadonlySet<string>;
  // Until the stream has (re)connected.
  lost: boolean;
  // This tab sent `prompt` to the open Thread, and the backend named it turn `turn`.
  prompted: (turn: string, prompt: string) => void;
  // Calls `listener` with every event the stream hears from now on, as it hears it (the same event is
  // dispatched into `state`, whose render may come later), until the returned function is called. For whoever reacts to the Agent's events beyond
  // the chat (the Agent's presence on the stage, say), without a stream of its own. Stable.
  subscribe: (listener: (event: AgentStreamEvent) => void) => () => void;
}

/**
 * Loads Thread `thread`'s transcript into `dispatch`; nothing until a Thread is open. Its turns merge
 * under any seen live meanwhile, so the stream needn't wait for them. Returns what drops the answer
 * when the Thread changes before it comes.
 */
export function loadThread(
  jobId: string,
  candidateId: string,
  thread: string | null,
  dispatch: (action: AgentStreamAction) => void,
  transcript: (jobId: string, candidateId: string, thread: string) => Promise<AgentTranscriptTurn[]> = api.agentTranscript,
): () => void {
  if (thread === null) return () => {};
  let live = true;
  transcript(jobId, candidateId, thread).then(
    (turns) => live && dispatch({ type: "transcript", turns, thread }),
    () => {},
  );
  return () => {
    live = false;
  };
}

/**
 * The Candidate's Agent chat in Agent Thread `thread`: its transcript, loaded first and again on a
 * switch of Thread, then each Agent Turn's events as they come (`…/agent/events`, every Thread's),
 * folded by `agentStream`. EventSource reconnects by itself; its `ready` then says which turns run.
 * Closed on unmount. One per editor (the Advanced Edit's), handed to its Agent tab.
 */
export function useAgentStream(jobId: string, candidateId: string, thread: string | null): AgentStream {
  const [state, dispatch] = useReducer(agentStream, EMPTY_STREAM);
  const [lost, setLost] = useState(false);
  const [listeners] = useState(() => new Set<(event: AgentStreamEvent) => void>());

  useEffect(() => loadThread(jobId, candidateId, thread, dispatch), [jobId, candidateId, thread]);

  useEffect(() => {
    const heard = (event: AgentStreamEvent) => {
      dispatch(event);
      for (const listener of listeners) listener(event);
    };
    const source = new EventSource(agentEventsUrl(jobId, candidateId));
    source.onopen = () => setLost(false);
    source.onerror = () => setLost(true);
    source.addEventListener("ready", (event) => heard({ type: "ready", running: JSON.parse(event.data).running }));
    for (const type of EVENT_TYPES) source.addEventListener(type, (event) => heard(JSON.parse(event.data) as AgentEvent));
    return () => source.close();
  }, [jobId, candidateId, listeners]);

  const subscribe = useCallback(
    (listener: (event: AgentStreamEvent) => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    [listeners],
  );
  const prompted = useCallback((turn: string, prompt: string) => dispatch({ type: "prompted", turn, prompt, thread }), [thread]);
  // A new set only when the turns change, not on each `ready`.
  const { turns } = state;
  const own = useMemo(() => ownTurns({ ...EMPTY_STREAM, turns }, TAB_ID), [turns]);
  const shown = useMemo(() => threadTurns(turns, thread), [turns, thread]);
  const open = useMemo(() => ({ ...state, turns: shown }), [state, shown]);
  return { state: open, running: runningTurn(state, TAB_ID), ownTurns: own, lost, prompted, subscribe };
}
