import {
  AlertCircle,
  ArrowLeft,
  AudioLines,
  Check,
  Copy,
  Film,
  Loader2,
  Music,
  Redo2,
  Scissors,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  mediaThumbnailUrl,
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type ClipSegment,
  type FontInfo,
  type JobDetail,
  type MediaItem,
  type MusicClip,
  type Overlay,
  type PreviewPlan,
  type TextLayer,
  type Transcript,
} from "../../../api";
import { Button } from "../../../components/Button";
import { Panel } from "../../../components/Panel";
import { loadFonts } from "../../../fonts";
import { cx, formatPrecise } from "../../../format";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { candidateName } from "../CandidateList";
import { ClipPreview } from "../editor/ClipPreview";
import { candidateDraft } from "../editor/draft";
import { piecesFrom, Playback, usePlayback } from "../editor/playback";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { HookTimingFields } from "../HookEditor";
import { AdvancedTimeline, TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { editsOf, sameSelection, type AdvancedEdits, type Selection } from "./edits";
import { MediaAssets, useMediaLibrary, type MediaLibrary } from "./MediaLibrary";
import { draggedSegments, newMediaSegment, SEGMENT_MIN_SECS, SegmentFields, SourcePicker } from "./MainTrack";
import { MUSIC_MIN_SECS, MusicFields, newMusicClip } from "./Music";
import { newOverlay, OVERLAY_MIN_SECS, OverlayFields } from "./Overlays";
import { newId, newTextLayer, TEXT_MIN_SECS, trackLanes, TextAssets, TextLayerFields } from "./TextLayers";
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
  // The Segments as planned (snapped to Words) once the plan has the draft's, else as drafted.
  const planned = preview?.plan.segments ?? [];
  playback.setPieces(planned.length > 1 && planned.length === edits.segments.length ? planned : piecesFrom(edits.segments));
  const duration = playback.duration;
  const sourceLength = job.source?.metadata.duration ?? Infinity;
  // The Segments when the drag under way began, by its gesture.
  const dragOrigin = useRef<{ group: string; segments: ClipSegment[] } | null>(null);

  useEffect(() => {
    loadFonts().then(setFonts, () => setFonts([]));
  }, []);

  function change(next: Partial<AdvancedEdits>, group?: string) {
    history.set({ ...edits, ...next }, group);
  }
  const textOf = (id: string) => edits.text_layers.find((layer) => layer.id === id);
  const selectedText = selection?.kind === "text" ? textOf(selection.id) ?? null : null;
  const songs = new Map((library.items ?? []).map((item) => [item.id, item]));

  function addText(look: Omit<TextLayer, "id" | "start" | "secs">) {
    const layer = newTextLayer(look, playback.time, duration);
    change({ text_layers: [...edits.text_layers, layer] });
    select({ kind: "text", id: layer.id });
    // On a phone, straight to its fields, to type its words.
    setSheet(wide ? null : "inspector");
  }
  function moveSegment(id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) {
    if (dragOrigin.current?.group !== group) dragOrigin.current = { group, segments: edits.segments };
    const lengthOf = (segment: ClipSegment) => (segment.media ? songs.get(segment.media)?.duration ?? segment.end : sourceLength);
    change({ segments: draggedSegments(dragOrigin.current.segments, id, moved, lengthOf) }, group);
  }
  function updateSegment(segment: ClipSegment, group?: string) {
    change({ segments: edits.segments.map((old) => (old.id === segment.id ? segment : old)) }, group);
  }
  // A moment of the episode, or a video, after the Segment the playhead is in.
  function addFromSource(range: { start: number; end: number }) {
    insertSegment({ id: newId(), ...range });
  }
  function insertSegment(segment: ClipSegment) {
    const at = piecesFrom(edits.segments).findIndex((piece) => playback.time < piece.end);
    const place = at === -1 ? edits.segments.length : at + 1;
    change({ segments: [...edits.segments.slice(0, place), segment, ...edits.segments.slice(place)] });
    select({ kind: "segment", id: segment.id });
    if (!wide) setSheet(null);
  }
  function addOverlay(item: MediaItem) {
    const overlay = newOverlay(item, playback.time, duration);
    change({ overlays: [...edits.overlays, overlay] });
    select({ kind: "overlay", id: overlay.id });
    if (!wide) setSheet(null);
  }
  function updateOverlay(overlay: Overlay, group?: string) {
    change({ overlays: edits.overlays.map((old) => (old.id === overlay.id ? overlay : old)) }, group);
  }
  function addMusic(item: MediaItem) {
    const clip = newMusicClip(item, playback.time, duration);
    change({ music: [...edits.music, clip] });
    select({ kind: "music", id: clip.id });
    if (!wide) setSheet(null);
  }
  function updateText(layer: TextLayer, group?: string) {
    change({ text_layers: edits.text_layers.map((old) => (old.id === layer.id ? layer : old)) }, group);
  }
  function updateMusic(clip: MusicClip, group?: string) {
    change({ music: edits.music.map((old) => (old.id === clip.id ? clip : old)) }, group);
  }
  const actions = itemActions(edits, selection, playback, duration, change, select);
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
      overlays={{
        selected: selection?.kind === "overlay" ? selection.id : null,
        // As the plan draws them: those whose items are there.
        ids: edits.overlays.filter((overlay) => songs.has(overlay.media) && overlay.start < duration).map((overlay) => overlay.id),
        onSelect: (id) => select({ kind: "overlay", id }),
        onPlace: (id, place, group) => {
          const overlay = edits.overlays.find((other) => other.id === id);
          if (overlay) updateOverlay({ ...overlay, ...place }, group);
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
          onMusic={updateMusic}
          onOverlay={updateOverlay}
          onSegment={moveSegment}
          songs={songs}
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
      songs={songs}
      playback={playback}
      onEdits={history.set}
      onText={updateText}
      onMusic={updateMusic}
      onOverlay={updateOverlay}
      onSegment={updateSegment}
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
              <AssetPanel
                tab={assetTab}
                fonts={fonts}
                library={library}
                transcript={job.transcript}
                near={edits.segments[0]}
                onAddText={addText}
                onAddMusic={addMusic}
                onAddSource={addFromSource}
                onAddVideo={(item) => insertSegment(newMediaSegment(item, newId()))}
                onAddOverlay={addOverlay}
              />
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
          {sheet === "inspector" ? (
            inspector
          ) : (
            <AssetPanel
              tab={sheet}
              fonts={fonts}
              library={library}
              transcript={job.transcript}
              near={edits.segments[0]}
              onAddText={addText}
              onAddMusic={addMusic}
              onAddSource={addFromSource}
              onAddVideo={(item) => insertSegment(newMediaSegment(item, newId()))}
              onAddOverlay={addOverlay}
            />
          )}
        </Sheet>
      )}
    </div>
  );
}

