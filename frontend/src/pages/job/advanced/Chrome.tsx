import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRightToLine,
  AudioWaveform,
  Check,
  ClipboardCopy,
  ClipboardPaste,
  Copy,
  FastForward,
  Film,
  FoldHorizontal,
  Gauge,
  Keyboard,
  Layers2,
  LayoutTemplate,
  ListChecks,
  Loader2,
  Redo2,
  Scaling,
  Scissors,
  Shuffle,
  SkipBack,
  SkipForward,
  SunMedium,
  SwatchBook,
  SlidersHorizontal,
  Snowflake,
  Speech,
  StepBack,
  StepForward,
  Sticker,
  Trash2,
  Type,
  Undo2,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from "lucide-react";
import { Fragment, useEffect, useRef, type ReactNode } from "react";
import { Button } from "../../../components/Button";
import { Segmented } from "../../../components/Segmented";
import { cx, formatPrecise } from "../../../format";
import type { LoopRegion } from "../editor/loop";
import { RATES, usePlayback, type Playback } from "../editor/playback";
import type { Freezer, ItemActions, Muter, Splitter } from "./actions";
import type { Commands } from "./commands";
import type { AdvancedEdits } from "./edits";
import { keyNames, shortcutSheet } from "./keymap";
import { itemsOf, onlyItem, type Pick } from "./pick";
import { lastFrame, onFrame } from "./playhead";
import { nextEditPoint, previousEditPoint } from "./timelineView";
import type { EditHistory } from "./useEditHistory";

// The Advanced Edit's frame around its player, inspector and timeline: its bar, the asset tabs, the
// phone's toolbar, frame buttons, Playback sheet and bottom sheet, the timeline's buttons for the
// picked item, and the shortcuts sheet.

// Media holds the songs too, under its Audio category (ADR 0025): there is no Audio tab.
export type AssetTab = "text" | "stickers" | "narrate" | "media" | "transitions" | "filters" | "effects" | "templates";

export const ASSET_TABS: { value: AssetTab; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "stickers", label: "Stickers", icon: Sticker },
  { value: "narrate", label: "Narrate", icon: Speech },
  { value: "media", label: "Media", icon: Film },
  { value: "transitions", label: "Transitions", icon: Shuffle },
  { value: "filters", label: "Filters", icon: SwatchBook },
  { value: "effects", label: "Effects", icon: WandSparkles },
  { value: "templates", label: "Templates", icon: LayoutTemplate },
];

// The phone's: Video Effects are a desktop's to edit (ADR 0014), so it has no Effects tab. Its Templates sheet
// applies one, or "No Template", only.
export const PHONE_ASSET_TABS = ASSET_TABS.filter((tab) => tab.value !== "effects");

