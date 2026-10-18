import { ArrowLeft, Loader2, Maximize, Minimize } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  api,
  staleCandidate,
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type ClipSegment,
  type JobDetail,
  type KeyProperty,
  type SavedBy,
  type MediaItem,
  type MusicClip,
  type Overlay,
  type Shape,
  type ShapeKind,
  type TextLayer,
  type Transform,
  type Transition,
  type TransitionKind,
} from "../../../api";
import { Button } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Panel } from "../../../components/Panel";
import { useFonts } from "../../../fonts";
import { useTextPresets } from "../../../textPresets";
import { cx } from "../../../format";
import { useMediaQuery } from "../../../hooks/useMediaQuery";
import { candidateName } from "../CandidateList";
import { ChangeNotice, type Notice } from "../editor/ChangeNotice";
import { ClipPreview, type StageControls } from "../editor/ClipPreview";
import { PICTURE_KEYS } from "../editor/keyframes";
import { pictureCrop, pictureSource, withPictureCrop, withPictureTransform } from "../editor/stagePicture";
import { boxStyle } from "../editor/textBox";
import { MagneticToggle } from "../editor/MagneticToggle";
import { useMagnetic } from "../editor/magnetic";
import { candidateDraft } from "../editor/draft";
import { collidedParts, mergeEdits, rebaseHistory } from "../editor/merge";
import { placedOverrides } from "../editor/placing";
import { playable, playedFrom, Playback, type PlayedSegment } from "../editor/playback";
import { entryToRestore, RevisionHistory } from "../editor/RevisionHistory";
import { changedText, savedByLabel, useCandidateEvents } from "../editor/useCandidateEvents";
import { usePreviewPlan } from "../editor/usePreviewPlan";
import { eventCopy, segmentCopy, type RetimedAsk } from "../editor/retimedCopy";
import {
  changeMusic,
  dragSegment,
  freezer,
  gestureSpeed,
  insertSegment,
  itemActions,
  splitter,
  move,
  nudge,
  pickAll,
  placeAfter,
  placeDropped,
  reversible,
  setFade,
  setHold,
  setReverse,
  speedSheetItem,
  type Outcome,
  type SegmentDrag,
  type SpeedRef,
} from "./actions";
import { copy, cut, paste, setClipboard, useClipboard } from "./clipboard";
import { AdvancedTimeline } from "./AdvancedTimeline";
import { AssetPanel } from "./AssetPanel";
import { bottomPanelId, BottomTabs, useBottomTab } from "./BottomTabs";
import {
  ASSET_TABS,
  AssetTabs,
  FrameStep,
  ItemTools,
  PlaybackPanel,
  SaveStatus,
  Sheet,
  ShortcutsSheet,
  Toolbar,
  TopBar,
  type AssetTab,
} from "./Chrome";
import { commandsOf, type Commands } from "./commands";
import { DRAG_SHAPE } from "./drag";
import { changedItems, editsOf, newId, type AdvancedEdits } from "./edits";
import { useControls, useFullscreen } from "./fullscreen";
import { Inspector } from "./Inspector";
import { KeyingContext, usePickedKeyed, type Keying } from "./KeyCluster";
import { SheetEase } from "./KeyEase";
import { KeyframesPane } from "./KeyframesPane";
import { activeKey, heldTransform, keyRows, keyAround, keyedItem, moveItemKeys, sceneRef, toggleItemKey, writeItemKey, writeItemTransform, type KeyedRef } from "./keying";
import { keysOf, resolveShortcut } from "./keymap";
import { longestClip, newMediaSegment } from "./MainTrack";
import { MediaCache } from "./mediaCache";
import { useMediaLibrary } from "./MediaLibrary";
import { newMusicClip } from "./Music";
import { newOverlay } from "./Overlays";
import { DEFAULT_FPS, loopRegion, onFrame, type LoopMarks } from "./playhead";
import {
  bandPick,
  clicked,
  isPicked,
  isPlaced,
  itemsOf,
  picked,
  prunedPick,
  samePick,
  stageIdsOf,
  stageItem,
  unlockedPick,
  type Pick,
  type PlacedKind,
} from "./pick";
import { addShape, resizeShape } from "./shapeStyle";
import { newTextLayer, type UntimedTextLayer } from "./TextLayers";
import { fromPreset } from "./TextPresets";
import { edgesOf, editPoints, keyMarks, zoomToFit } from "./timelineView";
import { heardDraft, shownPlan, toggledTrack, TRACKS, type TrackControl, type TrackKind, type TrackState, UNTOUCHED } from "./trackState";
import { Tracks, TracksPanel, type DropTrack } from "./Tracks";
import { SpeedPanel } from "./SpeedFields";
import { TransformPanel } from "./TransformPanel";
import { TRANSITION_SECS, TransitionPanel } from "./Transitions";
import { useEditHistory } from "./useEditHistory";

