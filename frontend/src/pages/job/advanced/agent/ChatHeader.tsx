import { Check, ChevronDown, Ellipsis, LocateFixed, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, buttonClass } from "../../../../components/Button";
import { writeClipboard } from "../../../../components/CopyButton";
import { Menu, MenuItem, useMenu } from "../../../../components/Menu";
import { formatRelative } from "../../../../format";
import type { AgentTurnView } from "./agentStream";
import { rememberedFollow } from "./follow";
import { matchingThreads, type AgentThreads } from "./threads";

/** The chat as text: each turn's prompt after "You:", then the Agent's text after "Agent:". */
export function transcriptText(turns: AgentTurnView[]): string {
  return turns
    .flatMap((turn) => {
      const answer = turn.parts.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text.trim()] : [])).join("\n\n");
      return [turn.prompt && `You: ${turn.prompt}`, answer && `Agent: ${answer}`].filter(Boolean);
    })
    .join("\n\n");
}

/**
 * The chat's header: the open Agent Thread's title, which lists the Threads to switch to; Follow
 * agent; + for a new Thread; and a ⋯ menu to rename it, copy its transcript or delete it. Without
 * `threads`, the title is "Agent" and only Copy transcript is offered.
 */
export function ChatHeader({ turns, threads }: { turns: AgentTurnView[]; threads?: AgentThreads }) {
  const follow = rememberedFollow.use();
  const more = useMenu();
  const active = threads?.active ?? null;

  const rename = () => {
    more.hide();
    if (!threads || !active) return;
    const title = window.prompt("Rename the chat", active.title)?.trim();
    if (title && title !== active.title) void threads.rename(active.id, title);
  };
  const remove = () => {
    more.hide();
    if (!threads || !active) return;
    if (window.confirm(`Delete the chat "${active.title}"? Its messages are gone for good; what the Agent changed stays.`)) void threads.remove(active.id);
  };

  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1 border-b border-border px-2 py-1.5">
      {threads ? (
        <ThreadList threads={threads} />
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-sm">
          <span className="min-w-0 flex-1 truncate font-medium">Agent</span>
        </div>
      )}
      {threads && (
        <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={() => void threads.create()}>
          <Plus aria-hidden size={15} />
        </Button>
      )}
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
      <button
        ref={more.buttonRef}
        type="button"
        className={buttonClass("ghost", "icon-sm")}
        aria-label="More"
        title="More"
        aria-haspopup="menu"
        aria-expanded={more.open}
        onClick={more.toggle}
      >
        <Ellipsis aria-hidden size={15} />
      </button>
      <Menu ref={more.menuRef} label="Chat">
        {threads && (
          <MenuItem disabled={!active} onClick={rename}>
            Rename
          </MenuItem>
        )}
        <MenuItem
          disabled={turns.length === 0}
          onClick={() => {
            void writeClipboard(transcriptText(turns)).catch(() => {});
            more.hide();
          }}
        >
          Copy transcript
        </MenuItem>
        {threads && (
          <MenuItem danger disabled={!active} onClick={remove}>
            Delete chat
          </MenuItem>
        )}
      </Menu>
    </div>
  );
}

/** The open Thread's title, opening a popover that searches the Threads (newest first) and switches to one. */
function ThreadList({ threads }: { threads: AgentThreads }) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);
  const active = threads.active;
  const shown = matchingThreads(threads.threads ?? [], query);

  // Opened, it starts afresh, ready to type in.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    search.current?.focus();
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Chats"
        onClick={toggle}
        className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-sm hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className="min-w-0 flex-1 truncate text-left font-medium">{active?.title ?? "Agent"}</span>
        <ChevronDown aria-hidden size={14} className="shrink-0 text-muted" />
      </button>
      <div
        ref={menuRef}
        role="dialog"
        aria-label="Chats"
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 w-80 flex-col gap-1 rounded-[10px] bg-bg/90! p-2 text-text [&:popover-open]:flex"
      >
        <input
          ref={search}
          type="search"
          aria-label="Search chats"
          placeholder="Search chats"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="rounded border border-border bg-fill px-2 py-1.5 text-xs"
        />
        <ul className="flex max-h-72 flex-col overflow-y-auto">
          {shown.map((thread) => (
            <li key={thread.id}>
              <button
                type="button"
                data-thread={thread.id}
                aria-current={thread.id === active?.id ? "true" : undefined}
                onClick={() => {
                  threads.select(thread.id);
                  hide();
                }}
                className="flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill aria-[current]:bg-fill"
              >
                <Check aria-hidden size={13} className={`shrink-0 ${thread.id === active?.id ? "text-accent-text" : "invisible"}`} />
                <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                <span className="shrink-0 text-xs text-muted tabular-nums">{formatRelative(thread.updated_at)}</span>
              </button>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="px-2 py-1.5 text-xs text-muted">{threads.threads ? "No chat matches." : "Loading the chats…"}</p>}
      </div>
    </>
  );
}