// The Asset Panel's tabs, as Concat's: each an icon over its name, the open one on a filled
// background. Their names go (kept for a screen reader and in a tooltip) when the panel is too narrow
// for all of them, as at its default width, rather than cut off the last tabs.
export function AssetTabs({ value, onChange }: { value: AssetTab; onChange: (tab: AssetTab) => void }) {
  return (
    <div role="tablist" aria-label="Assets" className="@container flex gap-0.5 border-b border-border p-1.5">
      {ASSET_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
          title={tab.label}
          className={cx(
            "flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md text-[10px] font-medium @[24rem]:min-h-13",
            "focus-visible:outline-2 focus-visible:outline-focus",
            value === tab.value ? "bg-fill text-text [&>svg]:text-accent-text" : "text-muted hover:bg-fill hover:text-text",
          )}
        >
          <tab.icon aria-hidden size={18} />
          <span className="sr-only @[24rem]:not-sr-only @[24rem]:max-w-full @[24rem]:truncate @[24rem]:px-0.5">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

// A thin rule between groups of buttons, in the top bar and the timeline's toolbar.
export function ToolDivider() {
  return <span aria-hidden className="mx-1 h-6 w-px shrink-0 bg-border" />;
}

/**
 * The Advanced Edit's top bar, as Concat's: Back on the left; the Candidate's title and its save
 * status centred (on a phone, beside Back); on the right its groups, each set off by a divider — the
 * Workspace's `layout` controls and the shortcuts sheet, the document `actions` (Downloads, Save Frame,
 * Revision History, Save as Template), then the `primary` action, Export. Undo and redo are the
 * timeline toolbar's.
 */
export function TopBar({
  title,
  status,
  layout,
  actions,
  primary,
  onShortcuts,
  onClose,
}: {
  title: string;
  status: ReactNode;
  // The Workspace's collapses and reset: a desktop's.
  layout?: ReactNode;
  // Document actions, such as the Revision History.
  actions?: ReactNode;
  // The editor's main action, such as Export: last, set off by a divider.
  primary?: ReactNode;
  // Opens the shortcuts sheet: on a desktop only.
  onShortcuts?: () => void;
  onClose: () => void;
}) {
  const view = (layout || onShortcuts) && (
    <>
      {layout}
      {onShortcuts && (
        <Button variant="ghost" size="icon" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
          <Keyboard aria-hidden size={18} />
        </Button>
      )}
    </>
  );
  return (
    <header className="grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-border px-2 pt-[env(safe-area-inset-top)] sm:grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] sm:px-3">
      <div className="flex min-w-0 items-center">
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Back to the clip editor" title="Back to the clip editor">
          <ArrowLeft aria-hidden size={18} />
        </Button>
      </div>
      <div className="flex min-w-0 flex-col sm:items-center sm:text-center">
        <h1 className="max-w-full truncate text-sm font-semibold sm:text-base">{title}</h1>
        <div className="max-w-full truncate text-xs text-muted">{status}</div>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-1">
        {view}
        {view && actions && <ToolDivider />}
        {actions}
        {primary && (
          <>
            {(view || actions) && <ToolDivider />}
            {primary}
          </>
        )}
      </div>
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
 * The phone's bottom bar: the asset tabs and Pick, or what can be done to the picked items (with
 * Transform, for an Overlay or a Segment picked alone, opening the Transform sheet, and Speed, for a
 * Segment or a video Overlay picked alone, the Speed sheet; Filters and Adjust, for the picked
 * Segments, Overlays and Adjustment Layers or with nothing picked the whole Clip, their sheets: with
 * nothing picked, Filters is the asset tab's; Audio effects, for the picked items with sound, its
 * sheet). Freeze frame sits beside Split. In picking
 * mode (`picking`, started by Pick), a tap adds an item to the Pick or takes it out, and the bar counts
 * them and offers what can be done to them all, Paste while the Clipboard holds something
 * (`paste`), and Done.
 */
export function Toolbar({
  pick,
  actions,
  splitter,
  freezer,
  playback,
  picking,
  paste,
  mute,
  onAsset,
  onInspect,
  onTransform,
  onSpeed,
  onFilters = null,
  onAdjust = null,
  onAudioEffects = null,
  onTracks,
  onPlayback,
  onPicking,
  onDeselect,
}: {
  pick: Pick;
  actions: ItemActions | null;
  splitter: Splitter;
  freezer: Freezer;
  playback: Playback;
  picking: boolean;
  paste: (() => void) | null;
  // Mute or unmute the Pick, by M's rule (actions.ts' `muter`): null, and shown off, when it has no sound.
  mute: Muter | null;
  onAsset: (tab: AssetTab) => void;
  onInspect: () => void;
  // Opens the Transform sheet: the picked picture's Transform, Crop and Background or decoration.
  onTransform: () => void;
  // Opens the Speed sheet of the Segment or video Overlay picked alone (actions.ts'
  // `speedSheetItem`): null for any other pick.
  onSpeed: (() => void) | null;
  // Open the Filters and Adjust sheets of the Pick's Grades (or the Candidate's, with nothing picked):
  // null while the Pick has none.
  onFilters?: (() => void) | null;
  onAdjust?: (() => void) | null;
  // Opens the Audio effects sheet of the Pick's items with sound (AudioEffectsFields'
  // `audioEffectChanges`): null while it has none, as with a Freeze frame or an image.
  onAudioEffects?: (() => void) | null;
  // Opens the Tracks sheet: their buttons, and the Magnetic timeline's switch.
  onTracks: () => void;
  // Opens the Playback sheet: the rate, the Loop Region and the Edit Point jumps.
  onPlayback: () => void;
  onPicking: () => void;
  onDeselect: () => void;
}) {
  const count = itemsOf(pick).length;
  const only = onlyItem(pick);
  const picture = only?.kind === "overlay" || only?.kind === "segment";
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
          <MuteButton mute={mute} />
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
          {picture && <ToolButton icon={Scaling} label="Transform" onClick={onTransform} />}
          {onSpeed && <ToolButton icon={FastForward} label="Speed" onClick={onSpeed} />}
          {onFilters && <ToolButton icon={SwatchBook} label="Filters" onClick={onFilters} />}
          {onAdjust && <ToolButton icon={SunMedium} label="Adjust" onClick={onAdjust} />}
          {onAudioEffects && <ToolButton icon={AudioWaveform} label="Audio effects" onClick={onAudioEffects} />}
          <MuteButton mute={mute} />
          {actions && (
            <>
              <SplitButton splitter={splitter} playback={playback} />
              <FreezeButton freezer={freezer} playback={playback} />
              <ToolButton icon={Copy} label="Duplicate" onClick={actions.duplicate} />
              <ToolButton icon={Trash2} label="Delete" onClick={actions.remove} />
              <ToolButton icon={FoldHorizontal} label="Ripple" onClick={actions.rippleRemove} />
            </>
          )}
          <ToolButton icon={ListChecks} label="Pick" onClick={onPicking} />
        </>
      ) : (
        <>
          {/* Adjust sits beside the Filters tab: both are the Clip's Grade with nothing picked. */}
          {PHONE_ASSET_TABS.map((tab) => (
            <Fragment key={tab.value}>
              <ToolButton icon={tab.icon} label={tab.label} onClick={() => onAsset(tab.value)} />
              {tab.value === "filters" && onAdjust && <ToolButton icon={SunMedium} label="Adjust" onClick={onAdjust} />}
            </Fragment>
          ))}
          <SplitButton splitter={splitter} playback={playback} />
          <FreezeButton freezer={freezer} playback={playback} />
          <PlaybackButton playback={playback} onClick={onPlayback} />
          <ToolButton icon={Layers2} label="Tracks" onClick={onTracks} />
          <ToolButton icon={ListChecks} label="Pick" onClick={onPicking} />
        </>
      )}
    </nav>
  );
}

// The toolbar's Mute: Unmute, with a speaker, once every picked item with sound is Muted; off without one.
function MuteButton({ mute }: { mute: Muter | null }) {
  return mute?.muted ? (
    <ToolButton icon={Volume2} label="Unmute" onClick={mute.toggle} />
  ) : (
    <ToolButton icon={VolumeX} label="Mute" onClick={() => mute?.toggle()} disabled={!mute} />
  );
}

function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  lit = false,
}: {
  icon: typeof Type;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  // In the accent: something set away from its default, such as the rate.
  lit?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex min-h-14 min-w-16 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-medium whitespace-nowrap hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-40",
        lit ? "text-accent-text" : "text-muted",
      )}
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
      // What sizes its controls for a finger (KeyCluster's buttons).
      data-sheet=""
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

