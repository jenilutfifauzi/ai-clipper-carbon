import { Check, Copy } from "lucide-react";
import { memo, useEffect, useState } from "react";
import type { AgentStop, AgentTurnPart, AgentTurnUndo, AgentUi } from "../../../../api";
import { Button } from "../../../../components/Button";
import { writeClipboard } from "../../../../components/CopyButton";
import type { AgentTurnView } from "./agentStream";
import { ChatMarkdown } from "./ChatMarkdown";
import { ReasoningBlock } from "./ReasoningBlock";
import { ToolGroup } from "./ToolGroup";
import type { ToolPart } from "./ToolRow";
import { GenerativeUi } from "./ui/GenerativeUi";

// How a turn that didn't simply finish ended, under it.
const STOPPED: Partial<Record<AgentStop, string>> = {
  cancelled: "Stopped.",
  step_limit: "Stopped after its step limit.",
};

// What a turn shows, in order: each run of consecutive tool calls as one group, a show_ui call's Agent
// UI on its own (never folded), its other parts one by one.
type Shown =
  | { type: "tools"; parts: ToolPart[] }
  | { type: "ui"; call: string; ui: AgentUi }
  | { type: "part"; part: Exclude<AgentTurnPart, ToolPart>; index: number };

/** `parts` with each run of consecutive tool calls gathered into one; an Agent UI breaks a run. */
export function grouped(parts: AgentTurnPart[]): Shown[] {
  const shown: Shown[] = [];
  parts.forEach((part, index) => {
    const last = shown.at(-1);
    if (part.type !== "tool") shown.push({ type: "part", part, index });
    else if (part.ui) shown.push({ type: "ui", call: part.call, ui: part.ui });
    else if (last?.type === "tools") last.parts.push(part);
    else shown.push({ type: "tools", parts: [part] });
  });
  return shown;
}

// Undoes a finished turn (ADR 0028): Revert restores the clip as it was before it, Restore brings back
// what it made. Resolves once done; the editor says how it went.
export type UndoTurn = (turn: AgentTurnView, how: AgentTurnUndo) => Promise<void>;

/**
 * One Agent Turn: the owner's message in a bubble on the right, then what the Agent did in order —
 * its text in bubbles on the left, as Markdown (the owner's stays plain), its thoughts folded,
 * and a card per tool call, a long run of them folded into "N steps" (ToolGroup), a show_ui call's Agent
 * UI in place of its card — dots while it works, and, once finished with Revisions saved, Revert and
 * Restore (with `onUndo`). `nextPrompt` is the message of the Thread's next turn, null while there is
 * none: its choices are then made. Memoised: a streaming turn doesn't re-render the finished ones above it.
 */
export const TurnView = memo(function TurnView({
  turn,
  nextPrompt = null,
  onUndo,
}: {
  turn: AgentTurnView;
  nextPrompt?: string | null;
  onUndo?: UndoTurn;
}) {
  const undoable = onUndo && turn.stop !== null && turn.first_revision !== null && turn.last_revision !== null;
  const running = turn.stop === null && !turn.error;
  const last = turn.parts.at(-1);
  // Working with nothing streaming: not started yet, or between a finished tool call and what comes next.
  const typing = running && (!last || (last.type === "tool" && last.ok !== null));
  return (
    <div className="flex flex-col gap-2">
      {turn.prompt && (
        <div className="flex justify-end">
          <p className="raised max-w-[85%] rounded-xl rounded-br-md px-3 py-2 text-sm text-pretty break-words whitespace-pre-wrap text-text">
            {turn.prompt}
          </p>
        </div>
      )}
      {grouped(turn.parts).map((shown) =>
        shown.type === "tools" ? (
          <ToolGroup key={shown.parts[0].call} parts={shown.parts} />
        ) : shown.type === "ui" ? (
          <GenerativeUi key={shown.call} ui={shown.ui} nextPrompt={nextPrompt} />
        ) : shown.part.type === "thought" ? (
          <ReasoningBlock key={shown.index} text={shown.part.text} streaming={running && shown.part === last} />
        ) : (
          <div key={shown.index} className="group/response relative rounded-xl rounded-tl-md bg-fill px-3 py-2 text-sm">
            <ChatMarkdown text={shown.part.text} />
            <CopyResponse text={shown.part.text} />
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
