import { ArrowLeft, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  staleCandidate,
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type ClipSegment,
  type FontInfo,
  type JobDetail,
  type SavedBy,
  type MediaItem,
  type MusicClip,
  type Overlay,
  type TextLayer,
  type Transition,
  type TransitionKind,
} from "../../../api";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Panel } from "../../../components/Panel";
import { loadFonts } from "../../../fonts";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { candidateName } from "../CandidateList";
import { ClipPreview } from "../editor/ClipPreview";
import { ChangeNotice, type Notice } from "../editor/ChangeNotice";
import { RevisionHistory } from "../editor/RevisionHistory";
import { candidateDraft } from "../editor/draft";
import { placedOverrides } from "../editor/placing";
import { playable, playedFrom, Playback, type PlayedSegment } from "../editor/playback";
import { changedText, useCandidateEvents } from "../editor/useCandidateEvents";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { itemActions, type ItemActions } from "./actions";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, ItemTools, SaveStatus, Sheet, Toolbar, TopBar, type AssetTab } from "./Chrome";
import { changedItems, editsOf, newId, pickedOf, samePicked, stageIdOf, type AdvancedEdits, type Picked } from "./edits";
import { Inspector } from "./Inspector";
import { draggedSegments, newMediaSegment } from "./MainTrack";
import { useMediaLibrary } from "./MediaLibrary";
import { newMusicClip } from "./Music";
import { newOverlay } from "./Overlays";
import { newTextLayer, TEXT_PRESETS } from "./TextLayers";
import { Tracks, type DropTrack } from "./Tracks";
import { TRANSITION_SECS, TransitionPanel } from "./Transitions";
import { useEditHistory, type EditHistory } from "./useEditHistory";