// The timeline toolbar's first group: undo and redo, next to the edits they take back.
export function HistoryTools({ history }: { history: EditHistory<AdvancedEdits> }) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  return (
    <>
      <Button variant="ghost" size="icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo" title={`Undo (${shortcut}Z)`}>
        <Undo2 aria-hidden size={17} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={history.redo}
        disabled={!history.canRedo}
        aria-label="Redo"
        title={`Redo (${shortcut === "⌘" ? "⇧⌘Z" : "Ctrl+Y"})`}
      >
        <Redo2 aria-hidden size={17} />
      </Button>
    </>
  );
}

// The timeline toolbar's adding group: Text opens the Text tab, Audio the Media tab on its Audio
// category (on a phone, their sheets), revealing the Asset Panel if it was collapsed.
export function AddTools({ onText, onAudio }: { onText: () => void; onAudio: () => void }) {
  return (
    <>
      <Button variant="ghost" size="icon" onClick={onText} aria-label="Add text" title="Add text: the Text tab">
        <Type aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onAudio} aria-label="Add audio" title="Add audio: the Media tab's Audio">
        <Volume2 aria-hidden size={17} />
      </Button>
    </>
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
  freezer,
  playback,
  paste,
}: {
  actions: ItemActions | null;
  splitter: Splitter;
  freezer: Freezer;
  playback: Playback;
  paste: (() => void) | null;
}) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const splittable = usePlayback(playback, splitter.canSplit);
  const freezable = usePlayback(playback, freezer.canFreeze);
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
      <Button
        variant="ghost"
        size="icon"
        onClick={freezer.freeze}
        disabled={!freezable}
        aria-label="Freeze frame"
        title={`Freeze frame (${shortcut === "⌘" ? "⇧F" : "Shift+F"}): hold the frame at the playhead for a second`}
      >
        <Snowflake aria-hidden size={17} />
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

