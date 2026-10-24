import { useEffect, useMemo, useReducer, useState } from "react";
import { agentEventsUrl, api, TAB_ID, type AgentEvent } from "../../../../api";
import { agentStream, EMPTY_STREAM, ownTurns, runningTurn, type AgentStreamState, type AgentTurnView } from "./agentStream";

// The events an Agent Turn sends, by their SSE name (each is its `type`).
const EVENT_TYPES: AgentEvent["type"][] = ["turn_started", "text", "thought", "tool_started", "tool_finished", "turn_finished", "error"];

export interface AgentStream {
  state: AgentStreamState;
  // The turn this tab runs now, if any.
  running: AgentTurnView | null;
  // The ids of the turns this tab started (its Revisions are its undo steps, ADR 0028).
  ownTurns: ReadonlySet<string>;
  // Until the stream has (re)connected.
  lost: boolean;
  // This tab sent `prompt`, which the backend named turn `turn`.
  prompted: (turn: string, prompt: string) => void;
}

/**
 * The Candidate's Agent chat: its transcript, loaded first, then each Agent Turn's events as they come
 * (`…/agent/events`), folded by `agentStream`. EventSource reconnects by itself; its `ready` then says
 * which turns run. Closed on unmount.
 */
export function useAgentStream(jobId: string, candidateId: string): AgentStream {
  const [state, dispatch] = useReducer(agentStream, EMPTY_STREAM);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let live = true;
    // The chat's turns merge under any seen live meanwhile, so the stream needn't wait for them.
    api.agentTranscript(jobId, candidateId).then(
      (turns) => live && dispatch({ type: "transcript", turns }),
      () => {},
    );
    const source = new EventSource(agentEventsUrl(jobId, candidateId));
    source.onopen = () => setLost(false);
    source.onerror = () => setLost(true);
    source.addEventListener("ready", (event) => dispatch({ type: "ready", running: JSON.parse(event.data).running }));
    for (const type of EVENT_TYPES) source.addEventListener(type, (event) => dispatch(JSON.parse(event.data) as AgentEvent));
    return () => {
      live = false;
      source.close();
    };
  }, [jobId, candidateId]);

  // A new set only when the turns change, not on each `ready`.
  const { turns } = state;
  const own = useMemo(() => ownTurns({ ...EMPTY_STREAM, turns }, TAB_ID), [turns]);
  return {
    state,
    running: runningTurn(state, TAB_ID),
    ownTurns: own,
    lost,
    prompted: (turn, prompt) => dispatch({ type: "prompted", turn, prompt }),
  };
}
