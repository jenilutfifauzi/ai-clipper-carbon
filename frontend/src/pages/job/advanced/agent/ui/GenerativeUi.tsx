import { createContext, useContext } from "react";
import type { AgentUi, Candidate } from "../../../../../api";
import { Callout } from "./Callout";
import { CandidateCard } from "./CandidateCard";
import { ChoicesCard } from "./ChoicesCard";
import { DataTable } from "./DataTable";
import { KeyValues } from "./KeyValues";

// What an Agent UI needs of the chat it is drawn in: the Job, the Candidate as the editor holds it (none
// outside the Advanced Edit), and, for a choice, whether a turn is on its way and how one is sent.
export interface AgentUiHost {
  jobId: string;
  candidate: { value: Candidate; name: string } | null;
  busy: boolean;
  // Sends `prompt` as the owner's next message to the open Thread, as the composer does.
  choose: (prompt: string) => void;
  // The call whose choices are open in the pop up above the composer, if any: its card folds.
  popup?: string | null;
}

// Given by the Agent tab; read here rather than passed down through each (memoised) turn.
export const AgentUiContext = createContext<AgentUiHost | null>(null);

/**
 * An Agent UI: the component a show_ui call asked for, drawn in place of its tool card (ADR 0031).
 * `nextPrompt` is the message of the Thread's turn after this one, null while there is none: a choice
 * is made once. A kind this chat doesn't know draws nothing.
 */
export function GenerativeUi({ call, ui, nextPrompt }: { call: string; ui: AgentUi; nextPrompt: string | null }) {
  const host = useContext(AgentUiContext);
  switch (ui.kind) {
    case "choices":
      return <ChoicesCard call={call} ui={ui} nextPrompt={nextPrompt} host={host} />;
    case "candidate":
      return <CandidateCard ui={ui} host={host} />;
    case "table":
      return <DataTable ui={ui} />;
    case "key_values":
      return <KeyValues ui={ui} />;
    case "callout":
      return <Callout ui={ui} />;
    default:
      return null;
  }
}