// The phone toolbar's Freeze frame, enabled while the playhead is on a Segment far enough from its
// edges (actions.ts' `canFreezeAt`).
function FreezeButton({ freezer, playback }: { freezer: Freezer; playback: Playback }) {
  const freezable = usePlayback(playback, freezer.canFreeze);
  return <ToolButton icon={Snowflake} label="Freeze frame" onClick={freezer.freeze} disabled={!freezable} />;
}

// The phone toolbar's Playback, which says the rate whenever it isn't 1×, so that a fast preview
// isn't taken for a fast Clip.
function PlaybackButton({ playback, onClick }: { playback: Playback; onClick: () => void }) {
  const rate = usePlayback(playback, (_, p) => p.rate);
  return <ToolButton icon={Gauge} label={rate === 1 ? "Playback" : `Playback ${rate}×`} onClick={onClick} lit={rate !== 1} />;
}

/**
 * The deck Transport's buttons either side of Play: `before`, go to the start (Home) and a frame back
 * (←); `after`, a frame on (→) and go to the last frame (End), each by its command (./commands.ts), off
 * at its end of the Clip.
 */
export function DeckButtons({
  side,
  playback,
  fps,
  commands,
}: {
  side: "before" | "after";
  playback: Playback;
  fps: number;
  commands: Commands;
}) {
  const first = usePlayback(playback, (time) => onFrame(time, fps) <= 0);
  const last = usePlayback(playback, (time, p) => onFrame(time, fps) >= lastFrame(p.duration, fps));
  return side === "before" ? (
    <>
      <Button variant="ghost" size="icon" onClick={commands.start} disabled={first} aria-label="Go to start" aria-keyshortcuts="Home" title="Go to start (Home)">
        <SkipBack aria-hidden size={18} />
      </Button>
      <Button variant="ghost" size="icon" onClick={commands["step-back"]} disabled={first} aria-label="One frame back" aria-keyshortcuts="ArrowLeft" title="One frame back (←)">
        <StepBack aria-hidden size={18} />
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="icon" onClick={commands["step-forward"]} disabled={last} aria-label="One frame forward" aria-keyshortcuts="ArrowRight" title="One frame forward (→)">
        <StepForward aria-hidden size={18} />
      </Button>
      <Button variant="ghost" size="icon" onClick={commands.end} disabled={last} aria-label="Go to end" aria-keyshortcuts="End" title="Go to end (End)">
        <SkipForward aria-hidden size={18} />
      </Button>
    </>
  );
}

