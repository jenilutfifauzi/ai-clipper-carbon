import { AlertCircle, ArrowLeft, AudioLines, Check, Copy, Film, Loader2, Redo2, Scissors, Shuffle, SlidersHorizontal, Trash2, Type, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type FontInfo,
  type JobDetail,
  type PreviewPlan,
  type TextLayer,
} from "../../../api";
import { Button } from "../../../components/Button";
import { Panel } from "../../../components/Panel";
import { loadFonts } from "../../../fonts";
import { cx } from "../../../format";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { candidateName } from "../CandidateList";
import { ClipPreview } from "../editor/ClipPreview";
import { candidateDraft } from "../editor/draft";
import { Playback, usePlayback } from "../editor/playback";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { HookTimingFields } from "../HookEditor";
import { AdvancedTimeline, TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { editsOf, sameSelection, type AdvancedEdits, type Selection } from "./edits";
import { MediaAssets, useMediaLibrary, type MediaLibrary } from "./MediaLibrary";
import { newId, newTextLayer, TEXT_MIN_SECS, textLanes, TextAssets, TextLayerFields } from "./TextLayers";
import { useEditHistory, type EditHistory } from "./useEditHistory";

// The Job statuses in which its Candidates can be changed (EDITABLE in backend/app/api.py).
const EDITABLE = new Set(["review", "rendering"]);
// From this width on, the desktop layout: assets, player and inspector side by side over the timeline.
const WIDE = "(min-width: 64rem)";

type AssetTab = "text" | "audio" | "media" | "transitions";

const ASSET_TABS: { value: AssetTab; label: string; icon: typeof Type }[] = [
  { value: "text", label: "Text", icon: Type },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "media", label: "Media", icon: Film },
  { value: "transitions", label: "Transitions", icon: Shuffle },
];

/**
 * The Advanced Edit of a Candidate (/jobs/:jobId/candidates/:candidateId/advanced): a CapCut-like
 * workspace over the same Candidate as the clip editor, saving through the same update and
 * previewing through the same Preview Plan. Full screen, outside the app's shell.
 */
export function AdvancedEditPage() {
  const { jobId = "", candidateId = "" } = useParams();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getJob(jobId).then(setJob, (reason: Error) => setError(reason.message));
  }, [jobId]);

  const index = job?.candidates?.findIndex((candidate) => candidate.id === candidateId) ?? -1;
  const back = `/jobs/${jobId}${candidateId ? `?candidate=${candidateId}` : ""}`;
  if (error || (job && (index < 0 || !job.source || !EDITABLE.has(job.status)))) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4">
        <Panel className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold">Can't edit this clip here</h1>
          <p className="text-muted">
            {error ??
              (index < 0
                ? "This Job has no such clip."
                : "Clips can be edited once the Job is in review.")}
          </p>
          <Link to={back} className="inline-flex min-h-11 items-center gap-1.5 self-start text-accent-text hover:underline">
            <ArrowLeft aria-hidden size={16} />
            Back to the Job
          </Link>
        </Panel>
      </div>
    );
  }
  if (!job || !job.candidates) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <p role="status" className="flex items-center gap-2 text-muted">
          <Loader2 aria-hidden size={18} className="motion-safe:animate-spin" />
          Opening the editor
        </p>
      </div>
    );
  }
  return <Workspace key={candidateId} job={job} initial={job.candidates[index]} index={index} />;
}