// The Advanced Edit's lists of items on the timeline, by the kind of item they hold.
const LISTS = { text: "text_layers", music: "music", overlay: "overlays" } as const;
type Listed = TextLayer | MusicClip | Overlay;

/**
 * What can be done to the selected item, when it is a Text Layer or a Music Clip (the hook can only
 * be moved): delete it, duplicate it (right after it when there is room, else at the same time), and
 * split it at the playhead (a song's second part goes on from where the first stops, without fades
 * at the cut).
 */
function itemActions(
  edits: AdvancedEdits,
  selection: Selection,
  playback: Playback,
  duration: number,
  change: (next: Partial<AdvancedEdits>, group?: string) => void,
  select: (selection: Selection) => void,
): ItemActions | null {
  if (selection?.kind === "segment") return segmentActions(edits, selection.id, playback, change, select);
  if (selection?.kind !== "text" && selection?.kind !== "music" && selection?.kind !== "overlay") return null;
  const kind = selection.kind;
  const key = LISTS[kind];
  const list = edits[key] as Listed[];
  const item = list.find((other) => other.id === selection.id);
  if (!item) return null;
  const least = { text: TEXT_MIN_SECS, music: MUSIC_MIN_SECS, overlay: OVERLAY_MIN_SECS }[kind];
  const put = (items: Listed[]) => change({ [key]: items } as Partial<AdvancedEdits>);
  const canSplit = (time: number) => time > item.start + least && time < item.start + item.secs - least;
  return {
    remove() {
      put(list.filter((other) => other.id !== item.id));
      select(null);
    },
    duplicate() {
      const after = item.start + item.secs;
      const room = after + item.secs <= duration + 1e-6;
      // A text that can't go after it goes a little lower, so that both show.
      const copy = room ? { ...item, id: newId(), start: after } : "y" in item ? { ...item, id: newId(), y: Math.min(item.y + 80, 1920) } : { ...item, id: newId() };
      put([...list, copy]);
      select({ kind, id: copy.id });
    },
    canSplit,
    split() {
      const at = round(playback.time);
      if (!canSplit(at)) return;
      const first = { ...item, secs: round(at - item.start), ...("fade_out" in item ? { fade_out: 0 } : {}) };
      const second = {
        ...item,
        id: newId(),
        start: at,
        secs: round(item.start + item.secs - at),
        ...("offset" in item ? { offset: round(item.offset + at - item.start) } : {}),
        ...("fade_in" in item ? { fade_in: 0 } : {}),
      };
      put(list.flatMap((other) => (other.id === item.id ? [first, second] : [other])));
      select({ kind, id: second.id });
    },
  };
}

