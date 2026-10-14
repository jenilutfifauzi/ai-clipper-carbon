import { AlertCircle, ArrowLeft, AudioLines, Check, Film, Loader2, Redo2, Shuffle, Type, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, mediaUrl, type Candidate, type CandidateChange, type FontInfo, type JobDetail, type PreviewPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { Panel } from "../../../components/Panel";
import { loadFonts } from "../../../fonts";
import { cx } from "../../../format";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { candidateName } from "../CandidateList";
import { ClipPreview } from "../editor/ClipPreview";
import { candidateDraft } from "../editor/draft";
import { Playback } from "../editor/playback";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { HookTimingFields } from "../HookEditor";
import { AdvancedTimeline, TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { editsOf, sameSelection, type AdvancedEdits, type Selection } from "./edits";
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
  useShortcuts(history, playback);

  async function close() {
    await history.flush();
    navigate(`/jobs/${job.id}?candidate=${candidate.id}`);
  }

  function select(next: Selection) {
    setSelection((old) => (sameSelection(old, next) ? old : next));
  }

  const source = job.source!;
  const player = (
    <ClipPreview src={mediaUrl(job.id, source.preview ?? source.video)} preview={preview} fonts={fonts} playback={playback} fit />
  );
  const timeline = (
    <AdvancedTimeline duration={duration} playback={playback} snapPoints={snapPoints(edits, preview)}>
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
      onEdits={history.set}
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
              <AssetPanel tab={assetTab} />
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
          {sheet === "inspector" ? inspector : <AssetPanel tab={sheet} />}
        </Sheet>
      )}
    </div>
  );
}

// Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y) and Space to play, except while typing.
function useShortcuts(history: EditHistory<AdvancedEdits>, playback: Playback) {
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
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [history, playback]);
}

// The edges items snap to, besides the playhead and the Clip's ends.
function snapPoints(edits: AdvancedEdits, preview: PreviewPlan | null): number[] {
  const points = [edits.hook_start, edits.hook_start + edits.hook_secs];
  for (const scene of preview?.plan.scenes ?? []) points.push(scene.start);
  return points;
}

/** The tracks, top to bottom: the Clip and its Scenes, its caption lines, and the hook. */
function Tracks({
  geometry,
  duration,
  preview,
  edits,
  selection,
  playback,
  onSelect,
  onEdits,
}: {
  geometry: TimeGeometry;
  duration: number;
  preview: PreviewPlan | null;
  edits: AdvancedEdits;
  selection: Selection;
  playback: Playback;
  onSelect: (selection: Selection) => void;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
}) {
  const { pps } = geometry;
  const plan = preview?.plan ?? null;
  const hookEnd = Math.min(edits.hook_start + edits.hook_secs, duration);
  return (
    <>
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
  onEdits,
}: {
  selection: Selection;
  edits: AdvancedEdits;
  duration: number;
  candidate: Candidate;
  preview: PreviewPlan | null;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
}) {
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

function AssetPanel({ tab }: { tab: AssetTab }) {
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
  onAsset,
  onInspect,
  onDeselect,
}: {
  selection: Selection;
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
          <ToolButton icon={Type} label="Edit" onClick={onInspect} />
        </>
      ) : (
        ASSET_TABS.map((tab) => <ToolButton key={tab.value} icon={tab.icon} label={tab.label} onClick={() => onAsset(tab.value)} />)
      )}
    </nav>
  );
}

function ToolButton({ icon: Icon, label, onClick }: { icon: typeof Type; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 min-w-16 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] text-[11px] font-medium text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
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