// The Job statuses in which its Candidates can be changed (EDITABLE in backend/app/api.py).
const EDITABLE = new Set(["review", "rendering"]);
// From this width on, the desktop layout: assets, player and inspector side by side over the timeline.
const WIDE = "(min-width: 64rem)";
// How long items changed in another editor are shown as changed on the Timeline.
const CHANGED_MS = 1600;

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
          <p className="text-muted">{error ?? (index < 0 ? "This Job has no such clip." : "Clips can be edited once the Job is in review.")}</p>
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
  const [picked, setPicked] = useState<Picked>(null);
  // On a phone: the sheet open over the timeline, of an asset tab or of the inspector.
  const [sheet, setSheet] = useState<AssetTab | "inspector" | null>(null);
  const [assetTab, setAssetTab] = useState<AssetTab>("text");
  const wide = useMediaQuery(WIDE);
  const library = useMediaLibrary();
  const mediaById = new Map((library.items ?? []).map((item) => [item.id, item]));

  // The Revision the next save is made from, and the saves, sent one after another so that each is
  // made from the Revision the one before made.
  const revision = useRef(initial.revision);
  const sending = useRef<Promise<void>>(Promise.resolve());
  // Saves sent and not yet answered: a change from elsewhere waits for them.
  const unanswered = useRef(0);
  // Changed elsewhere since it was loaded: the backend refuses its saves until it is loaded again.
  const stale = useRef(false);
  // The Job or this clip is gone: nothing more is saved.
  const gone = useRef(false);
  // Asking whether to leave with edits that weren't saved.
  const [leaving, setLeaving] = useState(false);
  const save = useCallback(
    (change: CandidateChange) => {
      const send = async () => {
        if (gone.current) return;
        unanswered.current += 1;
        setSaving((n) => n + 1);
        setSaveError(null);
        try {
          const answer = await api.updateCandidate(job.id, initial.id, { ...change, revision: revision.current }, "advanced-edit");
          revision.current = answer.revision;
          setCandidate(answer);
          setSaved(true);
        } catch (reason) {
          if (staleCandidate(reason)) {
            stale.current = true;
            setSaveError("Not saved: changed elsewhere (another tab or the agent)");
          } else {
            setSaveError(`Not saved: ${(reason as Error).message}`);
          }
        } finally {
          unanswered.current -= 1;
          setSaving((n) => n - 1);
        }
      };
      sending.current = sending.current.then(send);
      return sending.current;
    },
    [job.id, initial.id],
  );
  const history = useEditHistory<AdvancedEdits>(editsOf(initial), save);
  const edits = history.value;

  // Kept in step with other editors (ADR 0003): a change saved elsewhere is taken at once when
  // nothing here waits to be saved; otherwise the next save here meets the newer Revision.
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  // The Job was deleted, or this clip is gone: nothing more is saved.
  const [ended, setEnded] = useState<"deleted" | "removed" | null>(null);
  function end(how: "deleted" | "removed") {
    gone.current = true;
    setEnded(how);
  }
  function fromElsewhere(next: Candidate, source: SavedBy, parts: string[]) {
    if (next.revision <= revision.current || unanswered.current > 0) return;
    const nextEdits = editsOf(next);
    if (!history.adopt(nextEdits)) return;
    // The state this replaces, kept in the Revision History: the notice's Restore brings it back.
    const before = revision.current;
    revision.current = next.revision;
    // In step again: saves are made from this Revision.
    stale.current = false;
    setCandidate(next);
    setChanged(changedItems(edits, nextEdits));
    setNotice({ id: Date.now(), text: changedText(source, parts, "advanced-edit"), action: restoreButton(before) });
  }

  // Saves the clip as it was at Revision `entry` of its Revision History, once the edits waiting
  // here are saved; answers why it couldn't, or null.
  async function restore(entry: number): Promise<string | null> {
    await history.flush();
    await sending.current;
    try {
      const answer = await api.restoreRevision(job.id, initial.id, entry, revision.current, "advanced-edit");
      revision.current = answer.revision;
      stale.current = false;
      setSaveError(null);
      setCandidate(answer);
      history.adopt(editsOf(answer));
      return null;
    } catch (reason) {
      return staleCandidate(reason) ? "This clip changed meanwhile (another tab or the agent): look again, then restore." : (reason as Error).message;
    }
  }

  function restoreButton(entry: number) {
    return (
      <Button
        size="xs"
        onClick={() =>
          void restore(entry).then((failed) => setNotice({ id: Date.now(), text: failed ?? "Restored the clip as it was" }))
        }
      >
        Restore
      </Button>
    );
  }
  useEffect(() => {
    if (!changed.size) return;
    const timer = setTimeout(() => setChanged(new Set()), CHANGED_MS);
    return () => clearTimeout(timer);
  }, [changed]);
  const { lost } = useCandidateEvents(job.id, {
    onReady: (candidates) => {
      const now = candidates.find((c) => c.id === initial.id);
      if (now) fromElsewhere(now, "unknown", []);
      else end("removed");
    },
    onCandidate: (event) => {
      if (event.candidate.id === initial.id) fromElsewhere(event.candidate, event.source, event.parts);
    },
    onRemoved: (id) => id === initial.id && end("removed"),
    onDeleted: () => end("deleted"),
  });
  const draft: CandidateChange = { ...candidateDraft(candidate), ...edits };
  const { preview, error: previewError } = usePreviewPlan(job.id, candidate.id, draft, job.status);
  const playback = useMemo(() => new Playback(), []);
  // The Main Track as planned (snapped to Words, overlapping at Transitions) once the plan has the
  // draft's Segments, else as drafted; and as played, one Segment at a time. Everything placed on
  // the Main Track goes by these, as the playhead does (docs/adr/0002-segments-and-timeline-time.md).
  const planned = preview?.plan.segments ?? [];
  const track: PlayedSegment[] = planned.length > 1 && planned.length === edits.segments.length ? planned : playedFrom(edits.segments);
  const played = playable(track);
  playback.setSegments(played);
  const duration = playback.duration;
  const sourceLength = job.source?.metadata.duration ?? Infinity;
  // The Main Track when the drag under way began, by its gesture.
  const dragOrigin = useRef<{ group: string; segments: ClipSegment[]; shown: PlayedSegment[]; planned: PlayedSegment[] } | null>(null);

  useEffect(() => {
    loadFonts().then(setFonts, () => setFonts([]));
  }, []);

  function change(next: Partial<AdvancedEdits>, group?: string) {
    history.set({ ...edits, ...next }, group);
  }
  function select(next: Picked) {
    setPicked((old) => (samePicked(old, next) ? old : next));
  }
  // An item added: picked, and on a phone the sheet closed (or, for a text, its fields opened to type in).
  function added(next: Picked, fields = false) {
    select(next);
    if (!wide) setSheet(fields ? "inspector" : null);
  }
  const replaced = <T extends { id: string }>(items: T[], item: T) => items.map((old) => (old.id === item.id ? item : old));

  function addText(look: Omit<TextLayer, "id" | "start" | "secs">, at = playback.time) {
    const layer = newTextLayer(look, at, duration);
    change({ text_layers: [...edits.text_layers, layer] });
    added({ kind: "text", id: layer.id }, true);
  }
  function addMusic(item: MediaItem, at = playback.time) {
    const clip = newMusicClip(item, at, duration);
    change({ music: [...edits.music, clip] });
    added({ kind: "music", id: clip.id });
  }
  function addOverlay(item: MediaItem, at = playback.time) {
    const overlay = newOverlay(item, at, duration);
    change({ overlays: [...edits.overlays, overlay] });
    added({ kind: "overlay", id: overlay.id });
  }
  // A Segment at `place`: by default after the one at the playhead.
  function insertSegment(segment: ClipSegment, place?: number) {
    const at = played.findIndex((shown) => playback.time < shown.end);
    const where = place ?? (at === -1 ? edits.segments.length : at + 1);
    change({ segments: [...edits.segments.slice(0, where), segment, ...edits.segments.slice(where)] });
    added({ kind: "segment", id: segment.id });
  }
  function moveSegment(id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) {
    if (dragOrigin.current?.group !== group) dragOrigin.current = { group, segments: edits.segments, shown: played, planned: track };
    const { segments, shown, planned: whole } = dragOrigin.current;
    const lengthOf = (segment: ClipSegment) => (segment.media ? (mediaById.get(segment.media)?.duration ?? segment.end) : sourceLength);
    change({ segments: draggedSegments(segments, id, moved, lengthOf, shown, whole) }, group);
  }
  // What is dropped from the asset panel onto a track, at `time`.
  function dropMedia(onto: DropTrack, media: string, time: number) {
    const item = mediaById.get(media);
    if (!item) return;
    if (onto === "music" && item.has_audio) addMusic(item, time);
    else if (onto === "overlay" && item.kind !== "audio") addOverlay(item, time);
    else if (onto === "segment" && item.kind === "video") {
      insertSegment(newMediaSegment(item, newId()), played.filter((shown) => (shown.start + shown.end) / 2 < time).length);
    }
  }
  // The Transition at the join after Segment `after`: set to `kind` (its length kept), changed, or removed.
  function setTransition(after: string, kind: TransitionKind) {
    const old = edits.transitions.find((transition) => transition.after === after);
    const next = { after, kind, secs: old?.secs ?? TRANSITION_SECS };
    change({ transitions: [...edits.transitions.filter((transition) => transition.after !== after), next] });
    select({ kind: "join", after });
  }
  function updateTransition(transition: Transition, group?: string) {
    change({ transitions: edits.transitions.map((old) => (old.after === transition.after ? transition : old)) }, group);
  }
  const joinedAfter = picked?.kind === "join" ? picked.after : null;
  const transitionPanel = (kinds: boolean) => (
    <TransitionPanel
      kinds={kinds}
      joined={joinedAfter !== null}
      transition={edits.transitions.find((transition) => transition.after === joinedAfter) ?? null}
      onPick={(kind) => joinedAfter && setTransition(joinedAfter, kind)}
      onChange={updateTransition}
      onRemove={() => change({ transitions: edits.transitions.filter((transition) => transition.after !== joinedAfter) })}
    />
  );
  const updateText = (layer: TextLayer, group?: string) => change({ text_layers: replaced(edits.text_layers, layer) }, group);
  const updateMusic = (clip: MusicClip, group?: string) => change({ music: replaced(edits.music, clip) }, group);
  const updateOverlay = (overlay: Overlay, group?: string) => change({ overlays: replaced(edits.overlays, overlay) }, group);
  const updateSegment = (segment: ClipSegment, group?: string) => change({ segments: replaced(edits.segments, segment) }, group);
  const actions = itemActions(edits, picked, playback, played, duration, (time) => wordGap(job.transcript?.words ?? [], time), change, select);
  useShortcuts(history, playback, actions);

  async function close() {
    await history.flush();
    // Leaving drops the edits a refused save held: only once the owner says so.
    if (stale.current) setLeaving(true);
    else leave();
  }

  function leave() {
    navigate(`/jobs/${job.id}?candidate=${candidate.id}`);
  }

  const source = job.source!;
  const player = (
    <ClipPreview
      src={mediaUrl(job.id, source.preview ?? source.video)}
      preview={preview}
      fonts={fonts}
      playback={playback}
      stage={{
        selected: stageIdOf(picked),
        onSelect: (id) => select(pickedOf(id)),
        onPlace: (id, place, group) => {
          if (id === "hook" || id === "captions") {
            change({ style_overrides: placedOverrides(edits.style_overrides, id === "hook" ? "hook" : "caption", place) }, group);
            return;
          }
          const layer = edits.text_layers.find((other) => `text:${other.id}` === id);
          if (layer) updateText({ ...layer, x: place.x, y: place.y, size: place.size ?? layer.size }, group);
        },
        retype: {
          textOf: (id) => (id === "hook" ? edits.hook_text : edits.hook_kicker),
          onText: (id, text) => {
            if (id === "hook") change({ hook_text: text });
            else if (id === "kicker") change({ hook_kicker: text });
            else {
              const layer = edits.text_layers.find((other) => `text:${other.id}` === id);
              if (layer) updateText({ ...layer, text });
            }
          },
          onWords: (update) => change({ word_edits: update(edits.word_edits) }),
        },
        texts: true,
      }}
      overlays={{
        selected: picked?.kind === "overlay" ? picked.id : null,
        // As the plan draws them: those whose items are there, starting in the Clip.
        ids: edits.overlays.filter((overlay) => mediaById.has(overlay.media) && overlay.start < duration).map((overlay) => overlay.id),
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
    <AdvancedTimeline duration={duration} playback={playback} snapPoints={snapPoints(edits, played)} tools={<ItemTools actions={actions} playback={playback} />}>
      {(geometry) => (
        <Tracks
          geometry={geometry}
          duration={duration}
          plan={preview?.plan ?? null}
          edits={edits}
          picked={picked}
          played={played}
          playback={playback}
          mediaById={mediaById}
          changed={changed}
          handlers={{
            onSelect: select,
            onEdits: history.set,
            onText: updateText,
            onMusic: updateMusic,
            onOverlay: updateOverlay,
            onSegment: moveSegment,
            onJoin: (after) => {
              select({ kind: "join", after });
              if (wide) setAssetTab("transitions");
            },
            onDropTransition: setTransition,
            onDropMedia: dropMedia,
            onDropText: (name, time) => {
              const look = TEXT_PRESETS.find((preset) => preset.name === name);
              if (look) addText(look.layer, time);
            },
            onDelete: actions?.remove,
          }}
        />
      )}
    </AdvancedTimeline>
  );
  const inspector = (
    <Inspector
      picked={picked}
      edits={edits}
      duration={duration}
      preview={preview}
      fonts={fonts}
      actions={actions}
      mediaById={mediaById}
      playback={playback}
      transition={transitionPanel(!wide)}
      onEdits={history.set}
      onText={updateText}
      onMusic={updateMusic}
      onOverlay={updateOverlay}
      onSegment={updateSegment}
    />
  );
  const assets = (tab: AssetTab) => (
    <AssetPanel
      tab={tab}
      fonts={fonts}
      library={library}
      transcript={job.transcript}
      near={edits.segments[0]}
      transitions={transitionPanel(true)}
      onAddText={(look) => addText(look)}
      onAddMusic={(item) => addMusic(item)}
      onAddSource={(range) => insertSegment({ id: newId(), ...range })}
      onAddVideo={(item) => insertSegment(newMediaSegment(item, newId()))}
      onAddOverlay={(item) => addOverlay(item)}
    />
  );
  const bar = (
    <>
      <TopBar
        title={`#${index + 1} ${candidateName(candidate, index)}`}
        status={
          <SaveStatus
            saving={saving > 0}
            saved={saved}
            error={saveError}
            offline={lost}
            action={
              stale.current ? (
                <button type="button" className="font-medium text-text underline" onClick={() => window.location.reload()}>
                  Reload
                </button>
              ) : null
            }
          />
        }
        history={history}
        actions={
          <RevisionHistory jobId={job.id} candidateId={initial.id} revision={candidate.revision} here="advanced-edit" onRestore={restore} />
        }
        onClose={() => void close()}
      />
      <ConfirmDialog
        open={leaving}
        title="Leave without saving?"
        confirmLabel="Leave"
        busyLabel="Leaving…"
        onConfirm={leave}
        onCancel={() => setLeaving(false)}
      >
        <p>This clip was changed elsewhere (another tab or the agent), so your latest changes weren't saved. Leaving drops them.</p>
      </ConfirmDialog>
      <ChangeNotice notice={notice} onClose={closeNotice} />
    </>
  );
  const notes = previewError && <p className="text-center text-sm text-danger">Couldn't preview: {previewError}</p>;

  if (ended) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-4 p-4">
        <Panel className="flex flex-col gap-3">
          <h1 className="text-xl font-semibold">{ended === "deleted" ? "This Job was deleted" : "This clip is gone"}</h1>
          <p className="text-muted">
            {ended === "deleted"
              ? "It was deleted in another tab, so there is nothing left to edit."
              : "It was removed from its Job in another tab or by the agent, so there is nothing left to edit."}
          </p>
          {ended === "removed" && (
            <Link to={`/jobs/${job.id}`} className="inline-flex min-h-11 items-center gap-1.5 self-start text-accent-text hover:underline">
              <ArrowLeft aria-hidden size={16} />
              Back to the Job
            </Link>
          )}
        </Panel>
      </div>
    );
  }

  if (wide) {
    return (
      <div className="flex h-dvh flex-col gap-3 overflow-hidden bg-bg pb-3">
        {bar}
        <div className="grid min-h-0 flex-1 grid-cols-[17rem_minmax(0,1fr)_20rem] gap-3 px-3">
          <aside aria-label="Assets" className="glass flex min-h-0 flex-col overflow-hidden rounded-panel">
            <AssetTabs value={assetTab} onChange={setAssetTab} />
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{assets(assetTab)}</div>
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
        picked={picked}
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
        <Sheet title={sheet === "inspector" ? "Edit" : ASSET_TABS.find((tab) => tab.value === sheet)!.label} onClose={() => setSheet(null)}>
          {sheet === "inspector" ? inspector : assets(sheet)}
        </Sheet>
      )}
    </div>
  );
}

// Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y), Space to play, and for the picked item
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

/**
 * `time` (on the Source's timeline) where it is between Words; inside a Word, the middle of the
 * silence on the nearer side of it.
 */
function wordGap(words: { start: number; end: number }[], time: number): number {
  const index = words.findIndex((word) => word.end > time);
  const word = words[index];
  if (!word || time <= word.start) return time;
  const before = words[index - 1];
  const after = words[index + 1];
  return time - word.start < word.end - time
    ? ((before?.end ?? word.start) + word.start) / 2
    : (word.end + (after?.start ?? word.end)) / 2;
}

// The edges items snap to, besides the playhead and the Clip's ends: the hook's, the items', and
// where each Segment gives way to the next, as played.
function snapPoints(edits: AdvancedEdits, played: PlayedSegment[]): number[] {
  const points = [edits.hook_start, edits.hook_start + edits.hook_secs];
  for (const item of [...edits.text_layers, ...edits.music, ...edits.overlays]) points.push(item.start, item.start + item.secs);
  for (const shown of played) points.push(shown.end);
  return points;
}