/**
 * What can be done to a Segment of the Main Track: delete it (not the last one; the ones after it
 * close up), duplicate it right after itself, and split it at the playhead.
 */
function segmentActions(
  edits: AdvancedEdits,
  id: string,
  playback: Playback,
  change: (next: Partial<AdvancedEdits>, group?: string) => void,
  select: (selection: Selection) => void,
): ItemActions | null {
  const index = edits.segments.findIndex((segment) => segment.id === id);
  if (index === -1) return null;
  const segment = edits.segments[index];
  const piece = piecesFrom(edits.segments)[index];
  const canSplit = (time: number) => time > piece.start + SEGMENT_MIN_SECS && time < piece.end - SEGMENT_MIN_SECS;
  const put = (segments: ClipSegment[]) => change({ segments });
  return {
    remove() {
      if (edits.segments.length < 2) return;
      put(edits.segments.filter((other) => other.id !== id));
      select(null);
    },
    duplicate() {
      const copy = { ...segment, id: newId() };
      put([...edits.segments.slice(0, index + 1), copy, ...edits.segments.slice(index + 1)]);
      select({ kind: "segment", id: copy.id });
    },
    canSplit,
    split() {
      const at = playback.time;
      if (!canSplit(at)) return;
      const cut = Math.round((segment.start + at - piece.start) * 1000) / 1000;
      const second = { id: newId(), start: cut, end: segment.end };
      put(edits.segments.flatMap((other) => (other.id === id ? [{ ...segment, end: cut }, second] : [other])));
      select({ kind: "segment", id: second.id });
    },
  };
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
  for (const item of [...edits.text_layers, ...edits.music, ...edits.overlays]) points.push(item.start, item.start + item.secs);
  for (const piece of piecesFrom(edits.segments)) points.push(piece.end);
  for (const scene of preview?.plan.scenes ?? []) points.push(scene.start);
  return points;
}

