import { Check, Copy } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { AgentStop, AgentTurnUndo } from "../../../../api";
import { Button } from "../../../../components/Button";
import { writeClipboard } from "../../../../components/CopyButton";
import type { AgentTurnView } from "./agentStream";
import { ReasoningBlock } from "./ReasoningBlock";
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
 * One Agent Turn: the owner's message in a bubble on the right, then what the Agent did in order —
 * its text in bubbles on the left (plain, its line breaks kept; no Markdown), its thoughts folded,
 * and a row per tool call — dots while it works, and, once finished with Revisions saved, Revert and
 * Restore (with `onUndo`). Memoised: a streaming turn doesn't re-render the finished ones above it.
 */
export const TurnView = memo(function TurnView({ turn, onUndo }: { turn: AgentTurnView; onUndo?: UndoTurn }) {
  const undoable = onUndo && turn.stop !== null && turn.first_revision !== null && turn.last_revision !== null;
  const running = turn.stop === null && !turn.error;
  const last = turn.parts.at(-1);
  // Working with nothing streaming: not started yet, or between a finished tool call and what comes next.
  const typing = running && (!last || (last.type === "tool" && last.ok !== null));
  return (
    <div className="flex flex-col gap-2">
      {turn.prompt && (
        <div className="flex justify-end">
          <p className="max-w-[85%] rounded-xl rounded-br-md bg-linear-to-b from-accent to-accent-end px-3 py-2 text-sm text-pretty break-words whitespace-pre-wrap text-on-accent">
            {turn.prompt}
          </p>
        </div>
      )}
      {turn.parts.map((part, index) =>
        part.type === "tool" ? (
          <ToolRow key={part.call} part={part} />
        ) : part.type === "thought" ? (
          <ReasoningBlock key={index} text={part.text} streaming={running && part === last} />
        ) : (
          <div key={index} className="group/response relative rounded-xl rounded-tl-md bg-fill px-3 py-2 text-sm">
            <p className="text-pretty break-words whitespace-pre-wrap">{part.text}</p>
            <CopyResponse text={part.text} />
          </div>
        ),
      )}
      {typing && <TypingDots />}
      {turn.error && <p className="text-sm text-danger">{turn.error}</p>}
      {turn.stop && STOPPED[turn.stop] && <p className="text-xs text-muted">{STOPPED[turn.stop]}</p>}
      {undoable ? <TurnActions turn={turn} onUndo={onUndo} /> : null}
    </div>
  );
});

/** Copies one of the Agent's answers, shown on hovering it; a check for a moment once copied. */
function CopyResponse({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={copied ? "Copied" : "Copy response"}
      title={copied ? "Copied" : "Copy response"}
      className="absolute right-1 bottom-1 opacity-0 group-hover/response:opacity-100 focus-visible:opacity-100"
      onClick={() => void writeClipboard(text).then(() => setCopied(true), () => {})}
    >
      {copied ? <Check aria-hidden size={13} className="text-success" /> : <Copy aria-hidden size={13} />}
    </Button>
  );
}

/** Three bouncing dots: the Agent is working on something that isn't streaming in yet. */
function TypingDots() {
  return (
    <div role="status" aria-label="The Agent is working" className="flex h-5 items-center gap-1 px-1">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="size-1.5 rounded-full bg-muted motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

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
