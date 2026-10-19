import { AlertTriangle, Plus, ScanSearch, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import {
  mainTrackOf,
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type ClipSegment,
  type JobDetail,
  type JobProgress,
  type Layout,
  type Transcript,
} from "../../api";
import { Button, buttonClass } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { useFonts } from "../../fonts";
import { cx, formatPrecise } from "../../format";
import { clipTrimmed, layersOf } from "./advanced/actions";
import { cutNote } from "./advanced/speed";
import { candidateName } from "./CandidateList";
import { CaptionTextEditor } from "./editor/CaptionTextEditor";
import { ClipPreview, type PickedOnStage, type StageControls } from "./editor/ClipPreview";
import { clipLayoutChange, pictureChange } from "./editor/clipManual";
import { candidateDraft } from "./editor/draft";
import { useMagnetic } from "./editor/magnetic";
import { offeredLayouts, portraitSource, shownLayout } from "./editor/layouts";
import { sceneLayoutOverrides } from "./editor/manual";
import { Playback, playedFrom, playable } from "./editor/playback";
import { segmentLength } from "./editor/segmentTime";
import { sceneAt, SceneLayoutPicker, ScenesTrack } from "./editor/ScenesTrack";
import { pictureSource } from "./editor/stagePicture";
import { CaptionStylePanel } from "./editor/CaptionStylePanel";
import { HookLook, HookMoreOptions, HookPosition } from "./editor/HookStylePanel";
import { JoinTransitionPanel } from "./editor/JoinTransitionPanel";
import { PresetBar } from "./editor/PresetBar";
import { StyleFieldsSkeleton } from "./editor/StyleFields";
import { Timeline, type Range } from "./editor/Timeline";
import { RevisionHistory } from "./editor/RevisionHistory";
import { useDraftSave } from "./editor/useDraftSave";
import { usePreviewPlan } from "./editor/usePreviewPlan";
import { placedFields } from "./editor/placing";
import { useStyleDraft } from "./editor/useStyleDraft";
import { WatermarkPanel } from "./editor/WatermarkPanel";
import { HookEditor, HookTimingFields, type HookTiming } from "./HookEditor";
import { PreviewPlayer } from "./PreviewPlayer";
import { TranscriptPicker, type WordRange } from "./TranscriptPicker";

type Mode = "start" | "end" | "new";

const MODES = [
  { value: "start", label: "Start" },
  { value: "end", label: "End" },
  { value: "new", label: "New clip" },
] as const;

const MODE_HINTS: Record<Mode, string> = {
  start: "Click the word the clip should start with.",
  end: "Click the word the clip should end with.",
  new: "Click the first and the last word of a new clip, or drag across them.",
};

type Tab = "text" | "captions" | "hook" | "watermark" | "transitions" | "trim";

const TABS: { value: Tab; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "captions", label: "Captions" },
  { value: "hook", label: "Hook" },
  { value: "watermark", label: "Watermark" },
  { value: "transitions", label: "Transitions" },
  { value: "trim", label: "Trim" },
];

const VIEWS = [
  { value: "clip", label: "Clip" },
  { value: "source", label: "Source" },
] as const;

const LAYOUTS = [
  { value: "auto", label: "Auto" },
  { value: "track", label: "Track" },
  { value: "split", label: "Split" },
  { value: "blur", label: "Blur" },
  { value: "manual", label: "Manual" },
] as const;

const LAYOUT_HINTS: Record<Layout, string> = {
  auto: "Chosen per scene from the faces in it.",
  track: "A 9:16 crop following the speaker, in every scene.",
  split: "Two stacked panels, left person on top, in every scene.",
  blur: "The wide shot over a blurred background, in every scene.",
  manual: "Framed by hand, in every scene: drag the picture on the preview to pan it, its corners to zoom.",
};

// A portrait episode is shown as it was shot, whatever the automatic Layout, unless framed by hand.
const PORTRAIT_HINT = "A portrait episode is shown as it was shot. Choose Manual to frame it by hand.";