/** The player panel's header line: the Canvas in output pixels and the frame rate, e.g. "1080 × 1920 · 30 fps". */
export function previewFormat(canvas: { width: number; height: number }, fps: number): string {
  return `${canvas.width} × ${canvas.height} · ${Number(fps.toFixed(2))} fps`;
}

/** The player panel's header, as Concat's: "Preview", the Canvas and frame rate (previewFormat), and `picker` (the Canvas Aspect). */
export function PreviewHeader({ format, picker }: { format: string; picker?: ReactNode }) {
  return (
    <div className="@container flex min-h-11 shrink-0 items-center gap-2 border-b border-border px-3 py-1">
      <h2 className="shrink-0 text-sm font-semibold">Preview</h2>
      <p className="min-w-0 flex-1 truncate text-center text-xs text-muted tabular-nums">{format}</p>
      <div className="shrink-0">{picker}</div>
    </div>
  );
}

const RATE_CHOICES = RATES.map((rate) => ({ value: String(rate), label: `${rate}×` }));

/**
 * The phone's Playback sheet: the preview's rate; In, Out, Loop and Clear of the Loop Region
 * (`region`, played while `looping`); and the playhead to the previous or next of `editPoints`. Each
 * button runs the command of its key (./commands.ts); a jump is off when there is no Edit Point past
 * the playhead that way.
 */
export function PlaybackPanel({
  playback,
  commands,
  region,
  looping,
  editPoints,
  fps,
}: {
  playback: Playback;
  commands: Commands;
  region: LoopRegion | null;
  looping: boolean;
  editPoints: number[];
  fps: number;
}) {
  const rate = usePlayback(playback, (_, p) => p.rate);
  const before = usePlayback(playback, (time) => previousEditPoint(editPoints, time, fps) !== null);
  // The Clip's end is jumped to on its last frame, so there is nothing after that.
  const after = usePlayback(
    playback,
    (time, p) => nextEditPoint(editPoints, time, fps) !== null && onFrame(time, fps) < lastFrame(p.duration, fps),
  );
  return (
    <div className="flex flex-col gap-5">
      <Segmented legend="Rate" options={RATE_CHOICES} value={String(rate)} onChange={(value) => playback.setRate(Number(value))} />
      <section aria-labelledby="playback-loop" className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 id="playback-loop" className="text-sm font-medium">
            Loop Region
          </h3>
          <p aria-live="polite" className="text-xs text-muted tabular-nums">
            {region ? `${formatPrecise(region.in)} to ${formatPrecise(region.out)}${looping ? ", looping" : ""}` : "No marks"}
          </p>
        </div>
        <div className="grid grid-cols-4 gap-2">
          <Button onClick={commands["mark-in"]} aria-label="Mark In at the playhead">
            In
          </Button>
          <Button onClick={commands["mark-out"]} aria-label="Mark Out at the playhead">
            Out
          </Button>
          <Button onClick={commands.loop} aria-pressed={looping} className="aria-pressed:text-accent-text">
            Loop
          </Button>
          <Button onClick={commands["clear-marks"]} disabled={!region} aria-label="Clear the marks and stop looping">
            Clear
          </Button>
        </div>
      </section>
      <section aria-labelledby="playback-edit-points" className="flex flex-col gap-2">
        <h3 id="playback-edit-points" className="text-sm font-medium">
          Edit Points
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={commands["edit-point-previous"]} disabled={!before}>
            <ArrowLeftToLine aria-hidden size={16} />
            Previous
          </Button>
          <Button onClick={commands["edit-point-next"]} disabled={!after}>
            Next
            <ArrowRightToLine aria-hidden size={16} />
          </Button>
        </div>
      </section>
    </div>
  );
}