function Workspace({ job, initial, index }: { job: JobDetail; initial: Candidate; index: number }) {
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState(initial);
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  // On a phone: the sheet open over the timeline, of an asset tab or of the inspector.
  const [sheet, setSheet] = useState<AssetTab | "inspector" | null>(null);
  const [assetTab, setAssetTab] = useState<AssetTab>("text");
  const wide = useMediaQuery(WIDE);
  const library = useMediaLibrary();

  const save = useCallback(
    async (change: CandidateChange) => {
      setSaving((n) => n + 1);
      setSaveError(null);
      try {
        setCandidate(await api.updateCandidate(job.id, initial.id, change));
        setSaved(true);
      } catch (reason) {
        setSaveError(`Not saved: ${(reason as Error).message}`);
      } finally {
        setSaving((n) => n - 1);
      }
    },
    [job.id, initial.id],
  );
  const history = useEditHistory<AdvancedEdits>(editsOf(initial), save);
  const edits = history.value;
  const draft: CandidateChange = { ...candidateDraft(candidate), ...edits };
  const { preview, error: previewError } = usePreviewPlan(job.id, candidate.id, draft, job.status);
  const playback = useMemo(() => new Playback(), []);
  playback.setRange(candidate.start, candidate.end);
  const duration = candidate.end - candidate.start;

  useEffect(() => {
    loadFonts().then(setFonts, () => setFonts([]));
  }, []);

  function change(next: Partial<AdvancedEdits>, group?: string) {
    history.set({ ...edits, ...next }, group);
  }
  const textOf = (id: string) => edits.text_layers.find((layer) => layer.id === id);
  const selectedText = selection?.kind === "text" ? textOf(selection.id) ?? null : null;

  function addText(look: Omit<TextLayer, "id" | "start" | "secs">) {
    const layer = newTextLayer(look, playback.time, duration);
    change({ text_layers: [...edits.text_layers, layer] });
    select({ kind: "text", id: layer.id });
    // On a phone, straight to its fields, to type its words.
    setSheet(wide ? null : "inspector");
  }
  function updateText(layer: TextLayer, group?: string) {
    change({ text_layers: edits.text_layers.map((old) => (old.id === layer.id ? layer : old)) }, group);
  }
  // What the selected item allows: the hook can only be moved.
  const actions = selectedText && {
    remove() {
      change({ text_layers: edits.text_layers.filter((layer) => layer.id !== selectedText.id) });
      select(null);
    },
    duplicate() {
      // Right after it when there is room, else over it, a little lower.
      const after = selectedText.start + selectedText.secs;
      const copy =
        after + selectedText.secs <= duration + 1e-6
          ? { ...selectedText, id: newId(), start: after }
          : { ...selectedText, id: newId(), y: Math.min(selectedText.y + 80, 1920) };
      change({ text_layers: [...edits.text_layers, copy] });
      select({ kind: "text", id: copy.id });
    },
    canSplit: (time: number) => time > selectedText.start + TEXT_MIN_SECS && time < selectedText.start + selectedText.secs - TEXT_MIN_SECS,
    // In two at the playhead, when it is inside.
    split() {
      const at = Math.round(playback.time * 100) / 100;
      const { start, secs } = selectedText;
      if (!(at > start + TEXT_MIN_SECS && at < start + secs - TEXT_MIN_SECS)) return;
      const second = { ...selectedText, id: newId(), start: at, secs: round(start + secs - at) };
      const layers = edits.text_layers.flatMap((layer) => (layer.id === selectedText.id ? [{ ...layer, secs: round(at - start) }, second] : [layer]));
      change({ text_layers: layers });
      select({ kind: "text", id: second.id });
    },
  };
  useShortcuts(history, playback, actions);

  async function close() {
    await history.flush();
    navigate(`/jobs/${job.id}?candidate=${candidate.id}`);
  }

  function select(next: Selection) {
    setSelection((old) => (sameSelection(old, next) ? old : next));
  }

  const source = job.source!;
  const player = (
    <ClipPreview
      src={mediaUrl(job.id, source.preview ?? source.video)}
      preview={preview}
      fonts={fonts}
      playback={playback}
      texts={{
        selected: selectedText?.id ?? null,
        onSelect: (id) => select({ kind: "text", id }),
        onMove: (id, x, y, group) => {
          const layer = textOf(id);
          if (layer) updateText({ ...layer, x, y }, group);
        },
      }}
      fit
    />
  );
  const timeline = (
    <AdvancedTimeline
      duration={duration}
      playback={playback}
      snapPoints={snapPoints(edits, preview)}
      tools={<ItemTools actions={actions} playback={playback} />}
    >
      {(geometry) => (
        <Tracks
          geometry={geometry}
          duration={duration}
          preview={preview}
          edits={edits}
          selection={selection}
          playback={playback}
          onSelect={select}
          onEdits={history.set}
          onText={updateText}
          onDelete={actions ? actions.remove : undefined}
        />
      )}
    </AdvancedTimeline>
  );
  const inspector = (
    <Inspector
      selection={selection}
      edits={edits}
      duration={duration}
      candidate={candidate}
      preview={preview}
      fonts={fonts}
      actions={actions}
      onEdits={history.set}
      onText={updateText}
    />
  );
  const status = <SaveStatus saving={saving > 0} saved={saved} error={saveError} />;
  const bar = (
    <TopBar
      title={`#${index + 1} ${candidateName(candidate, index)}`}
      status={status}
      history={history}
      onClose={() => void close()}
    />
  );
  const notes = previewError && <p className="text-center text-sm text-danger">Couldn't preview: {previewError}</p>;

  if (wide) {
    return (
      <div className="flex h-dvh flex-col gap-3 overflow-hidden bg-bg pb-3">
        {bar}
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_20rem] gap-3 px-3">
          <aside aria-label="Assets" className="glass flex min-h-0 flex-col overflow-hidden rounded-panel">
            <AssetTabs value={assetTab} onChange={setAssetTab} />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <AssetPanel tab={assetTab} fonts={fonts} library={library} onAddText={addText} />
            </div>
          </aside>
          <section aria-label="Player" className="flex min-h-0 flex-col gap-2">
            {player}
            {notes}
          </section>
          <aside aria-label="Inspector" className="glass min-h-0 overflow-y-auto rounded-panel p-4">
            {inspector}
          </aside>
        </div>
        <section aria-label="Timeline" className="glass mx-3 flex h-[36dvh] min-h-60 flex-col overflow-hidden rounded-panel">
          {timeline}
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      {bar}
      <section aria-label="Player" className="flex min-h-0 flex-1 flex-col gap-1 px-3 pt-1 pb-2">
        {player}
        {notes}
      </section>
      <section aria-label="Timeline" className="flex h-[30dvh] min-h-44 flex-col border-t border-border">
        {timeline}
      </section>
      <Toolbar
        selection={selection}
        actions={actions}
        playback={playback}
        onAsset={(tab) => {
          setAssetTab(tab);
          setSheet(tab);
        }}
        onInspect={() => setSheet("inspector")}
        onDeselect={() => {
          select(null);
          setSheet(null);
        }}
      />
      {sheet && (
        <Sheet
          title={sheet === "inspector" ? "Edit" : ASSET_TABS.find((tab) => tab.value === sheet)!.label}
          onClose={() => setSheet(null)}
        >
          {sheet === "inspector" ? inspector : <AssetPanel tab={sheet} fonts={fonts} library={library} onAddText={addText} />}
        </Sheet>
      )}
    </div>
  );
}

