import { memo } from "react";
import type { AgentStop } from "../../../../api";
import type { AgentTurnView } from "./agentStream";
import { ToolRow } from "./ToolRow";

// How a turn that didn't simply finish ended, under it.
const STOPPED: Partial<Record<AgentStop, string>> = {
  cancelled: "Stopped.",
  step_limit: "Stopped after its step limit.",
};

/**
 * One Agent Turn: the owner's message, then what the Agent did in order — its text (plain, its line
 * breaks kept; no Markdown), its thoughts folded, and a row per tool call. Memoised: a streaming turn
 * doesn't re-render the finished ones above it.
 */
export const TurnView = memo(function TurnView({ turn }: { turn: AgentTurnView }) {
  return (
    <div className="flex flex-col gap-2">
      {turn.prompt && <p className="raised self-end rounded-[10px] px-3 py-2 text-sm text-pretty break-words whitespace-pre-wrap">{turn.prompt}</p>}
      {turn.parts.map((part, index) =>
        part.type === "tool" ? (
          <ToolRow key={part.call} part={part} />
        ) : part.type === "thought" ? (
          <details key={index} className="text-sm text-muted">
            <summary className="cursor-pointer select-none">Thoughts</summary>
            <p className="mt-1 text-pretty break-words whitespace-pre-wrap">{part.text}</p>
          </details>
        ) : (
          <p key={index} className="text-sm text-pretty break-words whitespace-pre-wrap">
            {part.text}
          </p>
        ),
      )}
      {turn.error && <p className="text-sm text-danger">{turn.error}</p>}
      {turn.stop && STOPPED[turn.stop] && <p className="text-xs text-muted">{STOPPED[turn.stop]}</p>}
    </div>
  );
});
