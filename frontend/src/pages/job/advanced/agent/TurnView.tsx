import { Check, Copy } from "lucide-react";
import { memo, useContext, useEffect, useState } from "react";
import type { AgentStop, AgentTurnPart, AgentTurnUndo, AgentUi } from "../../../../api";
import { Button } from "../../../../components/Button";
import { writeClipboard } from "../../../../components/CopyButton";
import type { AgentTurnView } from "./agentStream";
import { ChatMarkdown } from "./ChatMarkdown";
import { ErrorNote } from "./ErrorNote";
import { ReasoningBlock } from "./ReasoningBlock";
import { agentStatus } from "./status";
import { StatusLine } from "./StatusLine";
import { ToolGroup } from "./ToolGroup";
import type { ToolPart } from "./ToolRow";
import { AgentUiContext, GenerativeUi } from "./ui/GenerativeUi";
import { AttachmentChips } from "./AttachmentChips";

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

// The provider's own bookkeeping tools (Claude Code's), which do nothing to the clip: not shown.
const META_TOOLS = new Set(["ToolSearch", "TodoWrite"]);

/**
 * `parts` with each run of consecutive tool calls gathered into one; an Agent UI breaks a run. The
 * provider's meta tools are left out.
 */
export function grouped(parts: AgentTurnPart[]): Shown[] {
  const shown: Shown[] = [];
  parts.forEach((part, index) => {
    const last = shown.at(-1);
    if (part.type === "tool" && META_TOOLS.has(part.tool)) return;
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
 * its text on the panel itself, as Markdown (the owner's stays plain), its thoughts folded, a row per
 * tool call, a long run of them folded into "N steps" (ToolGroup), a show_ui call's Agent UI in place
 * of its row — the status line while it works, an error with "Try again", and once finished a quiet
 * footer: Copy, and with Revisions saved Undo and Redo (with `onUndo`). `nextPrompt` is the message of the Thread's next turn, null while there is
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
  const status = running ? agentStatus(turn) : null;
  const host = useContext(AgentUiContext);
  const said = turn.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
  return (
    <div className="flex flex-col gap-2">
      {turn.prompt && (
        <div className="flex flex-col items-end gap-1.5">
          <AttachmentChips attachments={turn.attachments ?? []} className="max-w-[85%] justify-end" />
          <p className="raised max-w-[85%] rounded-xl rounded-br-md px-3 py-2 text-sm text-pretty break-words whitespace-pre-wrap text-text">
            {turn.prompt}
          </p>
        </div>
      )}
      {grouped(turn.parts).map((shown) =>
        shown.type === "tools" ? (
          <ToolGroup key={shown.parts[0].call} parts={shown.parts} />
        ) : shown.type === "ui" ? (
          <GenerativeUi key={shown.call} call={shown.call} ui={shown.ui} nextPrompt={nextPrompt} />
        ) : shown.part.type === "thought" ? (
          <ReasoningBlock key={shown.index} text={shown.part.text} streaming={running && shown.part === last} />
        ) : (
          // The answer itself, on the panel: no bubble, so it outweighs the log around it.
          <div key={shown.index} className="px-1 text-sm leading-relaxed">
            <ChatMarkdown text={shown.part.text} streaming={running && shown.part === last} />
          </div>
        ),
      )}
      {status && <StatusLine label={status} />}
      {turn.error && <ErrorNote error={turn.error} onRetry={host && !host.busy ? () => host.choose(turn.prompt) : undefined} />}
      {turn.stop && STOPPED[turn.stop] && <p className="px-1 text-xs text-muted">{STOPPED[turn.stop]}</p>}
      {turn.stop !== null && (said || undoable) ? <TurnFooter turn={turn} said={said} onUndo={undoable ? onUndo : undefined} /> : null}
    </div>
  );
});

/**
 * A finished turn's quiet footer, always shown: Copy what the Agent said, then, when it saved
 * Revisions (`onUndo`), Undo (restore the clip as it was before the turn) and Redo (bring back what
 * it made), each at once (no confirm: either is a Restore, itself undoable; ADR 0028), and the
 * Revision it left.
 */
function TurnFooter({ turn, said, onUndo }: { turn: AgentTurnView; said: string; onUndo?: UndoTurn }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const undo = async (how: AgentTurnUndo) => {
    if (!onUndo) return;
    setBusy(true);
    try {
      await onUndo(turn, how);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div data-turn-actions="" className="-mt-1 flex items-center gap-0.5 text-xs text-muted">
      {said && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copied ? "Copied" : "Copy response"}
          title={copied ? "Copied" : "Copy response"}
          onClick={() => void writeClipboard(said).then(() => setCopied(true), () => {})}
        >
          {copied ? <Check aria-hidden size={13} className="text-success" /> : <Copy aria-hidden size={13} />}
        </Button>
      )}
      {onUndo && (
        <>
          <Button variant="ghost" size="xs" disabled={busy} title="Restore the clip as it was before this turn" onClick={() => void undo("revert")}>
            Undo
          </Button>
          <Button variant="ghost" size="xs" disabled={busy} title="Bring back what this turn made" onClick={() => void undo("restore")}>
            Redo
          </Button>
          <span className="ml-auto pr-1 tabular-nums">rev {turn.last_revision}</span>
        </>
      )}
    </div>
  );
}