interface ItemActions {
  remove: () => void;
  duplicate: () => void;
  // Whether the item can be split at `time`: when it is inside it.
  canSplit: (time: number) => boolean;
  // At the playhead; nothing when it can't be.
  split: () => void;
}

// Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y), Space to play, and for the selected item
// Delete, Cmd/Ctrl+D to duplicate it and Cmd/Ctrl+B to split it; except while typing.
function useShortcuts(history: EditHistory<AdvancedEdits>, playback: Playback, actions: ItemActions | null) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      } else if (command && key === "y") {
        event.preventDefault();
        history.redo();
      } else if (key === " " && target === document.body) {
        event.preventDefault();
        playback.toggle();
      } else if (actions && (key === "delete" || key === "backspace") && !target.closest("[role=button], button")) {
        event.preventDefault();
        actions.remove();
      } else if (actions && command && key === "d") {
        event.preventDefault();
        actions.duplicate();
      } else if (actions && command && key === "b") {
        event.preventDefault();
        actions.split();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, playback, actions]);
}

// The edges items snap to, besides the playhead and the Clip's ends.
function snapPoints(edits: AdvancedEdits, preview: PreviewPlan | null): number[] {
  const points = [edits.hook_start, edits.hook_start + edits.hook_secs];
  for (const layer of edits.text_layers) points.push(layer.start, layer.start + layer.secs);
  for (const scene of preview?.plan.scenes ?? []) points.push(scene.start);
  return points;
}