/**
 * The tracks, top to bottom: the Text Layers' lanes, the Clip and its Scenes, its caption lines, the
 * hook, and the Music Clips' lanes.
 */
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
  onMusic,
  onOverlay,
  onSegment,
  songs,
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
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) => void;
  // The Media Library, by id: the songs' names and lengths.
  songs: Map<string, MediaItem>;
  // Deletes the selected item.
  onDelete?: () => void;
}) {
  const { pps } = geometry;
  const plan = preview?.plan ?? null;
  const hookEnd = Math.min(edits.hook_start + edits.hook_secs, duration);
  // The first lane next to the video, later ones above it.
  const lanes = trackLanes(edits.text_layers).reverse();
  const musicLanes = trackLanes(edits.music);
  const overlayLanes = trackLanes(edits.overlays).reverse();
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
      {overlayLanes.map((lane, i) => (
        <TrackRow key={`overlay${overlayLanes.length - i}`} label={i === overlayLanes.length - 1 ? "Overlay" : ""}>
          {lane.map((overlay) => {
            const selected = selection?.kind === "overlay" && selection.id === overlay.id;
            const item = songs.get(overlay.media);
            const length = item?.duration ?? Infinity;
            return (
              <TimelineItem
                key={overlay.id}
                geometry={geometry}
                start={overlay.start}
                end={Math.min(overlay.start + overlay.secs, duration)}
                max={duration}
                minSecs={OVERLAY_MIN_SECS}
                maxSecs={length - overlay.offset}
                trimMin={item?.duration != null ? overlay.start - overlay.offset : undefined}
                tone="overlay"
                selected={selected}
                label={`Overlay ${item?.name ?? ""}, from ${overlay.start.toFixed(1)} s for ${overlay.secs.toFixed(1)} s`}
                onSelect={() => onSelect({ kind: "overlay", id: overlay.id })}
                onChange={({ start, end, edge }, group) =>
                  onOverlay(
                    {
                      ...overlay,
                      start: round(start),
                      secs: round(end - start),
                      offset: edge === "start" && item?.duration != null ? round(Math.max(0, overlay.offset + start - overlay.start)) : overlay.offset,
                    },
                    group,
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <img src={mediaThumbnailUrl(overlay.media)} alt="" className="h-6 w-auto shrink-0 rounded-sm" />
                <span className="truncate font-medium">{item?.name ?? "Overlay"}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      <TrackRow label="Video" height="h-14">
        {/* The Scenes as planned, under the Segments. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-1 left-0 overflow-hidden rounded-md bg-surface-raised" style={{ width: duration * pps }}>
          {plan?.scenes.map((scene, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-l border-border px-1.5 pt-5 text-[10px] font-medium text-muted capitalize first:border-l-0"
              style={{ left: scene.start * pps, width: (scene.end - scene.start) * pps }}
            >
              {(scene.end - scene.start) * pps > 48 ? (scene.layout === "passthrough" ? "As shot" : scene.layout) : ""}
            </span>
          ))}
        </div>
        {/* As played: snapped to Words once the plan has them. */}
        {playback.pieces.map((piece, i) => {
          const segment = edits.segments[i];
          if (!segment) return null;
          const selected = selection?.kind === "segment" && selection.id === segment.id;
          return (
            <TimelineItem
              key={segment.id}
              geometry={geometry}
              start={piece.start}
              end={piece.end}
              min={-1e6}
              max={1e6}
              minSecs={SEGMENT_MIN_SECS}
              tone="video"
              selected={selected}
              label={`Piece ${i + 1}, ${formatPrecise(segment.start)} to ${formatPrecise(segment.end)} of the episode`}
              onSelect={() => onSelect({ kind: "segment", id: segment.id })}
              onChange={(moved, group) => onSegment(segment.id, moved, group)}
              onDelete={selected && edits.segments.length > 1 ? onDelete : undefined}
            >
              {segment.media ? (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-black bg-size-[auto_100%] bg-repeat-x opacity-80"
                  style={{ backgroundImage: `url(${mediaThumbnailUrl(segment.media)})` }}
                />
              ) : null}
              <span className="relative self-start rounded bg-black/50 px-1 pt-0.5 text-[11px] font-medium text-white tabular-nums">
                {segment.media ? (songs.get(segment.media)?.name ?? "Video") : formatPrecise(segment.start)}
                {edits.source_volume !== 1 && i === 0 && !segment.media ? ` · ${Math.round(edits.source_volume * 100)}%` : ""}
              </span>
            </TimelineItem>
          );
        })}
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
      {(musicLanes.length ? musicLanes : [[]]).map((lane, i) => (
        <TrackRow key={i} label={i === 0 ? "Audio" : ""}>
          {lane.map((clip) => {
            const selected = selection?.kind === "music" && selection.id === clip.id;
            const song = songs.get(clip.media);
            const length = song?.duration ?? clip.offset + clip.secs;
            return (
              <TimelineItem
                key={clip.id}
                geometry={geometry}
                start={clip.start}
                end={Math.min(clip.start + clip.secs, duration)}
                max={duration}
                minSecs={MUSIC_MIN_SECS}
                maxSecs={length - clip.offset}
                trimMin={clip.start - clip.offset}
                tone="audio"
                selected={selected}
                label={`Music ${song?.name ?? ""}, from ${clip.start.toFixed(1)} s for ${clip.secs.toFixed(1)} s`}
                onSelect={() => onSelect({ kind: "music", id: clip.id })}
                onChange={({ start, end, edge }, group) =>
                  onMusic(
                    {
                      ...clip,
                      start: round(start),
                      secs: round(end - start),
                      // Trimming its start starts it later in the song.
                      offset: edge === "start" ? round(Math.max(0, clip.offset + start - clip.start)) : clip.offset,
                    },
                    group,
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <Music aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium">{song?.name ?? "Music"}</span>
                {clip.volume !== 1 && <span className="shrink-0 opacity-70 tabular-nums">{Math.round(clip.volume * 100)}%</span>}
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
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
  songs,
  playback,
  onEdits,
  onText,
  onMusic,
  onOverlay,
  onSegment,
}: {
  selection: Selection;
  edits: AdvancedEdits;
  duration: number;
  candidate: Candidate;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  actions: ItemActions | null;
  songs: Map<string, MediaItem>;
  playback: Playback;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onSegment: (segment: ClipSegment, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
}) {
  const splittable = usePlayback(playback, (time) => actions?.canSplit(time) ?? false);
  const music = selection?.kind === "music" ? edits.music.find((clip) => clip.id === selection.id) : undefined;
  const overlay = selection?.kind === "overlay" ? edits.overlays.find((other) => other.id === selection.id) : undefined;
  if (overlay && actions) {
    return (
      <OverlayFields
        key={overlay.id}
        overlay={overlay}
        item={songs.get(overlay.media)}
        duration={duration}
        onChange={onOverlay}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  if (music && actions) {
    return (
      <MusicFields
        key={music.id}
        clip={music}
        item={songs.get(music.media)}
        duration={duration}
        onChange={onMusic}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  const index = selection?.kind === "segment" ? edits.segments.findIndex((segment) => segment.id === selection.id) : -1;
  if (index !== -1 && actions) {
    return (
      <SegmentFields
        key={edits.segments[index].id}
        segment={edits.segments[index]}
        item={songs.get(edits.segments[index].media ?? "")}
        onChange={onSegment}
        index={index}
        count={edits.segments.length}
        sourceVolume={edits.source_volume}
        canSplit={splittable}
        onSplit={actions.split}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
        onSourceVolume={(source_volume) => onEdits({ ...edits, source_volume }, "source-volume")}
      />
    );
  }
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
  onAddMusic,
  transcript,
  near,
  onAddSource,
  onAddVideo,
  onAddOverlay,
}: {
  tab: AssetTab;
  fonts: FontInfo[] | null;
  library: MediaLibrary;
  onAddText: (look: Omit<TextLayer, "id" | "start" | "secs">) => void;
  onAddMusic: (item: MediaItem) => void;
  transcript: Transcript | null;
  // Where the episode's transcript opens: the Clip's first Segment.
  near: ClipSegment;
  onAddSource: (range: { start: number; end: number }) => void;
  onAddVideo: (item: MediaItem) => void;
  onAddOverlay: (item: MediaItem) => void;
}) {
  if (tab === "text") return <TextAssets fonts={fonts} onAdd={onAddText} />;
  if (tab === "media") {
    return (
      <div className="flex flex-col gap-4">
        {transcript && <SourcePicker transcript={transcript} near={near} onAdd={onAddSource} />}
        <MediaAssets
          library={library}
          kinds={["video", "image"]}
          onAdd={onAddVideo}
          addable={(item) => item.kind === "video"}
          onOverlay={onAddOverlay}
          hint="Videos up to 3 minutes (500 MB) and images, kept for every Job. A video goes after the piece at the playhead; an image, or a video with the layers button, goes over the clip."
        />
      </div>
    );
  }
  if (tab === "audio") {
    return (
      <MediaAssets
        library={library}
        kinds={["audio"]}
        onAdd={onAddMusic}
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
