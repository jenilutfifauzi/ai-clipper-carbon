import { ChevronDown, Ellipsis, LocateFixed } from "lucide-react";
import { Button, buttonClass } from "../../../../components/Button";
import { writeClipboard } from "../../../../components/CopyButton";
import { Menu, MenuItem, useMenu } from "../../../../components/Menu";
import type { AgentTurnView } from "./agentStream";
import { rememberedFollow } from "./follow";

/** The chat as text: each turn's prompt after "You:", then the Agent's text after "Agent:". */
export function transcriptText(turns: AgentTurnView[]): string {
  return turns
    .flatMap((turn) => {
      const answer = turn.parts.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : [])).join("\n\n");
      return [turn.prompt && `You: ${turn.prompt}`, answer && `Agent: ${answer}`].filter(Boolean);
    })
    .join("\n\n");
}

/** The chat's header: its title, Follow agent, and a ⋯ menu with Copy transcript. */
export function ChatHeader({ turns }: { turns: AgentTurnView[] }) {
  const follow = rememberedFollow.use();
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
      {/* The chat's title; the Threads will be listed from here. */}
      <div className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-fill">
        <span className="min-w-0 flex-1 truncate font-medium">Agent</span>
        <ChevronDown aria-hidden size={14} className="shrink-0 text-muted" />
      </div>
      {/* The + that starts a new Thread goes here. */}
      <Button
        variant="ghost"
        size="icon-sm"
        className="aria-pressed:text-accent-text"
        aria-label="Follow agent"
        aria-pressed={follow}
        title="Follow agent: the Timeline goes to what the Agent changes (until you scroll or zoom it in that turn)"
        onClick={() => rememberedFollow.set(!follow)}
      >
        <LocateFixed aria-hidden size={15} />
      </Button>
      <button ref={buttonRef} type="button" className={buttonClass("ghost", "icon-sm")} aria-label="More" title="More" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
        <Ellipsis aria-hidden size={15} />
      </button>
      <Menu ref={menuRef} label="Chat">
        <MenuItem
          disabled={turns.length === 0}
          onClick={() => {
            void writeClipboard(transcriptText(turns)).catch(() => {});
            hide();
          }}
        >
          Copy transcript
        </MenuItem>
      </Menu>
    </div>
  );
}