/** The tracks, top to bottom: the Text Layers' lanes, the Clip and its Scenes, its caption lines, and the hook. */
function Tracks({
  geometry,
  duration,
  preview,
  edits,
  selection,
  playback,
  onSelect,
  onEdits,
  onText,
  onDelete,
}: {
  geometry: TimeGeometry;
  duration: number;
  preview: PreviewPlan | null;
  edits: AdvancedEdits;
  selection: Selection;
  playback: Playback;
  onSelect: (selection: Selection) => void;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  // Deletes the selected item.
  onDelete?: () => void;
}) {
  const { pps } = geometry;
  const plan = preview?.plan ?? null;
  const hookEnd = Math.min(edits.hook_start + edits.hook_secs, duration);
  // The first lane next to the video, later ones above it.
  const lanes = textLanes(edits.text_layers).reverse();
  return (
    <>
      {(lanes.length ? lanes : [[]]).map((lane, i) => (
        <TrackRow key={lanes.length - i} label={i === lanes.length - 1 || !lanes.length ? "Text" : ""}>
          {lane.map((layer) => {
            const selected = selection?.kind === "text" && selection.id === layer.id;
            return (
              <TimelineItem
                key={layer.id}
                geometry={geometry}
                start={layer.start}
                end={Math.min(layer.start + layer.secs, duration)}
                max={duration}
                minSecs={TEXT_MIN_SECS}
                tone="text"
                selected={selected}
                label={`Text "${layer.text}", from ${layer.start.toFixed(1)} s for ${layer.secs.toFixed(1)} s`}
                onSelect={() => onSelect({ kind: "text", id: layer.id })}
                onChange={({ start, end }, group) => onText({ ...layer, start: round(start), secs: round(end - start) }, group)}
                onDelete={selected ? onDelete : undefined}
              >
                <Type aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium">{layer.text.split("\n").join(" ") || "Empty text"}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      <TrackRow label="Video" height="h-14">
        <div className="absolute inset-y-1 left-0 overflow-hidden rounded-md bg-surface-raised ring-1 ring-border" style={{ width: duration * pps }}>
          {plan?.scenes.map((scene, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-l border-border px-1.5 pt-1 text-[11px] font-medium text-muted capitalize first:border-l-0"
              style={{ left: scene.start * pps, width: (scene.end - scene.start) * pps }}
            >
              {(scene.end - scene.start) * pps > 48 ? (scene.layout === "passthrough" ? "As shot" : scene.layout) : ""}
            </span>
          ))}
        </div>
      </TrackRow>
      <TrackRow label="Captions" height="h-8">
        {plan?.captions.map((event, i) => (
          <button
            key={i}
            type="button"
            onClick={() => playback.seek(event.start)}
            title={event.text}
            className="absolute inset-y-1 overflow-hidden rounded bg-fill px-1 text-left text-[11px] leading-5 text-ellipsis whitespace-nowrap text-muted ring-1 ring-border hover:text-text"
            style={{ left: event.start * pps, width: Math.max(2, (event.end - event.start) * pps - 1) }}
          >
            {event.text}
          </button>
        ))}
      </TrackRow>
      <TrackRow label="Hook">
        {plan?.hook && (
          <TimelineItem
            geometry={geometry}
            start={edits.hook_start}
            end={hookEnd}
            max={duration}
            minSecs={0.5}
            maxSecs={30}
            tone="waiting"
            selected={selection?.kind === "hook"}
            label={`Hook, from ${edits.hook_start.toFixed(1)} s for ${(hookEnd - edits.hook_start).toFixed(1)} s`}
            onSelect={() => onSelect({ kind: "hook" })}
            onChange={({ start, end }, group) =>
              onEdits({ ...edits, hook_start: round(start), hook_secs: round(end - start) }, group)
            }
          >
            <span className="truncate font-medium">{plan.hook.lines.join(" ")}</span>
          </TimelineItem>
        )}
      </TrackRow>
    </>
  );
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/** The selected item's properties. */
function Inspector({
  selection,
  edits,
  duration,
  candidate,
  preview,
  fonts,
  actions,
  onEdits,
  onText,
}: {
  selection: Selection;
  edits: AdvancedEdits;
  duration: number;
  candidate: Candidate;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  actions: ItemActions | null;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
}) {
  const text = selection?.kind === "text" ? edits.text_layers.find((layer) => layer.id === selection.id) : undefined;
  if (text && actions) {
    return (
      <TextLayerFields
        key={text.id}
        layer={text}
        duration={duration}
        fonts={fonts}
        onChange={onText}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  if (selection?.kind === "hook") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Hook</h2>
          <p className="text-sm text-pretty break-words">“{preview?.plan.hook?.lines.join(" ") ?? candidate.hook_text}”</p>
          <p className="text-sm text-pretty text-muted">Its words and look are changed in the clip editor.</p>
        </div>
        <HookTimingFields
          timing={edits}
          duration={duration}
          onTiming={(timing) => onEdits({ ...edits, ...timing }, "hook-timing")}
          blank={candidate.hook_text.trim() === ""}
        />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-semibold">Nothing selected</h2>
      <p className="text-sm text-pretty text-muted">Select an item on the timeline to change it.</p>
    </div>
  );
}

function AssetTabs({ value, onChange }: { value: AssetTab; onChange: (tab: AssetTab) => void }) {
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

function AssetPanel({
  tab,
  fonts,
  library,
  onAddText,
}: {
  tab: AssetTab;
  fonts: FontInfo[] | null;
  library: MediaLibrary;
  onAddText: (look: Omit<TextLayer, "id" | "start" | "secs">) => void;
}) {
  if (tab === "text") return <TextAssets fonts={fonts} onAdd={onAddText} />;
  if (tab === "media") {
    return <MediaAssets library={library} kinds={["video", "image"]} hint="Videos up to 3 minutes (500 MB) and images, kept for every Job." />;
  }
  if (tab === "audio") {
    return (
      <MediaAssets
        library={library}
        kinds={["audio"]}
        hint="Songs up to 50 MB, kept for every Job. Use music you have the rights to: the platforms mute or take down clips that don't."
      />
    );
  }
  const label = ASSET_TABS.find((t) => t.value === tab)!.label;
  return <p className="text-sm text-pretty text-muted">{label} can't be added yet.</p>;
}

function TopBar({
  title,
  status,
  history,
  onClose,
}: {
  title: string;
  status: ReactNode;
  history: EditHistory<AdvancedEdits>;
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
      <Button variant="ghost" size="icon" onClick={history.undo} disabled={!history.canUndo} aria-label="Undo">
        <Undo2 aria-hidden size={18} />
      </Button>
      <Button variant="ghost" size="icon" onClick={history.redo} disabled={!history.canRedo} aria-label="Redo">
        <Redo2 aria-hidden size={18} />
      </Button>
    </header>
  );
}

function SaveStatus({ saving, saved, error }: { saving: boolean; saved: boolean; error: string | null }) {
  return (
    <span aria-live="polite" className="inline-flex items-center gap-1">
      {error ? (
        <span className="inline-flex items-center gap-1 text-danger">
          <AlertCircle aria-hidden size={13} />
          {error}
        </span>
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

/** The phone's bottom bar: the asset tabs, or what can be done to the selected item. */
function Toolbar({
  selection,
  actions,
  playback,
  onAsset,
  onInspect,
  onDeselect,
}: {
  selection: Selection;
  actions: ItemActions | null;
  playback: Playback;
  onAsset: (tab: AssetTab) => void;
  onInspect: () => void;
  onDeselect: () => void;
}) {
  return (
    <nav
      aria-label="Tools"
      className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-t border-border px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      {selection ? (
        <>
          <ToolButton icon={X} label="Done" onClick={onDeselect} />
          <ToolButton icon={SlidersHorizontal} label="Edit" onClick={onInspect} />
          {actions && (
            <>
              <SplitButton actions={actions} playback={playback} />
              <ToolButton icon={Copy} label="Duplicate" onClick={actions.duplicate} />
              <ToolButton icon={Trash2} label="Delete" onClick={actions.remove} />
            </>
          )}
        </>
      ) : (
        ASSET_TABS.map((tab) => <ToolButton key={tab.value} icon={tab.icon} label={tab.label} onClick={() => onAsset(tab.value)} />)
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
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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

/** The timeline bar's buttons for the selected item: split at the playhead, duplicate, delete. */
function ItemTools({ actions, playback }: { actions: ItemActions | null; playback: Playback }) {
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const splittable = usePlayback(playback, (time) => actions?.canSplit(time) ?? false);
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => actions?.split()}
        disabled={!splittable}
        aria-label="Split at the playhead"
        title={`Split at the playhead (${shortcut}B)`}
      >
        <Scissors aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={actions?.duplicate} disabled={!actions} aria-label="Duplicate" title={`Duplicate (${shortcut}D)`}>
        <Copy aria-hidden size={17} />
      </Button>
      <Button variant="ghost" size="icon" onClick={actions?.remove} disabled={!actions} aria-label="Delete" title="Delete">
        <Trash2 aria-hidden size={17} />
      </Button>
    </>
  );
}

// The phone toolbar's Split, enabled while the playhead is inside the selected item.
function SplitButton({ actions, playback }: { actions: ItemActions; playback: Playback }) {
  const splittable = usePlayback(playback, (time) => actions.canSplit(time));
  return <ToolButton icon={Scissors} label="Split" onClick={actions.split} disabled={!splittable} />;
}
