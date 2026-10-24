import { memo, useState } from "react";
import type { AgentStop, AgentTurnUndo } from "../../../../api";
import { Button } from "../../../../components/Button";
import type { AgentTurnView } from "./agentStream";
import { ToolRow } from "./ToolRow";

// How a turn that didn't simply finish ended, under it.
const STOPPED: Partial<Record<AgentStop, string>> = {
  cancelled: "Stopped.",
  step_limit: "Stopped after its step limit.",
};

// Undoes a finished turn (ADR 0028): Revert restores the clip as it was before it, Restore brings back
// what it made. Resolves once done; the editor says how it went.
export type UndoTurn = (turn: AgentTurnView, how: AgentTurnUndo) => Promise<void>;

/**
 * One Agent Turn: the owner's message, then what the Agent did in order — its text (plain, its line
 * breaks kept; no Markdown), its thoughts folded, and a row per tool call — and, once finished with
 * Revisions saved, Revert and Restore (with `onUndo`). Memoised: a streaming turn doesn't re-render
 * the finished ones above it.
 */
export const TurnView = memo(function TurnView({ turn, onUndo }: { turn: AgentTurnView; onUndo?: UndoTurn }) {
  const undoable = onUndo && turn.stop !== null && turn.first_revision !== null && turn.last_revision !== null;
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
      {undoable ? <TurnActions turn={turn} onUndo={onUndo} /> : null}
    </div>
  );
});

/** Revert and Restore, each at once (no confirm: either is a Restore, itself undoable), one at a time. */
function TurnActions({ turn, onUndo }: { turn: AgentTurnView; onUndo: UndoTurn }) {
  const [busy, setBusy] = useState(false);
  const undo = async (how: AgentTurnUndo) => {
    setBusy(true);
    try {
      await onUndo(turn, how);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-turn-actions="" className="flex gap-2">
      <Button size="xs" disabled={busy} title="Restore the clip as it was before this turn" onClick={() => void undo("revert")}>
        Revert
      </Button>
      <Button size="xs" disabled={busy} title="Bring back what this turn made" onClick={() => void undo("restore")}>
        Restore
      </Button>
    </div>
  );
}
