import { AlertCircle, ArrowLeft, AudioLines, Check, ClipboardCopy, ClipboardPaste, Copy, Film, FoldHorizontal, Keyboard, Layers2, ListChecks, Loader2, Redo2, Scissors, Shuffle, SlidersHorizontal, Trash2, Type, Undo2, X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "../../../components/Button";
import { cx } from "../../../format";
import { usePlayback, type Playback } from "../editor/playback";
import type { ItemActions, Splitter } from "./actions";
import type { AdvancedEdits } from "./edits";
import { keyNames, shortcutSheet } from "./keymap";
import { itemsOf, type Pick } from "./pick";
import type { EditHistory } from "./useEditHistory";

// The Advanced Edit's frame around its player, inspector and timeline: its bar, the asset tabs, the
// phone's toolbar and bottom sheet, the timeline's buttons for the picked item, and the shortcuts sheet.

export type AssetTab = "text" | "audio" | "media" | "transitions";

export const ASSET_TABS: { value: AssetTab; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "media", label: "Media", icon: Film },
  { value: "transitions", label: "Transitions", icon: Shuffle },
];

export function AssetTabs({ value, onChange }: { value: AssetTab; onChange: (tab: AssetTab) => void }) {
  return (
    <div role="tablist" aria-label="Assets" className="flex gap-1 border-b border-border p-2">
      {ASSET_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          className={cx(
            "flex min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-medium",
            "focus-visible:outline-2 focus-visible:outline-focus",
            value === tab.value ? "raised text-text" : "text-muted hover:bg-fill hover:text-text",
          )}
        >
          <tab.icon aria-hidden size={18} />
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TopBar({
  title,
  status,
  history,
  actions,
  onShortcuts,
  onClose,
}: {
  title: string;
  status: ReactNode;
  history: EditHistory<AdvancedEdits>;
  // Beside undo and redo, such as the Revision History.
  actions?: ReactNode;
  // Opens the shortcuts sheet: on a desktop only.
  onShortcuts?: () => void;
  onClose: () => void;
}) {
  return (
    <header className="flex min-h-14 items-center gap-2 px-2 pt-[env(safe-area-inset-top)] sm:px-3">
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to the clip editor">
        <ArrowLeft aria-hidden size={18} />
      </Button>
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-sm font-semibold sm:text-base">{title}</h1>
        <div className="truncate text-xs text-muted">{status}</div>
      </div>
      {actions}
      {onShortcuts && (
        <Button variant="ghost" size="icon" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard aria-hidden size={18} />
        </Button>
      )}
      <Button variant="ghost" size="icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo">
        <Undo2 aria-hidden size={18} />
      </Button>
      <Button variant="ghost" size="icon" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">
        <Redo2 aria-hidden size={18} />
      </Button>
    </header>
  );
}

export function SaveStatus({
  saving,
  saved,
  error,
  offline = false,
  action,
}: {
  saving: boolean;
  saved: boolean;
  error: string | null;
  // The live connection to the backend dropped: changes made elsewhere aren't seen until it is back.
  offline?: boolean;
  // Offered beside the error, such as reloading a Candidate changed elsewhere.
  action?: ReactNode;
}) {
  return (
    <span aria-live="polite" className="inline-flex items-center gap-1">
      {error ? (
        <span className="inline-flex items-center gap-1 text-danger">
          <AlertCircle aria-hidden size={13} />
          {error}
          {action}
        </span>
      ) : offline ? (
        <>
          <Loader2 aria-hidden size={13} className="motion-safe:animate-spin" />
          Reconnecting…
        </>
      ) : saving ? (
        <>
          <Loader2 aria-hidden size={13} className="motion-safe:animate-spin" />
          Saving…
        </>
      ) : saved ? (
        <>
          <Check aria-hidden size={13} className="text-success" />
          All changes saved
        </>
      ) : (
        "Advanced Edit"
      )}
    </span>
  );
}

/**
 * The phone's bottom bar: the asset tabs and Pick, or what can be done to the picked items. In picking
 * mode (`picking`, started by Pick), a tap adds an item to the Pick or takes it out, and the bar counts
 * them and offers what can be done to them all, Paste while the Clipboard holds something
 * (`paste`), and Done.
 */
export function Toolbar({
  pick,
  actions,
  splitter,
  playback,
  picking,
  paste,
  onAsset,
  onInspect,
  onTracks,
  onPicking,
  onDeselect,
}: {
  pick: Pick;
  actions: ItemActions | null;
  splitter: Splitter;
  playback: Playback;
  picking: boolean;
  paste: (() => void) | null;
  onAsset: (tab: AssetTab) => void;
  onInspect: () => void;
  // Opens the Tracks sheet: their buttons, and the Magnetic timeline's switch.
  onTracks: () => void;
  onPicking: () => void;
  onDeselect: () => void;
}) {
  const count = itemsOf(pick).length;
  return (
    <nav
      aria-label="Tools"
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-border px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      {picking ? (
        <>
          <ToolButton icon={Check} label="Done" onClick={onDeselect} />
          <p aria-live="polite" className="flex min-w-16 flex-1 items-center justify-center text-[11px] font-medium text-text tabular-nums">
            {count} picked
          </p>
          <ToolButton icon={SlidersHorizontal} label="Edit" onClick={onInspect} disabled={!count} />
          <ToolButton icon={Copy} label="Duplicate" onClick={() => actions?.duplicate()} disabled={!actions} />
          <ToolButton icon={ClipboardCopy} label="Copy" onClick={() => actions?.copy()} disabled={!actions} />
          <ToolButton icon={ClipboardPaste} label="Paste" onClick={() => paste?.()} disabled={!paste} />
          <ToolButton icon={Trash2} label="Delete" onClick={() => actions?.remove()} disabled={!actions} />
          <ToolButton icon={FoldHorizontal} label="Ripple" onClick={() => actions?.rippleRemove()} disabled={!actions} />
        </>
      ) : pick ? (
        <>
          <ToolButton icon={X} label="Done" onClick={onDeselect} />
          <ToolButton icon={SlidersHorizontal} label="Edit" onClick={onInspect} />
          {actions && (
            <>
              <SplitButton splitter={splitter} playback={playback} />
              <ToolButton icon={Copy} label="Duplicate" onClick={actions.duplicate} />
              <ToolButton icon={Trash2} label="Delete" onClick={actions.remove} />
              <ToolButton icon={FoldHorizontal} label="Ripple" onClick={actions.rippleRemove} />
            </>
          )}
          <ToolButton icon={ListChecks} label="Pick" onClick={onPicking} />
        </>
      ) : (
        <>
          {ASSET_TABS.map((tab) => (
            <ToolButton key={tab.value} icon={tab.icon} label={tab.label} onClick={() => onAsset(tab.value)} />
          ))}
          <SplitButton splitter={splitter} playback={playback} />
          <ToolButton icon={Layers2} label="Tracks" onClick={onTracks} />
          <ToolButton icon={ListChecks} label="Pick" onClick={onPicking} />
        </>
      )}
    </nav>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: typeof Type;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 min-w-16 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-medium text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40"
    >
      <Icon aria-hidden size={20} />
      {label}
    </button>
  );
}

/** A bottom sheet over the timeline, on a phone. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <section
      aria-label={title}
      className="glass fixed inset-x-0 bottom-0 z-40 flex max-h-[min(60dvh,32rem)] flex-col rounded-t-panel border-b-0 pb-[env(safe-area-inset-bottom)] motion-safe:animate-[sheet-in_220ms_var(--ease-out)]"
    >
      <div className="flex min-h-12 items-center justify-between gap-2 px-4 pt-1">
        <h2 className="font-semibold">{title}</h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X aria-hidden size={18} />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">{children}</div>
    </section>
  );
}

/**
 * The shortcuts sheet, on a desktop: every row of the keymap table by its group, its keys named as
 * this computer's keyboard writes them. A modal on the native <dialog>, closed with Esc or a click
 * beside it; while it is open, the keys pressed in it don't reach the editor's shortcuts.
 */
export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="shortcuts-title"
      // A click inside it focuses it, so that the keys pressed after stay in it.
      tabIndex={-1}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.target === event.currentTarget && onClose()}
      className={cx(
        "glass m-auto max-h-[min(44rem,calc(100dvh-4rem))] w-[min(40rem,calc(100%-2rem))] overflow-y-auto overscroll-contain rounded-panel bg-bg/85! p-0 text-text outline-none backdrop:bg-black/50",
        "scale-100 opacity-100 starting:open:scale-95 starting:open:opacity-0",
        "motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-6 pt-4 pb-2">
        <h2 id="shortcuts-title" className="text-lg font-semibold">
          Keyboard shortcuts
        </h2>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
          <X aria-hidden size={18} />
        </Button>
      </div>
      <div className="flex flex-col gap-5 px-6 pb-6">
        {shortcutSheet().map((group) => (
          <section key={group.group} aria-labelledby={`shortcuts-${group.group}`}>
            <h3 id={`shortcuts-${group.group}`} className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
              {group.label}
            </h3>
            <dl className="divide-y divide-border">
              {group.shortcuts.map((shortcut) => (
                <div key={shortcut.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                  <dt className="text-pretty">{shortcut.label}</dt>
                  <dd className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
                    {keyNames(shortcut, mac).map((name, i) => (
                      <span key={name} className="contents">
                        {i > 0 && "or"}
                        <kbd className="raised min-w-7 rounded-md px-1.5 py-1 text-center font-sans font-medium text-text">{name}</kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}

/**
 * The timeline bar's buttons: split at the playhead (the picked items, or with nothing picked
 * everything there); for the picked items, duplicate, copy and delete; and paste what the Clipboard
 * holds (`paste`).
 */
export function ItemTools({
  actions,
  splitter,
  playback,
  paste,
}: {
  actions: ItemActions | null;
  splitter: Splitter;
  playback: Playback;
  paste: (() => void) | null;
}) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const splittable = usePlayback(playback, splitter.canSplit);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={splitter.split}
        disabled={!splittable}
        aria-label="Split at the playhead"
        title={`Split at the playhead (${shortcut}B): the picked items, or with nothing picked, everything there`}
      >
        <Scissors aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={actions?.duplicate} disabled={!actions} aria-label="Duplicate" title={`Duplicate (${shortcut}D)`}>
        <Copy aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={actions?.copy} disabled={!actions} aria-label="Copy" title={`Copy (${shortcut}C)`}>
        <ClipboardCopy aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={() => paste?.()} disabled={!paste} aria-label="Paste" title={`Paste at the playhead (${shortcut}V)`}>
        <ClipboardPaste aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={actions?.remove} disabled={!actions} aria-label="Delete" title="Delete (Shift+Delete closes the gap)">
        <Trash2 aria-hidden size={17} />
      </Button>
    </>
  );
}

// The phone toolbar's Split, enabled while the playhead is inside a picked item, or with nothing
// picked inside any.
function SplitButton({ splitter, playback }: { splitter: Splitter; playback: Playback }) {
  const splittable = usePlayback(playback, splitter.canSplit);
  return <ToolButton icon={Scissors} label="Split" onClick={splitter.split} disabled={!splittable} />;
}