// The Job statuses in which its Candidates can be changed (EDITABLE in backend/app/api.py).
const EDITABLE = new Set(["review", "rendering"]);
// From this width on, the desktop layout: assets, player and inspector side by side over the timeline.
const WIDE = "(min-width: 64rem)";
// The Timeline's labels' column on a desktop, wide enough for each Track's buttons.
const TRACK_LABEL_WIDTH = 140;
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
  const fonts = useFonts();
  const textPresets = useTextPresets();
  const [pickState, setPickState] = useState<Pick>(null);
  // On a phone: the sheet open over the timeline, of an asset tab, of the inspector, of the picked
  // picture's Transform, of the picked item's Speed, of the Tracks or of Playback.
  const [sheet, setSheet] = useState<AssetTab | "inspector" | "transform" | "speed" | "tracks" | "playback" | null>(null);
  const [assetTab, setAssetTab] = useState<AssetTab>("text");
  // The player's room, which goes full screen with the stage and the player bar.
  const fullscreenRoom = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(fullscreenRoom);
  const fullscreenBar = useControls(fullscreen.way !== null);
  // Full screen, the layout stays the one it was entered from: the screen's width swapping it would
  // take the preview out of the page, and so out of full screen.
  const wideNow = useMediaQuery(WIDE);
  const wideEntered = useRef(wideNow);
  if (!fullscreen.way) wideEntered.current = wideNow;
  const wide = fullscreen.way ? wideEntered.current : wideNow;
  // On a desktop: the shortcuts sheet open.
  const [shortcuts, setShortcuts] = useState(false);
  // On a phone, picking mode: a tap adds an item to the Pick or takes it out.
  const [pickingMode, setPickingMode] = useState(false);
  // Counted up by the inspector's Crop, which opens Crop mode on the stage.
  const [cropAsked, setCropAsked] = useState(0);
  // The property last touched, which the active row of the Keyframes pane (and K) is made of.
  const [touched, setTouched] = useState<KeyProperty | null>(null);
  // On a desktop: the Timeline or the Keyframes pane at the bottom, as the browser remembers.
  const [bottomTab, setBottomTab] = useBottomTab();
  const picking = pickingMode && !wide;
  // What of the Tracks is hidden, muted or locked: in this editor only.
  const [tracks, setTracks] = useState<TrackState>(UNTOUCHED);
  // The In and Out marks, in Timeline time, and Loop on or off: in this editor only, never saved or undone.
  const [marks, setMarks] = useState<LoopMarks>(NO_MARKS);
  const [looping, setLooping] = useState(false);
  const library = useMediaLibrary();
  const mediaById = new Map((library.items ?? []).map((item) => [item.id, item]));
  // The Timeline's Filmstrips, fetched and decoded for as long as this editor is open.
  const [mediaCache] = useState(() => new MediaCache());
  useEffect(() => () => mediaCache.clear(), [mediaCache]);

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
  // some of it away, and nothing on a locked Track is picked.
  const pick = unlockedPick(prunedPick(pickState, edits), tracks.locked);
  useEffect(() => {
    if (pick !== pickState) setPickState(pick);
  }, [pick, pickState]);

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
  const { preview, error: previewError } = usePreviewPlan(job.id, candidate.id, heardDraft(draft, tracks), job.status);
  // The plan as the player draws it, the hidden Tracks left out.
  const shown = useMemo(() => preview && { ...preview, plan: shownPlan(preview.plan, tracks) }, [preview, tracks]);
  const playback = useMemo(() => new Playback(), []);
  const magnetic = useMagnetic();
  // The Main Track as planned (snapped to Words, overlapping at Transitions) once the plan has the
  // draft's Segments, else as drafted; and as played, one Segment at a time. Everything placed on
  // the Main Track goes by these, as the playhead does (docs/adr/0002-segments-and-timeline-time.md).
  const planned = preview?.plan.segments ?? [];
  const track: PlayedSegment[] = planned.length > 1 && planned.length === edits.segments.length ? planned : playedFrom(edits.segments);
  const played = playable(track);
  playback.setSegments(played);
  const duration = playback.duration;
  // The Clip's frame rate, the Source's, which the playhead steps by.
  const fps = preview?.plan.fps || DEFAULT_FPS;
  // The Loop Region the marks make, clamped inside the Clip as it is now; played while Loop is on.
  const region = useMemo(() => loopRegion(marks, { fps, duration }), [marks, fps, duration]);
  useEffect(() => playback.setLoop(looping ? region : null), [playback, looping, region]);
  const sourceLength = job.source?.metadata.duration ?? Infinity;
  const longest = longestClip(job.options.max_secs);
  // A Speed's steps, from the slider, the chips or the field, each made from where its group began.
  const [speedGesture] = useState(gestureSpeed);
  // The Main Track when the drag under way began, by its gesture.
  const dragOrigin = useRef<(SegmentDrag & { group: string }) | null>(null);
  // The Timeline's Zoom to fit, for its shortcut.
  const fitTimeline = useRef<() => void>(null);
  // The Timeline's zoom in (1) or out (-1) about the playhead, for its keys.
  const zoomTimeline = useRef<(direction: 1 | -1) => void>(null);


  function change(next: Partial<AdvancedEdits>, group?: string) {
    history.set({ ...edits, ...next }, group);
  }
  function select(next: Pick) {
    setPickState((old) => (samePick(old, next) ? old : next));
  }
  // An item added: picked, and on a phone the sheet closed (or, for a text, its fields opened to type in).
  function added(next: Pick, fields = false) {
    select(next);
    if (!wide) setSheet(fields ? "inspector" : null);
  }
  const replaced = <T extends { id: string }>(items: T[], item: T) => items.map((old) => (old.id === item.id ? item : old));
  // Whether `track` is locked, which refuses what is added to it: the owner is told.
  function refused(track: TrackKind): boolean {
    if (!tracks.locked.includes(track)) return false;
    setNotice({ id: Date.now(), text: `The ${TRACKS[track].label} Track is locked.` });
    return true;
  }
  function toggleTrack(control: TrackControl, kind: TrackKind) {
    setTracks((old) => toggledTrack(old, control, kind));
  }

  function addText(made: UntimedTextLayer, at = playback.time) {
    if (refused("text")) return;
    const layer = newTextLayer(made, at, duration);
    change({ text_layers: [...edits.text_layers, layer] });
    added(picked({ kind: "text", id: layer.id }), true);
  }
  // A Shape of `kind` at `at`; dropped on the preview, centred where it was dropped (`place`).
  function addNewShape(kind: ShapeKind, at = playback.time, place?: { x: number; y: number }) {
    if (refused("shape")) return;
    const outcome = addShape(scene, kind, at, duration, { place });
    history.set(outcome.edits);
    added(outcome.pick);
  }
  function addMusic(item: MediaItem, at = playback.time) {
    if (refused("music")) return;
    const clip = newMusicClip(item, at, duration);
    change({ music: [...edits.music, clip] });
    added(picked({ kind: "music", id: clip.id }));
  }
  function addOverlay(item: MediaItem, at = playback.time) {
    if (refused("overlay")) return;
    const overlay = newOverlay(item, at, duration);
    change({ overlays: [...edits.overlays, overlay] });
    added(picked({ kind: "overlay", id: overlay.id }));
  }
  // A Segment at `place`: by default after the one at the playhead.
  function addSegment(segment: ClipSegment, place = placeAfter(played, playback.time)) {
    if (refused("video")) return;
    const outcome = insertSegment(scene, segment, place);
    history.set(outcome.edits);
    added(outcome.pick);
  }
  function moveSegment(id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) {
    if (dragOrigin.current?.group !== group) dragOrigin.current = { group, edits, shown: played, planned: track };
    const lengthOf = (segment: ClipSegment) => (segment.media ? (mediaById.get(segment.media)?.duration ?? segment.end) : sourceLength);
    const outcome = dragSegment(scene, dragOrigin.current, id, moved, lengthOf, longest);
    history.set(outcome.edits, group);
    // Told once while the drag cuts the same layers out, not at every step.
    const text = outcome.notice;
    if (text) setNotice((old) => (old?.text === text ? old : { id: Date.now(), text }));
  }
  // What is dropped from the asset panel onto a track, at `time`.
  function dropMedia(onto: DropTrack, media: string, time: number) {
    const item = mediaById.get(media);
    if (!item) return;
    if (onto === "music" && item.has_audio) addMusic(item, time);
    else if (onto === "overlay" && item.kind !== "audio") addOverlay(item, time);
    else if (onto === "segment" && item.kind === "video") {
      addSegment(newMediaSegment(item, newId()), placeDropped(played, time));
    }
  }
  // The Transition at the join after Segment `after`: set to `kind` (its length kept), changed, or removed.
  function setTransition(after: string, kind: TransitionKind) {
    if (refused("video")) return;
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
  const updateShape = (shape: Shape, group?: string) => change({ shapes: replaced(edits.shapes, shape) }, group);
  // Moved or trimmed, on the Timeline or in the inspector: its fades kept within it.
  const updateMusic = (clip: MusicClip, group?: string) => history.set(changeMusic({ edits, pick }, clip).edits, group);
  const updateOverlay = (overlay: Overlay, group?: string) => change({ overlays: replaced(edits.overlays, overlay) }, group);
  const updateSegment = (segment: ClipSegment, group?: string) => change({ segments: replaced(edits.segments, segment) }, group);
  // A notice told once while the change that makes it keeps coming (a drag), not at every step.
  const tellOnce = (text: string) => setNotice((old) => (old?.text === text ? old : { id: Date.now(), text }));
  // A Segment's or video Overlay's Speed set from the inspector: one change of `group`, its ripple included.
  function setItemSpeed(item: SpeedRef, speed: number, group: string) {
    const overlay = item.kind === "overlay" ? edits.overlays.find((other) => other.id === item.id) : undefined;
    const video = overlay ? (mediaById.get(overlay.media)?.duration ?? undefined) : undefined;
    const outcome = speedGesture(scene, item, speed, group, { longest, video });
    if (!outcome) return;
    if (outcome.edits !== edits) history.set(outcome.edits, group);
    if (outcome.notice) tellOnce(outcome.notice);
  }
  // A Keyframe edit's outcome: its edits as one change (of `group`), or, refused (a 101st Keyframe), why.
  function applyKeyed(outcome: Outcome | null, group?: string) {
    if (outcome?.notice) tellOnce(outcome.notice);
    else if (outcome) history.set(outcome.edits, group);
  }
  // An action's outcome: its edits as one change, what it picks, and what it tells.
  function apply(outcome: Outcome) {
    if (outcome.edits !== edits) history.set(outcome.edits);
    select(outcome.pick);
    if (outcome.notice) setNotice({ id: Date.now(), text: outcome.notice });
  }
  const scene = { edits, pick, played, duration, gap: (time: number) => wordGap(job.transcript?.words ?? [], time), magnetic, locked: tracks.locked };
  // The Clipboard, across Candidates and Jobs while the tab is open.
  const here = { job: job.id, candidate: initial.id };
  const clipboard = useClipboard();
  const clip = {
    copy() {
      const copied = copy(scene, here);
      if (copied) setClipboard(copied);
    },
    cut() {
      const done = cut(scene, here);
      if (!done) return;
      setClipboard(done.clipboard);
      apply(done.outcome);
    },
  };
  const pasteHere = clipboard && (() => apply(paste(scene, clipboard, playback.time, here, job.transcript?.words ?? [])));
  const actions = itemActions(scene, () => playback.time, apply, clip);
  const splits = splitter(scene, () => playback.time, apply);
  const freezes = freezer(scene, () => playback.time, apply, { longest });
  // A Segment's or video Overlay's Reverse turned on or off (the inspector's switch, R): one change.
  function setItemReverse(item: SpeedRef, reverse: boolean) {
    const outcome = setReverse(scene, item, reverse);
    if (outcome) history.set(outcome.edits);
  }
  // The one picked Segment or video Overlay, which R reverses.
  const reversed = reversible(scene, (media) => mediaById.get(media)?.kind === "video");
  // The one picked Segment or video Overlay, whose Speed sheet the phone's toolbar opens.
  const speedSheet = speedSheetItem(scene, (media) => mediaById.get(media)?.kind === "video");
  // The Retimed copy the preview plays a Segment or Overlay from, as the plan has it (retimedCopy.ts).
  function copyOf(item: SpeedRef): RetimedAsk | null {
    const plan = preview?.plan;
    if (item.kind === "segment") {
      const shown = plan?.segments.find((segment) => segment.id === item.id);
      const range = shown && segmentCopy(shown);
      if (!range) return null;
      return shown.media ? { media: shown.media, range } : { job: job.id, range };
    }
    const event = plan?.overlays.find((overlay) => overlay.id === item.id);
    const range = event && !event.image ? eventCopy(event) : null;
    return event && range ? { media: event.media, range } : null;
  }
  // A Freeze frame's Duration typed in: one change, its ripple included.
  function setFreezeHold(id: string, hold: number) {
    const outcome = setHold(scene, id, hold, { longest });
    if (!outcome) return;
    history.set(outcome.edits);
    if (outcome.notice) setNotice({ id: Date.now(), text: outcome.notice });
  }
  // The picked Text Layers, Shapes, Music Clips and Overlays moved `delta` seconds, together.
  function moveLayers(delta: number, group: string) {
    const moved = move(scene, delta);
    if (moved) history.set(moved.edits, group);
  }
  // The preview full screen, or back. Text being retyped on the stage is put down first, and the
  // focus leaves the button, so that Space plays.
  function setFullscreen(on: boolean) {
    (document.activeElement as HTMLElement | null)?.blur();
    if (on) fullscreen.enter();
    else fullscreen.exit();
  }
  // Loop on or off; turned on with no marks, it marks the whole Clip.
  function toggleLoop() {
    if (!looping && !region) setMarks({ in: 0, out: duration });
    setLooping(!looping);
  }
  // In or Out marked at the playhead, on its frame.
  function mark(end: keyof LoopMarks) {
    setMarks(ordered({ ...marks, [end]: onFrame(playback.time, fps) }));
  }
  const points = editPoints(edits, played, { duration, hidden: tracks.hidden });
  // The one item picked that can have Keyframes: K, [ and ] and the ruler's diamonds work on it.
  const plan = preview?.plan ?? null;
  const keyedRef = usePickedKeyed({ edits, pick, plan }, playback);
  const keyed = keyedRef && keyedItem(edits, keyedRef, track, plan);
  const keyframes =
    keyedRef && keyed
      ? {
          toggle: () => {
            const outcome = toggleItemKey({ ...scene, track, plan }, keyedRef, activeKey(keyRows(edits, keyedRef, mediaById), keyed.keys, touched), playback.time);
            if (!outcome) return false;
            applyKeyed(outcome);
          },
          around: (time: number, direction: -1 | 1) => keyAround(keyed, time, direction),
        }
      : null;
  // A ruler diamond's drag, which holds this `moveKeys` from when it was grabbed: each move from the
  // edits as they were then, one change of its gesture once it has moved a Keyframe (so that a drag
  // back to where it began puts them back, and a drag that moves none leaves no step of undo).
  let keysMoved = false;
  const moveKeys = (from: number, to: number, group: string) => {
    const moved = keyedRef && moveItemKeys({ ...scene, track, plan }, keyedRef, from, to, fps);
    if (!moved || (!keysMoved && moved.edits === edits)) return;
    keysMoved = true;
    history.set(moved.edits, group);
  };
  // What the keys and the buttons that do the same do (./commands.ts).
  const commands = commandsOf(history, playback, actions, {
    pickAll: () => select(pickAll(edits)),
    pickNone: () => select(null),
    paste: pasteHere,
    move: itemsOf(pick).some((item) => item.kind !== "segment") ? moveLayers : null,
    split: splits.split,
    freeze: () => (freezes.canFreeze(playback.time) ? freezes.freeze() : false),
    reverse: () => {
      if (!reversed) return false;
      const items: { id: string; reverse?: boolean }[] = reversed.kind === "segment" ? edits.segments : edits.overlays;
      setItemReverse(reversed, !items.find((item) => item.id === reversed.id)?.reverse);
    },
    fit: () => fitTimeline.current?.(),
    zoom: (direction) => zoomTimeline.current?.(direction),
    shortcuts: () => setShortcuts(true),
    editPoints: points,
    markIn: () => mark("in"),
    markOut: () => mark("out"),
    loop: toggleLoop,
    clearMarks: () => {
      setMarks(NO_MARKS);
      setLooping(false);
    },
    fps,
    setFullscreen,
    keyframes,
  });
  useShortcuts(commands, { fullscreen: fullscreen.way !== null, phone: !wide });

  async function close() {
    await history.flush();
    // Leaving drops the edits a refused save held: only once the owner says so.
    if (stale.current) setLeaving(true);
    else leave();
  }

  function leave() {
    navigate(`/jobs/${job.id}?candidate=${candidate.id}`);
  }

  // Whether the Text Layer, Shape or Overlay `id` is one of several picked on the frame, which move with it.
  const placedTogether = (kind: PlacedKind, id: string) => isPicked(pick, kind, id) && itemsOf(pick).filter((item) => isPlaced(item.kind)).length > 1;
  function moveOnFrame(dx: number, dy: number, group: string) {
    const moved = nudge(scene, dx, dy);
    if (moved) history.set(moved.edits, group);
  }

  // The Overlays on the preview, picked and transformed there; on a locked Track, only drawn. One
  // of several picked moves them all. A keyed one is held where it is at the playhead, and its
  // keyed fields are written there as Keyframes (auto-key, ADR 0008).
  const overlayControls: StageControls["overlays"] = tracks.locked.includes("overlay")
    ? undefined
    : {
        transformOf: (id, time) => {
          const overlay = edits.overlays.find((other) => other.id === id);
          return overlay && heldTransform(overlay.transform, overlay.keys, overlay, time);
        },
        onTransform: (id, transform, group, time) => {
          const overlay = edits.overlays.find((other) => other.id === id);
          if (!overlay) return;
          const old = heldTransform(overlay.transform, overlay.keys, overlay, time);
          if (placedTogether("overlay", id)) moveOnFrame(transform.x - old.x, transform.y - old.y, group);
          else {
            applyKeyed(writeItemTransform(scene, { kind: "overlay", id }, transform, time, old), group);
          }
        },
        cropOf: (id) => edits.overlays.find((overlay) => overlay.id === id)?.crop,
        onCrop: (id, crop, transform, group) => {
          const overlay = edits.overlays.find((other) => other.id === id);
          if (!overlay) return;
          const cropped = { ...scene, edits: { ...edits, overlays: replaced(edits.overlays, { ...overlay, crop }) } };
          const held = heldTransform(overlay.transform, overlay.keys, overlay, playback.time);
          applyKeyed(writeItemTransform(cropped, { kind: "overlay", id }, transform, playback.time, held), group);
        },
      };
  // The Text Layers on the preview, moved, scaled and turned there; on a locked Track, only drawn.
  // One of several picked moves them all; scaling or turning one leaves its words and size as they
  // are. A keyed one is held where it is at the playhead, and its keyed fields are written there as
  // Keyframes (auto-key), as an Overlay's are.
  const textControls: StageControls["texts"] = tracks.locked.includes("text")
    ? undefined
    : {
        transformOf: (id, time) => {
          const layer = edits.text_layers.find((other) => other.id === id);
          return layer && heldTransform(layer.transform, layer.keys, layer, time);
        },
        onTransform: (id, transform, group, time) => {
          const layer = edits.text_layers.find((other) => other.id === id);
          if (!layer) return;
          const old = heldTransform(layer.transform, layer.keys, layer, time);
          if (placedTogether("text", id)) moveOnFrame(transform.x - old.x, transform.y - old.y, group);
          else applyKeyed(writeItemTransform(scene, { kind: "text", id }, transform, time, old), group);
        },
        // Its box Grips: its wrap width or fixed height, its words rewrapped by the next plan.
        onBox: (id, edge, length, group) => {
          const layer = edits.text_layers.find((other) => other.id === id);
          if (layer) updateText({ ...layer, style: boxStyle(layer.style, edge, length) }, group);
        },
      };
  // The Shapes on the preview, moved, scaled and turned there as Text Layers are; on a locked Track,
  // only drawn. Their edges (a line's or an arrow's ends) set their Shape Style's size, with the
  // Transform that keeps the other edge or end in place, auto-keyed: one change.
  const shapeControls: StageControls["shapes"] = tracks.locked.includes("shape")
    ? undefined
    : {
        transformOf: (id, time) => {
          const shape = edits.shapes.find((other) => other.id === id);
          return shape && heldTransform(shape.transform, shape.keys, shape, time);
        },
        onTransform: (id, transform, group, time) => {
          const shape = edits.shapes.find((other) => other.id === id);
          if (!shape) return;
          const old = heldTransform(shape.transform, shape.keys, shape, time);
          if (placedTogether("shape", id)) moveOnFrame(transform.x - old.x, transform.y - old.y, group);
          else applyKeyed(writeItemTransform(scene, { kind: "shape", id }, transform, time, old), group);
        },
        onResize: (id, box, transform, group, time) => {
          const shape = edits.shapes.find((other) => other.id === id);
          if (shape) applyKeyed(resizeShape(scene, id, box, transform, time, heldTransform(shape.transform, shape.keys, shape, time)), group);
        },
      };
  // What the inspector's ‹ ◆ › and the Keyframes pane edit in: each Keyframe edit one change, a drag one gesture.
  const keying: Keying = {
    edits, pick, locked: tracks.locked, track, plan, playback, onEdits: (next, group) => history.set(next, group), touched, onTouch: setTouched, onNotice: tellOnce,
  };
  // A video Segment keyed in its Framing's Transform, or a Manual Scene in its override's: held on
  // the stage where it is at the playhead, and its keyed fields written there as Keyframes, as a
  // keyed Overlay's are (a Manual Scene's in seconds from its Scene's start).
  const keyedPicture = (ref: KeyedRef) => {
    const item = keyedItem(edits, ref, track, plan);
    const transform = item?.transform;
    if (!item || !transform || !PICTURE_KEYS.some((prop) => item.keys[prop]?.length)) return null;
    return { ref, transform, held: (time: number) => heldTransform(transform, item.keys, item, time) };
  };
  // The picture behind the Overlays, the Segment under the playhead: picked there (its Video Track
  // unlocked), and transformed when it is a video's or a Manual Scene's (docs/adr/0007).
  const pictureAt: StageControls["pictureAt"] =
    tracks.locked.includes("video") || !plan
      ? undefined
      : (segment, at) => {
          const source = pictureSource(edits, plan, segment, at);
          if (!source) return null;
          const ref: KeyedRef | null = source.kind === "media" ? { kind: "segment", id: source.segment } : source.kind === "manual" ? sceneRef(source.scene) : null;
          const keyed = ref && keyedPicture(ref);
          const written = (next: AdvancedEdits, transform: Transform, group: string) => {
            if (keyed) applyKeyed(writeItemTransform({ ...scene, edits: next, track, plan }, keyed.ref, transform, playback.time, keyed.held(playback.time)), group);
          };
          return {
            picked: isPicked(pick, "segment", source.segment),
            onPick: (toggle) => select(clicked(pick, { kind: "segment", id: source.segment }, toggle || picking)),
            transform: source.kind === "auto" ? null : keyed ? keyed.held(playback.time) : source.transform,
            onTransform: (transform, group) =>
              keyed ? written(edits, transform, group) : history.set(withPictureTransform(edits, plan, source, transform), group),
            crop: pictureCrop(edits, plan, source),
            onCrop: (crop, transform, group) =>
              keyed
                ? written(withPictureCrop(edits, plan, source, crop, keyed.transform), transform, group)
                : history.set(withPictureCrop(edits, plan, source, crop, transform), group),
          };
        };
  // The inspector's Crop for a Segment's or an Overlay's picture: the playhead put on it if it isn't,
  // the inspector's or the Transform sheet closed, and Crop mode opened on the stage. None where the stage can't
  // crop it (its Track locked, full screen).
  const cropMode = (kind: "segment" | "overlay", id: string): (() => void) | undefined => {
    if (fullscreen.way || !plan || tracks.locked.includes(kind === "overlay" ? "overlay" : "video")) return undefined;
    return () => {
      const overlay = kind === "overlay" ? edits.overlays.find((other) => other.id === id) : undefined;
      const index = edits.segments.findIndex((segment) => segment.id === id);
      const range = overlay ? { start: overlay.start, end: overlay.start + overlay.secs } : (plan.segments[index] ?? (index === 0 ? { start: 0, end: duration } : null));
      if (range && (playback.time < range.start || playback.time >= range.end)) playback.seek((range.start + range.end) / 2);
      setSheet((open) => (open === "inspector" || open === "transform" ? null : open));
      setCropAsked((count) => count + 1);
    };
  };
  const source = job.source!;
  const fullscreenButton = (
    <Button
      variant="ghost"
      size="icon"
      onClick={commands[fullscreen.way ? "fullscreen-exit" : "fullscreen"]}
      aria-label={fullscreen.way ? "Leave full screen" : "Full screen"}
      title={fullscreen.way ? "Leave full screen (F)" : "Full screen (F)"}
    >
      {fullscreen.way ? <Minimize aria-hidden size={18} /> : <Maximize aria-hidden size={18} />}
    </Button>
  );
  const player = (
    <ClipPreview
      src={mediaUrl(job.id, source.preview ?? source.video)}
      jobId={job.id}
      preview={shown}
      blank={tracks.hidden.includes("video")}
      fonts={fonts}
      playback={playback}
      // Full screen, nothing on the stage is picked, moved or retyped: it is watched.
      stage={fullscreen.way ? undefined : {
        selected: stageIdsOf(pick),
        onSelect: (id, toggle) => {
          const item = stageItem(id);
          select("id" in item ? clicked(pick, item, toggle || picking) : item);
        },
        onPlace: (id, place, group) =>
          change({ style_overrides: placedOverrides(edits.style_overrides, id === "hook" ? "hook" : "caption", place) }, group),
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
        texts: textControls,
        shapes: shapeControls,
        fixed: tracks.locked.filter((kind) => kind === "hook" || kind === "captions"),
        overlays: overlayControls,
        pictureAt,
        cropAsked,
        // A Stickers tile dropped on the preview: its Shape there, at the playhead.
        drop: { types: [DRAG_SHAPE], onDrop: (data, at) => addNewShape(data.getData(DRAG_SHAPE) as ShapeKind, playback.time, at) },
      }}
      fit
      rates={wide}
      tools={
        wide ? (
          fullscreenButton
        ) : (
          <>
            <FrameStep playback={playback} fps={fps} commands={commands} />
            {fullscreenButton}
          </>
        )
      }
      hideBar={!fullscreenBar.shown}
      loop={wide ? { on: looping, onToggle: commands.loop } : undefined}
    />
  );
  // The player, or full screen (over the whole window where the browser can't put it full screen),
  // the player alone on black, its bar shown while the pointer moves.
  const room = (
    <div
      ref={fullscreenRoom}
      onPointerMove={fullscreen.way ? fullscreenBar.wake : undefined}
      onPointerDown={fullscreen.way ? fullscreenBar.wake : undefined}
      className={cx(
        "flex min-h-0 flex-1 flex-col",
        fullscreen.way && "bg-black p-3",
        fullscreen.way === "window" &&
          "fixed inset-0 z-50 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(0.75rem,env(safe-area-inset-bottom))]",
        !fullscreenBar.shown && "cursor-none",
      )}
    >
      {player}
    </div>
  );
  const timeline = (
    <AdvancedTimeline
      duration={duration}
      labelWidth={wide ? TRACK_LABEL_WIDTH : undefined}
      playback={playback}
      fps={fps}
      snapPoints={edgesOf(edits, played, { hidden: tracks.hidden, moving: pick })}
      tools={
        <>
          <MagneticToggle />
          <ItemTools actions={actions} splitter={splits} freezer={freezes} playback={playback} paste={pasteHere} />
        </>
      }
      onBand={(items, band, add) => select(bandPick(pick, items, band, add))}
      onClear={() => select(null)}
      toFit={(timeline) => zoomToFit({ pick, edits, played, duration }, timeline)}
      fitRef={fitTimeline}
      zoomStepRef={zoomTimeline}
      skimmable={wide}
      loop={{ region, on: looping, onMarks: (next) => setMarks(ordered(next)) }}
      keyMarks={
        keyedRef && keyed
          ? {
              marks: keyMarks(keyed),
              onMove: moveKeys,
            }
          : undefined
      }
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
          mediaCache={mediaCache}
          source={{ job: job.id, metadata: source.metadata }}
          changed={changed}
          picking={picking}
          tracks={tracks}
          onTrack={wide ? toggleTrack : undefined}
          handlers={{
            onSelect: select,
            onEdits: history.set,
            onText: updateText,
            onShape: updateShape,
            onMusic: updateMusic,
            onOverlay: updateOverlay,
            onSegment: moveSegment,
            onMove: moveLayers,
            onVolume: (item, volume, group) => {
              // A Music Clip or video Segment with volume Keyframes gets one at the playhead (auto-key).
              applyKeyed(writeItemKey({ ...scene, track }, item, "volume", volume, playback.time), group);
            },
            onFade: (id, fade, secs, heard, group) => {
              const outcome = setFade(scene, id, fade, secs, heard);
              if (outcome) history.set(outcome.edits, group);
            },
            onJoin: (after) => {
              select({ kind: "join", after });
              if (wide) setAssetTab("transitions");
            },
            onDropTransition: setTransition,
            onDropMedia: dropMedia,
            onDropText: (id, time) => {
              const preset = textPresets?.find((p) => p.id === id);
              if (preset) addText(fromPreset(preset), time);
            },
            onDropShape: (kind, time) => addNewShape(kind, time),
            onDelete: actions ? (rippled) => (rippled ? actions.rippleRemove() : actions.remove()) : undefined,
          }}
        />
      )}
    </AdvancedTimeline>
  );
  const inspector = (
    <KeyingContext.Provider value={keying}>
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
        onShape={updateShape}
        onMusic={updateMusic}
        onOverlay={updateOverlay}
        onSegment={updateSegment}
        onSpeed={setItemSpeed}
        onReverse={setItemReverse}
        copyOf={copyOf}
        onHold={setFreezeHold}
        cropMode={cropMode}
      />
    </KeyingContext.Provider>
  );
  const assets = (tab: AssetTab) => (
    <AssetPanel
      tab={tab}
      fonts={fonts}
      library={library}
      transcript={job.transcript}
      near={edits.segments[0]}
      transitions={transitionPanel(true)}
      onAddText={(made) => addText(made)}
      onAddShape={(kind) => addNewShape(kind)}
      onAddMusic={(item) => addMusic(item)}
      onAddSource={(range) => addSegment({ id: newId(), ...range })}
      onAddVideo={(item) => addSegment(newMediaSegment(item, newId()))}
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
        onShortcuts={wide ? () => setShortcuts(true) : undefined}
        onClose={() => void close()}
      />
      <ShortcutsSheet open={shortcuts && wide} onClose={() => setShortcuts(false)} />
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
            {room}
            {notes}
          </section>
          <aside aria-label="Inspector" className="glass min-h-0 overflow-y-auto rounded-panel p-4">
            {inspector}
          </aside>
        </div>
        <section
          aria-label="Timeline and Keyframes"
          // The Keyframes pane takes a little more room than the Timeline: a row per property, and the Curves.
          className={cx("glass mx-3 flex flex-col overflow-hidden rounded-panel", bottomTab === "keyframes" ? "h-[44dvh] min-h-72" : "h-[36dvh] min-h-60")}
        >
          <BottomTabs value={bottomTab} onChange={setBottomTab} />
          {/* The Timeline stays, hidden, under the Keyframes pane: its zoom and scroll are kept. */}
          <div id={bottomPanelId("timeline")} role="tabpanel" aria-label="Timeline" hidden={bottomTab !== "timeline"}
            className={cx("min-h-0 flex-1 flex-col", bottomTab === "timeline" ? "flex" : "hidden")}
          >
            {timeline}
          </div>
          {bottomTab === "keyframes" && (
            <div id={bottomPanelId("keyframes")} role="tabpanel" aria-label="Keyframes" className="flex min-h-0 flex-1 flex-col">
              <KeyingContext.Provider value={keying}>
                <KeyframesPane keying={keying} fps={fps} mediaById={mediaById} />
              </KeyingContext.Provider>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      {bar}
      <section aria-label="Player" className="flex min-h-0 flex-1 flex-col gap-1 px-3 pt-1 pb-2">
        {room}
        {notes}
      </section>
      <section aria-label="Timeline" className="flex h-[30dvh] min-h-44 flex-col border-t border-border">
        {timeline}
      </section>
      <Toolbar
        pick={pick}
        actions={actions}
        splitter={splits}
        freezer={freezes}
        playback={playback}
        onAsset={(tab) => {
          setAssetTab(tab);
          setSheet(tab);
        }}
        picking={picking}
        paste={pasteHere}
        onInspect={() => setSheet("inspector")}
        onTransform={() => setSheet("transform")}
        onSpeed={speedSheet && (() => setSheet("speed"))}
        onTracks={() => setSheet("tracks")}
        onPlayback={() => setSheet("playback")}
        onPicking={() => setPickingMode(true)}
        onDeselect={() => {
          select(null);
          setPickingMode(false);
          setSheet(null);
        }}
      />
      {sheet && (
        <Sheet
          title={
            sheet === "inspector"
              ? "Edit"
              : sheet === "transform"
                ? "Transform"
                : sheet === "speed"
                  ? "Speed"
                  : sheet === "tracks"
                    ? "Tracks"
                      : sheet === "playback"
                        ? "Playback"
                        : ASSET_TABS.find((tab) => tab.value === sheet)!.label
          }
          onClose={() => setSheet(null)}
        >
          {/* The Keyframes pane is the desktop's: here, the Ease of the Keyframe at the playhead heads the sheet. */}
          {sheet === "inspector" ? (
            <>
              <KeyingContext.Provider value={keying}>
                <SheetEase mediaById={mediaById} />
              </KeyingContext.Provider>
              {inspector}
            </>
          ) : sheet === "transform" ? (
            <KeyingContext.Provider value={keying}>
              <SheetEase mediaById={mediaById} shown={PICTURE_KEYS} />
              <TransformPanel
                pick={pick}
                edits={edits}
                preview={preview}
                mediaById={mediaById}
                playback={playback}
                onEdits={history.set}
                onOverlay={updateOverlay}
                onSegment={updateSegment}
                cropMode={cropMode}
              />
            </KeyingContext.Provider>
          ) : sheet === "speed" ? (
            speedSheet ? (
              <SpeedPanel
                item={speedSheet}
                edits={edits}
                mediaById={mediaById}
                copyOf={copyOf}
                onSpeed={setItemSpeed}
                onReverse={setItemReverse}
                onHold={setFreezeHold}
                onSegment={updateSegment}
                onOverlay={updateOverlay}
              />
            ) : (
              <p className="text-sm text-pretty text-muted">Pick a Segment or a video Overlay to change its Speed.</p>
            )
          ) : sheet === "tracks" ? (
            <TracksPanel tracks={tracks} onTrack={toggleTrack} />
          ) : sheet === "playback" ? (
            <PlaybackPanel playback={playback} commands={commands} region={region} looping={looping} editPoints={points} fps={fps} />
          ) : (
            assets(sheet)
          )}
        </Sheet>
      )}
    </div>
  );
}

// No In or Out mark.
const NO_MARKS: LoopMarks = { in: null, out: null };

// The marks with In before Out: crossed marks swap.
function ordered(marks: LoopMarks): LoopMarks {
  return marks.in !== null && marks.out !== null && marks.in > marks.out ? { in: marks.out, out: marks.in } : marks;
}

// Where the focus takes every key but Escape: a field, or text being typed on the stage. Not the
// preview's scrubber and rate menu (`data-shortcuts`), which leave every key to the table.
const FIELD = "input:not([data-shortcuts]), textarea, select:not([data-shortcuts]), [contenteditable='true']";
// What keeps its own arrows, Enter, Space and Delete when it has the focus: a Timeline or stage item,
// reached by Tab. A button keeps only Enter: Space plays, and isn't also a click.
const ITEM = "[role=button]";

// The shortcuts of the keymap table (./keymap.ts), each done by its command. One that can't be done
// now leaves its key to the browser.
function useShortcuts(commands: Commands, context: { fullscreen: boolean; phone: boolean }) {
  const { fullscreen, phone } = context;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const id = resolveShortcut(keysOf(event), {
        typing: !!target.closest(FIELD),
        item: !!target.closest(ITEM),
        fullscreen,
        phone,
      });
      if (!id || commands[id]() === false) return;
      // Escape is the browser's too (it closes a dialog), and still does that.
      if (id !== "pick-none") event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [commands, fullscreen, phone]);
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
