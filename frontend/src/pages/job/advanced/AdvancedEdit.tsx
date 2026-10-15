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
import { ChangeNotice, type Notice } from "../editor/ChangeNotice";
import { ClipPreview } from "../editor/ClipPreview";
import { candidateDraft } from "../editor/draft";
import { collidedParts, mergeEdits, rebaseHistory } from "../editor/merge";
import { placedOverrides } from "../editor/placing";
import { playable, playedFrom, Playback, type PlayedSegment } from "../editor/playback";
import { entryToRestore, RevisionHistory } from "../editor/RevisionHistory";
import { changedText, savedByLabel, useCandidateEvents } from "../editor/useCandidateEvents";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { itemActions, move, selectAll, type ItemActions, type Outcome } from "./actions";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, ItemTools, SaveStatus, Sheet, Toolbar, TopBar, type AssetTab } from "./Chrome";
import { changedItems, editsOf, newId, type AdvancedEdits } from "./edits";
import { Inspector } from "./Inspector";
import { draggedSegments, newMediaSegment } from "./MainTrack";
import { useMediaLibrary } from "./MediaLibrary";
import { newMusicClip } from "./Music";
import { newOverlay } from "./Overlays";
import { bandPick, isPicked, itemsOf, onlyItem, picked, prunedPick, samePick, stageIdsOf, stageItem, type ItemKind, type Pick } from "./pick";
import { newTextLayer, TEXT_PRESETS } from "./TextLayers";
import { Tracks, type DropTrack } from "./Tracks";
import { TRANSITION_SECS, TransitionPanel } from "./Transitions";
import { useEditHistory, type EditHistory } from "./useEditHistory";