/**
 * One Candidate under review: its preview (the Clip as it will look, or the Source), the Transcript
 * Picker for its edges and for new clips, its hook, layout and selection, and the AI's reasoning
 * and copy. Every change is saved at once. The click mode and a new clip being chosen carry over to
 * the next Candidate opened.
 */
export function CandidateEditor({
  job,
  transcript,
  candidate,
  synced,
  onRestore,
  index,
  progress,
  onSave,
  onAdd,
  onPrepare,
}: {
  job: JobDetail;
  transcript: Transcript;
  candidate: Candidate;
  // How many times the Candidate was taken as saved in another editor: its drafts start again from it.
  synced: number;
  // Restores an entry of its Revision History; answers why it couldn't, or null.
  onRestore: (revision: number) => Promise<string | null>;
  index: number;
  progress: JobProgress;
  onSave: (change: CandidateChange) => Promise<boolean>;
  onAdd: (range: { start: number; end: number }) => Promise<boolean>;
  // Queues the Candidate's transcription and analysis, for the preview.
  onPrepare: (candidateId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("start");
  const [view, setView] = useState<"clip" | "source">("clip");
  const [tab, setTab] = useState<Tab>("text");
  const fonts = useFonts();
  const [hookDraft, setHookDraft] = useState<string | null>(null);
  const [kickerDraft, setKickerDraft] = useState<string | null>(null);
  // The drafts of this Candidate as last taken from elsewhere.
  const drafts = `${candidate.id}:${synced}`;
  const style = useStyleDraft(candidate, (change) => void onSave(change), drafts);
  // Whether each tab's More options is open, kept from one Candidate to the next.
  const [more, setMore] = useState({ captions: false, hook: false });
  const [trimDraft, setTrimDraft] = useState<Range | null>(null);
  const [captionFocus, setCaptionFocus] = useState<{ at: number } | null>(null);
  const [scene, setScene] = useState<number | null>(null);
  // The hook or the captions, selected on the preview.
  const [onStage, setOnStage] = useState<PickedOnStage | null>(null);
  // Or the picture of the Manual Scene under the playhead, to pan and scale.
  const [pictureOn, setPictureOn] = useState(false);
  // How many times the hook or the Kicker was retyped on the preview: its fields start again from it.
  const [retyped, setRetyped] = useState(0);
  const [timing, setTiming] = useDraftSave<HookTiming>(
    { hook_start: candidate.hook_start, hook_secs: candidate.hook_secs },
    (value) => void onSave(value),
    drafts,
  );
  const [preparing, setPreparing] = useState<string | null>(null);
  const playback = useMemo(() => new Playback(), []);
  // Cut into Segments in the Advanced Edit: the trim and the Source-time timeline give way to it.
  const cut = candidate.segments.length > 0;
  // What clicking a word sets: for a cut Clip, only a new clip's range.
  const clickMode: Mode = cut ? "new" : mode;
  const advanced = `/jobs/${job.id}/candidates/${candidate.id}/advanced`;

  useEffect(() => {
    setCaptionFocus(null);
    setScene(null);
    setOnStage(null);
    setPictureOn(false);
  }, [candidate.id]);
  // Drafts start again from another Candidate, and from one saved elsewhere.
  useEffect(() => {
    setHookDraft(null);
    setKickerDraft(null);
    setTrimDraft(null);
  }, [drafts]);
  // A preparation asked for here is over once the Job is back in review.
  useEffect(() => {
    if (progress.status !== "rendering") setPreparing(null);
  }, [progress.status]);

  function prepare() {
    setPreparing(candidate.id);
    onPrepare(candidate.id).catch(() => setPreparing(null));
  }

  const range = trimDraft ?? { start: candidate.start, end: candidate.end };
  const draft: CandidateChange = {
    ...candidateDraft(candidate),
    ...(trimDraft ?? {}),
    hook_text: hookDraft ?? candidate.hook_text,
    hook_kicker: kickerDraft ?? candidate.hook_kicker,
    preset_id: style.draft.preset_id,
    style_overrides: style.draft.style_overrides,
    hook_start: timing.hook_start,
    hook_secs: timing.hook_secs,
  };
  const { preview, error: previewError } = usePreviewPlan(job.id, candidate.id, draft, progress.status);
  if (cut) playback.setSegments(preview?.plan.segments.length ? playable(preview.plan.segments) : playedFrom(candidate.segments));
  else playback.setRange(candidate.start, candidate.end);
  const [pending, setPending] = useState<{ first: number; last: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const words = transcript.words;
  const duration = job.source?.metadata.duration ?? Infinity;
  const length = cut ? playback.duration : segmentLength(candidate);
  const { min_secs, max_secs } = job.options;
  const name = candidateName(candidate, index);
  const magnetic = useMagnetic();
  const plan = preview?.plan ?? null;
  const portrait = portraitSource(plan);
  // What of the Candidate frames its pictures.
  const framed = { segments: mainTrackOf(candidate), layout: candidate.layout, framing: candidate.framing, layout_overrides: candidate.layout_overrides };
  // The picture of a Manual Scene under the playhead, panned and scaled on the preview from its
  // corners, its Framing saved where it is kept (docs/adr/0007). Its turn, stretch, crop and
  // Background, and a video's Framing, are set in the Advanced Edit.
  const pictureAt: StageControls["pictureAt"] = plan
    ? (segment, at) => {
        const source = pictureSource(framed, plan, segment, at);
        if (source?.kind !== "manual" || plan.scenes[at].layout !== "manual") return null;
        return {
          picked: pictureOn,
          onPick: () => {
            setPictureOn(true);
            setOnStage(null);
          },
          transform: source.transform,
          grips: "corners",
          onTransform: (transform) => {
            const change = pictureChange(framed, plan, source, transform);
            if (change) void onSave(change);
          },
        };
      }
    : undefined;

  // The uncut Clip's start or end moved: on the Magnetic timeline its Text Layers, Shapes, Music
  // Clips, Overlays and hook move with it, in the same save (docs/adr/0004-layers-ripple-with-the-main-track.md).
  function trim(change: { start?: number; end?: number }): Promise<boolean> {
    if (!magnetic || cut) return onSave(change);
    const { start, end } = candidate;
    const { layers, notice } = clipTrimmed(layersOf(candidate), { start, end }, { start: change.start ?? start, end: change.end ?? end });
    if (notice) setNotice(notice);
    return onSave({ ...change, ...layers });
  }

  // The backend snaps an edge to the Word it falls in: send the Word's own start or end.
  function pick(i: number) {
    setNotice(null);
    if (clickMode === "new") {
      setPending((old) => (old && old.last === null ? { first: old.first, last: i } : { first: i, last: null }));
      return;
    }
    const word = words[i];
    if (clickMode === "start") {
      if (word.start >= candidate.end) return setNotice("The start must come before the clip's end. Move the end first.");
      void trim({ start: word.start });
    } else {
      if (word.end <= candidate.start) return setNotice("The end must come after the clip's start. Move the start first.");
      void trim({ end: Math.min(word.end, duration) });
    }
  }

  function selectRange(range: WordRange) {
    setNotice(null);
    setPending(range);
  }

  async function addClip() {
    if (!pending || pending.last === null) return;
    const first = Math.min(pending.first, pending.last);
    const last = Math.max(pending.first, pending.last);
    setAdding(true);
    const added = await onAdd({ start: words[first].start, end: Math.min(words[last].end, duration) });
    setAdding(false);
    if (added) setPending(null);
  }

  const pendingRange =
    pending && pending.last !== null
      ? {
          start: words[Math.min(pending.first, pending.last)].start,
          end: words[Math.max(pending.first, pending.last)].end,
        }
      : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <h3 className="text-lg font-semibold tracking-tight text-balance">
            <span className="text-muted tabular-nums">#{index + 1}</span> {name}
          </h3>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link to={advanced} className={buttonClass("secondary", "sm")}>
              <SlidersHorizontal aria-hidden size={16} />
              Edit Advanced
            </Link>
            <RevisionHistory
              jobId={job.id}
              candidateId={candidate.id}
              revision={candidate.revision}
              here="clip-editor"
              onRestore={onRestore}
              size="sm"
            />
            <Switch checked={candidate.selected} onChange={(selected) => void onSave({ selected })}>
              <span className="text-sm">Render this clip</span>
            </Switch>
          </div>
        </div>
        <p className="text-sm text-muted tabular-nums">
          {cut && candidate.segments.length > 1
            ? `${candidate.segments.length} Segments`
            : `${formatPrecise(candidate.start)} – ${formatPrecise(candidate.end)}`}{" "}
          ·{" "}
          {length.toFixed(1)} s
          {candidate.predicted_score !== null && ` · score ${candidate.predicted_score}`}
          {candidate.origin === "manual" && " · added by hand"}
        </p>
        {(length < min_secs || length > max_secs) && (
          <p className="flex items-center gap-1.5 text-sm text-accent-text">
            <AlertTriangle aria-hidden size={15} />
            Outside this Job's {min_secs}–{max_secs} s range. It can still be rendered.
          </p>
        )}
      </header>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] xl:items-start">
        <div className="flex flex-col gap-3 xl:sticky xl:top-4">
          {job.source && (
            <section aria-label="Preview" className="flex flex-col gap-3">
              {/* The legend is for screen readers only, so this bar lines up with the editor's tabs. */}
              {!cut && (
                <Segmented legend="Preview" options={VIEWS} value={view} onChange={setView} className="max-w-xs [&>legend]:sr-only" />
              )}
              {view === "clip" || cut ? (
                <ClipPreview
                  src={mediaUrl(job.id, job.source.preview ?? job.source.video)}
                  jobId={job.id}
                  preview={preview}
                  fonts={fonts}
                  playback={playback}
                  // Dragged on the preview while its tab is open.
                  onWatermarkMove={
                    tab === "watermark" && style.controls
                      ? (x, y) => style.controls?.setMany("watermark", { position: "custom", x, y })
                      : undefined
                  }
                  // The hook and the captions, moved, resized and retyped on the preview; not while the
                  // Watermark is moved there.
                  stage={
                    tab !== "watermark" && style.controls
                      ? {
                          selected: onStage ? [onStage] : [],
                          onSelect: (id) => {
                            setOnStage(id);
                            setPictureOn(false);
                            if (id === "hook" || id === "captions") setTab(id);
                          },
                          onPlace: (id, place) => style.controls?.setMany(id === "hook" ? "hook" : "caption", placedFields(place)),
                          retype: {
                            textOf: (id) => (id === "hook" ? (hookDraft ?? candidate.hook_text) : (kickerDraft ?? candidate.hook_kicker)),
                            onText: (id, text) => {
                              if (id === "hook") setHookDraft(text);
                              else if (id === "kicker") setKickerDraft(text);
                              else return;
                              void onSave(id === "hook" ? { hook_text: text } : { hook_kicker: text }).then(() => setRetyped((n) => n + 1));
                            },
                            onWords: (update) => void onSave({ word_edits: update(candidate.word_edits) }),
                          },
                          pictureAt,
                        }
                      : undefined
                  }
                />
              ) : (
                <PreviewPlayer
                  src={mediaUrl(job.id, job.source.preview ?? job.source.video)}
                  start={candidate.start}
                  end={candidate.end}
                />
              )}
              {(view === "clip" || cut) && (
                <PreviewNotes
                  wordsFromTranscript={preview?.words_source === "transcript" && job.options.captions}
                  unanalysed={preview?.analysed === false}
                  error={previewError}
                  preparing={preparing === candidate.id}
                  onPrepare={prepare}
                />
              )}
            </section>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <PresetBar style={style.controls} error={style.error} />
          <Tabs value={tab} onChange={setTab} />
          <div id={`editor-panel-${tab}`} role="tabpanel" aria-labelledby={`editor-tab-${tab}`} className="flex flex-col gap-6">
            {tab === "text" && preview && job.options.captions && (
              <section aria-labelledby="caption-text-heading" className="flex flex-col gap-3">
                <h4 id="caption-text-heading" className="font-semibold">
                  Caption text
                </h4>
                <CaptionTextEditor
                  key={candidate.id}
                  preview={preview}
                  edits={candidate.word_edits}
                  playback={playback}
                  focus={captionFocus}
                  onChange={(word_edits) => void onSave({ word_edits })}
                />
              </section>
            )}
            {tab === "text" && !job.options.captions && (
              <p className="text-sm text-muted">This Job's captions are off: turn them on in a new Job to caption its clips.</p>
            )}
            {tab === "captions" && (
              <section aria-labelledby="captions-heading" className="flex flex-col gap-3">
                <h4 id="captions-heading" className="sr-only">
                  Captions
                </h4>
                {style.controls ? (
                  <CaptionStylePanel
                    style={style.controls}
                    fonts={fonts}
                    more={more.captions}
                    onMore={(open) => setMore((old) => ({ ...old, captions: open }))}
                  />
                ) : (
                  !style.error && <StyleFieldsSkeleton />
                )}
              </section>
            )}
            {tab === "hook" && (
              <>
                <section aria-labelledby="hook-words-heading" className="flex flex-col gap-3">
                  <h4 id="hook-words-heading" className="font-semibold">
                    Words
                  </h4>
                  <HookEditor
                    key={`${drafts}:${retyped}`}
                    value={candidate.hook_text}
                    onSave={(hook_text) => void onSave({ hook_text })}
                    onDraft={setHookDraft}
                    kicker={candidate.hook_kicker}
                    onKickerSave={(hook_kicker) => void onSave({ hook_kicker })}
                    onKickerDraft={setKickerDraft}
                    fit={
                      preview?.plan.hook
                        ? {
                            lines: preview.plan.hook.lines.length,
                            max_lines: preview.plan.hook_style.max_lines,
                            fits: preview.plan.hook.size >= preview.plan.hook_style.size,
                          }
                        : null
                    }
                  />
                </section>
                <section aria-labelledby="hook-look-heading" className="flex flex-col gap-3">
                  <h4 id="hook-look-heading" className="font-semibold">
                    Look
                  </h4>
                  {style.controls ? <HookLook style={style.controls} fonts={fonts} /> : !style.error && <StyleFieldsSkeleton />}
                </section>
                <section aria-labelledby="hook-when-heading" className="flex flex-col gap-3">
                  <h4 id="hook-when-heading" className="font-semibold">
                    When and where
                  </h4>
                  {style.controls && <HookPosition style={style.controls} />}
                  <HookTimingFields
                    timing={timing}
                    duration={length}
                    onTiming={setTiming}
                    blank={(hookDraft ?? candidate.hook_text).trim() === ""}
                  />
                </section>
                {style.controls && (
                  <HookMoreOptions style={style.controls} open={more.hook} onToggle={(open) => setMore((old) => ({ ...old, hook: open }))} />
                )}
              </>
            )}
            {tab === "watermark" && (
              <section aria-labelledby="watermark-heading" className="flex flex-col gap-3">
                <h4 id="watermark-heading" className="sr-only">
                  Watermark
                </h4>
                {style.controls ? <WatermarkPanel style={style.controls} fonts={fonts} /> : !style.error && <StyleFieldsSkeleton />}
              </section>
            )}
            {tab === "transitions" && (
              <section aria-labelledby="transitions-heading" className="flex flex-col gap-3">
                <h4 id="transitions-heading" className="sr-only">
                  Transitions
                </h4>
                {style.controls ? <JoinTransitionPanel style={style.controls} /> : !style.error && <StyleFieldsSkeleton />}
              </section>
            )}
            {tab === "trim" && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Segmented
                    legend="Layout"
                    options={offeredLayouts(LAYOUTS, portrait)}
                    value={shownLayout(candidate.layout, portrait)}
                    // Manual frames the clip as the Scene under the playhead shows now.
                    onChange={(layout) =>
                      void onSave(clipLayoutChange(candidate, plan, plan ? sceneAt(plan, playback.shownTime, playback.shownSegmentIndex) : 0, layout))
                    }
                    className="max-w-md"
                  />
                  <p className="text-sm text-muted">{portrait && candidate.layout !== "manual" ? PORTRAIT_HINT : LAYOUT_HINTS[candidate.layout]}</p>
                </div>
                {cut && <CutNote segments={candidate.segments} to={advanced} />}
                <section aria-labelledby="picker-heading" className="flex flex-col gap-3">
                    <h4 id="picker-heading" className="font-semibold">
                      Transcript
                    </h4>
                    <Segmented
                      legend="Clicking a word sets"
                      // A cut Clip's edges are its Segments', trimmed in the Advanced Edit.
                      options={cut ? MODES.filter((option) => option.value === "new") : MODES}
                      value={clickMode}
                      onChange={(value) => {
                        setMode(value);
                        setNotice(null);
                        if (value !== "new") setPending((old) => (old && old.last === null ? null : old));
                      }}
                      className="max-w-sm"
                    />
                    <p className="text-sm text-muted">{MODE_HINTS[clickMode]}</p>
                    <TranscriptPicker
                      key={candidate.id}
                      words={words}
                      segments={transcript.segments}
                      start={candidate.start}
                      end={candidate.end}
                      pending={pending}
                      onPick={pick}
                      onRange={selectRange}
                    />
                    <div aria-live="polite" className="flex flex-col gap-2 empty:hidden">
                      {notice && <p className="text-sm text-accent-text">{notice}</p>}
                      {pending && (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-dashed border-waiting bg-waiting-surface p-3">
                          <p className="text-sm">
                            {pendingRange ? (
                              <>
                                New clip {formatPrecise(pendingRange.start)} – {formatPrecise(pendingRange.end)} ·{" "}
                                {(pendingRange.end - pendingRange.start).toFixed(1)} s
                              </>
                            ) : (
                              <>New clip from {formatPrecise(words[pending.first].start)}: now click its last word.</>
                            )}
                          </p>
                          <div className="ml-auto flex gap-2">
                            <Button variant="ghost" onClick={() => setPending(null)} size="sm">
                              <X aria-hidden size={16} />
                              Cancel
                            </Button>
                            <Button
                              variant="primary"
                              onClick={addClip}
                              disabled={!pendingRange || adding}
                              size="sm"
                            >
                              <Plus aria-hidden size={16} />
                              {adding ? "Adding…" : "Add manual clip"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </section>
              </>
            )}
          </div>
        </div>
      </div>

      {job.source && (
        <Timeline
          words={cut ? [] : words}
          range={cut ? { start: 0, end: length } : range}
          saved={cut ? { start: 0, end: length } : { start: candidate.start, end: candidate.end }}
          sourceDuration={cut ? length : job.source.metadata.duration}
          cut={cut ? { segments: playback.segments, to: advanced } : undefined}
          plan={preview?.plan ?? null}
          playback={playback}
          timing={timing}
          onTrimDraft={setTrimDraft}
          onTrim={trim}
          onTiming={setTiming}
          scenes={(geometry) => (
            <ScenesTrack
              plan={preview?.plan ?? null}
              geometry={geometry}
              analysed={preview?.analysed ?? true}
              overrides={candidate.layout_overrides}
              selected={scene}
              preparing={preparing === candidate.id}
              onSelect={(i) => setScene((old) => (old === i ? null : i))}
              onPrepare={prepare}
            />
          )}
          onCaption={(at) => {
            setTab("text");
            setCaptionFocus({ at });
            requestAnimationFrame(() => document.getElementById("caption-text-heading")?.scrollIntoView({ block: "nearest" }));
          }}
        />
      )}

      {preview && scene !== null && (
        <SceneLayoutPicker
          plan={preview.plan}
          index={scene}
          clipLayout={candidate.layout}
          overrides={candidate.layout_overrides}
          // Manual copies the Framing that draws what the Scene shows; another Layout has none.
          onChange={(layout) => {
            const layout_overrides = sceneLayoutOverrides(candidate.layout_overrides, preview.plan, scene, layout);
            if (layout_overrides) void onSave({ layout_overrides });
          }}
        />
      )}

      {candidate.origin === "ai" && <Analysis candidate={candidate} />}
    </div>
  );
}

// The editor's sections, as tabs: arrow keys move between them.
function Tabs({ value, onChange }: { value: Tab; onChange: (tab: Tab) => void }) {
  // The thumb slides like Segmented's when a tab is clicked, and jumps when the arrow keys move it.
  // The tabs are as wide as their labels (shared out when there is room), so it is measured on the
  // selected one.
  const [keyed, setKeyed] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const index = TABS.findIndex((tab) => tab.value === value);
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const selected = element.children[index + 1] as HTMLElement | undefined;
      if (selected) setThumb({ left: selected.offsetLeft, width: selected.offsetWidth });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [index]);
  return (
    <div
      ref={list}
      role="tablist"
      aria-label="Edit"
      // Scrolls sideways where even label-wide tabs don't fit.
      className="relative isolate flex gap-1 overflow-x-auto rounded-control bg-fill p-1 [scrollbar-width:none]"
      style={{ "--left": `${thumb?.left ?? 4}px`, "--width": `${thumb?.width ?? 0}px` } as CSSProperties}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        const next = TABS[(index + (event.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length].value;
        setKeyed(true);
        onChange(next);
        document.getElementById(`editor-tab-${next}`)?.focus();
      }}
    >
      <span
        aria-hidden
        className={cx(
          "raised absolute inset-y-1 left-0 -z-10 w-(--width) translate-x-(--left) rounded-[10px]",
          !thumb && "invisible",
          !keyed && "motion-safe:transition-[translate,width] motion-safe:duration-[380ms] motion-safe:ease-spring",
        )}
      />
      {TABS.map((tab) => (
        <button
          key={tab.value}
          id={`editor-tab-${tab.value}`}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          aria-controls={`editor-panel-${tab.value}`}
          tabIndex={value === tab.value ? 0 : -1}
          onClick={() => {
            setKeyed(false);
            onChange(tab.value);
          }}
          className={cx(
            "min-h-9 flex-auto rounded-[10px] px-2 text-sm font-medium whitespace-nowrap motion-safe:transition-colors",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
            value === tab.value ? "text-text" : "text-muted hover:text-text",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// A Clip cut into Segments is trimmed and timed in the Advanced Edit.
function CutNote({ segments, to }: { segments: readonly ClipSegment[]; to: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-fill p-3 text-sm">
      <p className="min-w-0 flex-1 text-pretty">
        {cutNote(segments)}, edited in the Advanced Edit.
      </p>
      <Link to={to} className={buttonClass("secondary", "sm")}>
        <SlidersHorizontal aria-hidden size={16} />
        Edit Advanced
      </Link>
    </div>
  );
}

// How close the preview is to the Clip, and the way to make it closer.
function PreviewNotes({
  wordsFromTranscript,
  unanalysed,
  error,
  preparing,
  onPrepare,
}: {
  wordsFromTranscript: boolean;
  unanalysed: boolean;
  error: string | null;
  preparing: boolean;
  onPrepare: () => void;
}) {
  if (error) return <p className="text-sm text-danger">Couldn't preview: {error}</p>;
  if (!wordsFromTranscript && !unanalysed) return null;
  const notes = [
    wordsFromTranscript && "captions use the episode transcript, which the clip's own transcription may differ from",
    unanalysed && "the clip is framed as one scene until its cuts and faces are found",
  ].filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-waiting-surface p-3 text-sm">
      <p className="min-w-0 flex-1 text-pretty">
        Until it is prepared, {notes.join(", and ")}.
      </p>
      <Button size="sm" onClick={onPrepare} disabled={preparing}>
        <ScanSearch aria-hidden size={16} />
        {preparing ? "Preparing…" : "Prepare clip"}
      </Button>
    </div>
  );
}

// The description to post on each platform: its text, a blank line, then the hashtags.
export function postingCopy(candidate: Candidate): { label: string; body: string; text: string }[] {
  const tags = candidate.hashtags.join(" ");
  const withTags = (body: string) => ({ body, text: [body, tags].filter(Boolean).join("\n\n") });
  return [
    { label: "TikTok", ...withTags(candidate.descriptions.tiktok) },
    { label: "Instagram", ...withTags(candidate.descriptions.instagram) },
    { label: "Shorts", ...withTags(candidate.descriptions.shorts) },
  ];
}

// Why the AI chose it, and its posting copy.
function Analysis({ candidate }: { candidate: Candidate }) {
  const tags = candidate.hashtags.join(" ");
  const copy = postingCopy(candidate).map((item) => ({ ...item, tags: true }));
  return (
    <>
      <section aria-labelledby="why-heading" className="flex flex-col gap-2">
        <h4 id="why-heading" className="font-semibold">
          Why this clip
        </h4>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-y-1.5 [&>dt]:not-first:max-sm:mt-2">
          <dt className="text-muted">Reason</dt>
          <dd className="text-pretty break-words">{candidate.reason}</dd>
          <dt className="text-muted">Retention</dt>
          <dd className="text-pretty break-words">{candidate.retention_notes}</dd>
          <dt className="text-muted">Emotion</dt>
          <dd className="capitalize">{candidate.emotion}</dd>
          <dt className="text-muted">Hook strength</dt>
          <dd className="tabular-nums">{candidate.hook_strength}</dd>
          {candidate.window_score !== null && (
            <>
              <dt className="text-muted">Window score</dt>
              <dd className="tabular-nums">{candidate.window_score}</dd>
            </>
          )}
        </dl>
      </section>

      <section aria-labelledby="copy-heading" className="flex flex-col gap-2">
        <h4 id="copy-heading" className="font-semibold">
          Posting copy
        </h4>
        {/* Like "Why this clip": the label, the copy (with its hashtags under it, as it is pasted),
            and a button copying it all. On a phone the label sits above the copy. */}
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-sm sm:grid-cols-[7rem_minmax(0,1fr)_auto]">
          {[{ label: "Title", text: candidate.title, body: candidate.title, tags: false }, ...copy].map((item) => (
            <div
              key={item.label}
              className="col-span-2 grid grid-cols-subgrid items-start gap-y-0.5 border-t border-border py-2.5 first:border-t-0 first:pt-0 sm:col-span-3"
            >
              <dt className="text-muted">{item.label}</dt>
              <dd className="col-start-1 row-start-2 flex min-w-0 flex-col gap-0.5 select-text sm:col-start-2 sm:row-start-1">
                <span className={cx("text-pretty break-words", item.label === "Title" && "font-medium")}>{item.body || "—"}</span>
                {item.tags && tags && <span className="break-words text-muted">{tags}</span>}
              </dd>
              <dd className="col-start-2 row-span-2 row-start-1 sm:col-start-3 sm:row-span-1">
                <CopyButton text={item.text} label={`Copy ${item.label === "Title" ? "title" : item.label}`} look="icon" />
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