// The Job statuses in which its Candidates can be changed (EDITABLE in backend/app/api.py).
const EDITABLE = new Set(["review", "rendering"]);
// From this width on, the desktop layout: assets, player and inspector side by side over the timeline.
const WIDE = "(min-width: 64rem)";
// How a newer Revision came: saved elsewhere, carried by the refusal of a save here, or restored here.
type Taken = "elsewhere" | "refused" | "restored";

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
  const [held, setHeld] = useState<Pick>(null);
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
  // Saves asked for and not yet answered (queued ones too): a change from elsewhere waits for them.
  const unanswered = useRef(0);
  // How many changes from elsewhere were taken: a save asked for before the latest is left out, as
  // its edits are in the merge saved instead.
  const taken = useRef(0);
  // Changed elsewhere again after a merge was refused: saves wait for the next change from elsewhere.
  const stale = useRef(false);
  // The Job or this clip is gone: nothing more is saved.
  const gone = useRef(false);
  // Asking whether to leave with edits that weren't saved.
  const [leaving, setLeaving] = useState(false);
  // The edits as last saved here or taken from elsewhere: unsaved edits are merged from them.
  const savedEdits = useRef(editsOf(initial));
  // Refusals in a row: after a merge has been refused once more, the next change from elsewhere is
  // waited for instead.
  const refusals = useRef(0);
  // Theirs, while the merge of the edits here onto it is being saved: taken as it is if that fails.
  const merging = useRef<AdvancedEdits | null>(null);
  // A change from elsewhere that came while a save was unanswered: taken once it is answered.
  const postponed = useRef<{ next: Candidate; source: SavedBy; parts: string[] } | null>(null);
  // This render's handlers, for a save answered after later renders.
  const latest = useRef({ incoming: (_next: Candidate, _source: SavedBy, _parts: string[], _how: Taken) => {} });
  function save(change: CandidateChange) {
    const asked = taken.current;
    unanswered.current += 1;
    const send = async () => {
      let refused: Candidate | null = null;
      try {
        if (gone.current || asked !== taken.current) return;
        setSaving((n) => n + 1);
        setSaveError(null);
        try {
          const answer = await api.updateCandidate(job.id, initial.id, { ...change, revision: revision.current }, "advanced-edit");
          revision.current = answer.revision;
          savedEdits.current = change as AdvancedEdits;
          refusals.current = 0;
          merging.current = null;
          setCandidate(answer);
          setSaved(true);
        } catch (reason) {
          refused = staleCandidate(reason);
          if (refused) {
            refusals.current += 1;
          } else if (merging.current) {
            // The merge isn't a valid edit (a Transition's join gone, say): theirs stays.
            history.elsewhere(merging.current, (step) => step, false);
            savedEdits.current = merging.current;
            merging.current = null;
            setSaveError("Your latest change couldn't be applied on top of the one made elsewhere: showing that one.");
          } else {
            setSaveError(`Not saved: ${(reason as Error).message}`);
          }
        } finally {
          setSaving((n) => n - 1);
        }
      } finally {
        unanswered.current -= 1;
      }
      // What the refusal or a change that came meanwhile brings: the newest of them, said by who.
      const waiting = postponed.current;
      postponed.current = null;
      if (refused && refusals.current > 1) {
        stale.current = true;
        setSaveError("Not saved: changed elsewhere again (another tab or the agent)");
      } else if (refused) {
        const told = waiting && waiting.next.revision >= refused.revision ? waiting : null;
        latest.current.incoming(told?.next ?? refused, told?.source ?? "unknown", told?.parts ?? [], "refused");
      } else if (waiting && unanswered.current === 0) {
        latest.current.incoming(waiting.next, waiting.source, waiting.parts, "elsewhere");
      } else if (waiting) {
        postponed.current = waiting;
      }
    };
    sending.current = sending.current.then(send);
    return sending.current;
  }
  const history = useEditHistory<AdvancedEdits>(editsOf(initial), save);
  const edits = history.value;
  // What is picked of the edits as they are now: an undo or a change from elsewhere may have taken
  // some of it away.
  const pick = prunedPick(held, edits);
  useEffect(() => {
    if (pick !== held) setHeld(pick);
  }, [pick, held]);

  // Kept in step with other editors (ADR 0003): a change saved elsewhere is taken at once; the edits
  // waiting here are merged onto it and saved from it, mine winning where both changed the same item.
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const [changed, setChanged] = useState<Set<string>>(new Set());
  // The Job was deleted, or this clip is gone: nothing more is saved.
  const [ended, setEnded] = useState<"deleted" | "removed" | null>(null);
  function end(how: "deleted" | "removed") {
    gone.current = true;
    setEnded(how);
  }
  // A newer Revision: saved elsewhere, the one a save here was refused for (then all the edits here
  // are unsaved), or a Restore asked for here. The edits here not yet saved are merged onto it.
  function incoming(next: Candidate, source: SavedBy, parts: string[], how: Taken) {
    if (next.revision <= revision.current) return;
    if (unanswered.current > 0 && how === "elsewhere") {
      postponed.current = { next, source, parts };
      return;
    }
    const base = savedEdits.current;
    const theirs = editsOf(next);
    const rebase = (step: AdvancedEdits) => rebaseHistory([step], base, theirs)[0];
    taken.current += 1;
    revision.current = next.revision;
    savedEdits.current = theirs;
    stale.current = false;
    setCandidate(next);
    const unsaved = how === "refused" || history.waiting();
    const { merged, collisions } = unsaved ? mergeEdits(base, edits, theirs) : { merged: theirs, collisions: [] };
    merging.current = unsaved ? theirs : null;
    history.elsewhere(merged, rebase, unsaved);
    setChanged(changedItems(edits, merged));
    if (how === "restored") return;
    if (collisions.length) {
      const who = source === "unknown" ? "a change made elsewhere" : `${savedByLabel(source, null, "advanced-edit")}'s change`;
      setNotice({
        id: Date.now(),
        text: `Your changes to ${collidedParts(collisions)} replaced ${who}`,
        action: restoreButton("theirs", next.revision),
      });
    } else {
      setNotice({ id: Date.now(), text: changedText(source, parts, "advanced-edit"), action: restoreButton("before", next.revision) });
    }
  }
  latest.current = { incoming };

  // Saves the clip as it was at Revision `entry` of its Revision History, once the edits waiting
  // here are saved; answers why it couldn't, or null. Edits made meanwhile are merged onto it.
  async function restore(entry: number): Promise<string | null> {
    await history.flush();
    await sending.current;
    try {
      const answer = await api.restoreRevision(job.id, initial.id, entry, revision.current, "advanced-edit");
      setSaveError(null);
      latest.current.incoming(answer, "restore", [], "restored");
      return null;
    } catch (reason) {
      return staleCandidate(reason) ? "This clip changed meanwhile (another tab or the agent): look again, then restore." : (reason as Error).message;
    }
  }

  // A notice's Restore: of the state before Revision `revision` came in, or of theirs from it on.
  function restoreButton(which: "before" | "theirs", revision: number) {
    async function click() {
      const entry = await entryToRestore(job.id, initial.id, which, revision).catch(() => null);
      const failed = entry === null ? "That version isn't in the Revision History." : await restore(entry);
      setNotice({ id: Date.now(), text: failed ?? "Restored the clip as it was" });
    }
    return (
      <Button size="xs" onClick={() => void click()}>
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
      if (now) incoming(now, "unknown", [], "elsewhere");
      else end("removed");
    },
    onCandidate: (event) => {
      if (event.candidate.id === initial.id) incoming(event.candidate, event.source, event.parts, "elsewhere");
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
  function select(next: Pick) {
    setHeld((old) => (samePick(old, next) ? old : next));
  }
  // An item added: picked, and on a phone the sheet closed (or, for a text, its fields opened to type in).
  function added(next: Pick, fields = false) {
    select(next);
    if (!wide) setSheet(fields ? "inspector" : null);
  }
  const replaced = <T extends { id: string }>(items: T[], item: T) => items.map((old) => (old.id === item.id ? item : old));

  function addText(look: Omit<TextLayer, "id" | "start" | "secs">, at = playback.time) {
    const layer = newTextLayer(look, at, duration);
    change({ text_layers: [...edits.text_layers, layer] });
    added(picked({ kind: "text", id: layer.id }), true);
  }
  function addMusic(item: MediaItem, at = playback.time) {
    const clip = newMusicClip(item, at, duration);
    change({ music: [...edits.music, clip] });
    added(picked({ kind: "music", id: clip.id }));
  }
  function addOverlay(item: MediaItem, at = playback.time) {
    const overlay = newOverlay(item, at, duration);
    change({ overlays: [...edits.overlays, overlay] });
    added(picked({ kind: "overlay", id: overlay.id }));
  }
  // A Segment at `place`: by default after the one at the playhead.
  function insertSegment(segment: ClipSegment, place?: number) {
    const at = played.findIndex((shown) => playback.time < shown.end);
    const where = place ?? (at === -1 ? edits.segments.length : at + 1);
    change({ segments: [...edits.segments.slice(0, where), segment, ...edits.segments.slice(where)] });
    added(picked({ kind: "segment", id: segment.id }));
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
  const joinedAfter = pick?.kind === "join" ? pick.after : null;
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
  // An action's outcome: its edits as one change, what it picks, and what it tells.
  function apply(outcome: Outcome) {
    if (outcome.edits !== edits) history.set(outcome.edits);
    select(outcome.pick);
    if (outcome.notice) setNotice({ id: Date.now(), text: outcome.notice });
  }
  const scene = { edits, pick, played, duration, gap: (time: number) => wordGap(job.transcript?.words ?? [], time) };
  const actions = itemActions(scene, () => playback.time, apply);
  useShortcuts(history, playback, actions, { all: () => select(selectAll(edits)), none: () => select(null) });

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
        selected: stageIdsOf(pick)[0] ?? null,
        onSelect: (id) => {
          const item = stageItem(id);
          select("id" in item ? picked(item) : item);
        },
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
        selected: onlyItem(pick)?.kind === "overlay" ? onlyItem(pick)!.id : null,
        // As the plan draws them: those whose items are there, starting in the Clip.
        ids: edits.overlays.filter((overlay) => mediaById.has(overlay.media) && overlay.start < duration).map((overlay) => overlay.id),
        onSelect: (id) => select(picked({ kind: "overlay", id })),
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
      snapPoints={snapPoints(edits, played, pick)}
      tools={<ItemTools actions={actions} playback={playback} />}
      onBand={(items, band, add) => select(bandPick(pick, items, band, add))}
      onClear={() => select(null)}
    >
      {(geometry) => (
        <Tracks
          geometry={geometry}
          duration={duration}
          plan={preview?.plan ?? null}
          edits={edits}
          pick={pick}
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
            onMove: (delta, group) => {
              const moved = move(scene, delta);
              if (moved) history.set(moved.edits, group);
            },
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
      pick={pick}
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
        pick={pick}
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

// Undo and redo (Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z, Ctrl+Y), Space to play, Cmd/Ctrl+A to pick every item
// and Escape to pick none, and for the picked items Delete, Cmd/Ctrl+D to duplicate them and
// Cmd/Ctrl+B to split them; except while typing.
function useShortcuts(
  history: EditHistory<AdvancedEdits>,
  playback: Playback,
  actions: ItemActions | null,
  pick: { all: () => void; none: () => void },
) {
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
      } else if (command && key === "a") {
        event.preventDefault();
        pick.all();
      } else if (key === "escape") {
        pick.none();
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
  }, [history, playback, actions, pick]);
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

// The edges items snap to, besides the playhead and the Clip's ends: the hook's, the items' (but
// those of a Pick of several, which move together), and where each Segment gives way to the next,
// as played.
function snapPoints(edits: AdvancedEdits, played: PlayedSegment[], pick: Pick): number[] {
  const points = [edits.hook_start, edits.hook_start + edits.hook_secs];
  const moving = (kind: ItemKind, id: string) => itemsOf(pick).length > 1 && isPicked(pick, kind, id);
  const items = [
    ...edits.text_layers.filter((item) => !moving("text", item.id)),
    ...edits.music.filter((item) => !moving("music", item.id)),
    ...edits.overlays.filter((item) => !moving("overlay", item.id)),
  ];
  for (const item of items) points.push(item.start, item.start + item.secs);
  for (const shown of played) points.push(shown.end);
  return points;
}
