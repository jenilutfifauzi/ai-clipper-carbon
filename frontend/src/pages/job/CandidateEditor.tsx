import { AlertTriangle, Plus, ScanSearch, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  mediaUrl,
  type Candidate,
  type CandidateChange,
  type FontInfo,
  type JobDetail,
  type JobProgress,
  type Layout,
  type Transcript,
} from "../../api";
import { Button } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { loadFonts } from "../../fonts";
import { formatPrecise } from "../../format";
import { candidateName } from "./CandidateList";
import { CaptionTextEditor } from "./editor/CaptionTextEditor";
import { ClipPreview } from "./editor/ClipPreview";
import { Playback } from "./editor/playback";
import { StylePanel, type StyleDraft } from "./editor/StylePanel";
import { usePreviewPlan } from "./editor/usePreviewPlan";
import { HookEditor, type HookTiming } from "./HookEditor";
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

const VIEWS = [
  { value: "clip", label: "Clip" },
  { value: "source", label: "Source" },
] as const;

const LAYOUTS = [
  { value: "auto", label: "Auto" },
  { value: "track", label: "Track" },
  { value: "split", label: "Split" },
  { value: "blur", label: "Blur" },
] as const;

const LAYOUT_HINTS: Record<Layout, string> = {
  auto: "Chosen per scene from the faces in it.",
  track: "A 9:16 crop following the speaker, in every scene.",
  split: "Two stacked panels, left person on top, in every scene.",
  blur: "The wide shot over a blurred background, in every scene.",
};

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
  index,
  progress,
  onSave,
  onAdd,
  onPrepare,
}: {
  job: JobDetail;
  transcript: Transcript;
  candidate: Candidate;
  index: number;
  progress: JobProgress;
  onSave: (change: CandidateChange) => Promise<boolean>;
  onAdd: (range: { start: number; end: number }) => Promise<boolean>;
  // Queues the Candidate's transcription and analysis, for the preview.
  onPrepare: (candidateId: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("start");
  const [view, setView] = useState<"clip" | "source">("clip");
  const [fonts, setFonts] = useState<FontInfo[] | null>(null);
  const [hookDraft, setHookDraft] = useState<string | null>(null);
  const [styleDraft, setStyleDraft] = useState<StyleDraft | null>(null);
  const [timingDraft, setTimingDraft] = useState<HookTiming | null>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const playback = useMemo(() => new Playback(), []);
  playback.setRange(candidate.start, candidate.end);

  useEffect(() => {
    loadFonts().then(setFonts, () => setFonts([]));
  }, []);
  useEffect(() => {
    setHookDraft(null);
    setStyleDraft(null);
    setTimingDraft(null);
  }, [candidate.id]);
  // A preparation asked for here is over once the Job is back in review.
  useEffect(() => {
    if (progress.status !== "rendering") setPreparing(null);
  }, [progress.status]);

  const draft: CandidateChange = {
    hook_text: hookDraft ?? candidate.hook_text,
    layout: candidate.layout,
    preset_id: styleDraft?.preset_id ?? candidate.preset_id,
    style_overrides: styleDraft?.style_overrides ?? candidate.style_overrides,
    word_edits: candidate.word_edits,
    hook_start: timingDraft?.hook_start ?? candidate.hook_start,
    hook_secs: timingDraft?.hook_secs ?? candidate.hook_secs,
  };
  const { preview, error: previewError } = usePreviewPlan(job.id, candidate.id, draft, progress.status);
  const [pending, setPending] = useState<{ first: number; last: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const words = transcript.words;
  const duration = job.source?.metadata.duration ?? Infinity;
  const length = candidate.end - candidate.start;
  const { min_secs, max_secs } = job.options;
  const name = candidateName(candidate, index);

  // The backend snaps an edge to the Word it falls in: send the Word's own start or end.
  function pick(i: number) {
    setNotice(null);
    if (mode === "new") {
      setPending((old) => (old && old.last === null ? { first: old.first, last: i } : { first: i, last: null }));
      return;
    }
    const word = words[i];
    if (mode === "start") {
      if (word.start >= candidate.end) return setNotice("The start must come before the clip's end. Move the end first.");
      void onSave({ start: word.start });
    } else {
      if (word.end <= candidate.start) return setNotice("The end must come after the clip's start. Move the start first.");
      void onSave({ end: Math.min(word.end, duration) });
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
          <Switch checked={candidate.selected} onChange={(selected) => void onSave({ selected })}>
            <span className="text-sm">Render this clip</span>
          </Switch>
        </div>
        <p className="text-sm text-muted tabular-nums">
          {formatPrecise(candidate.start)} – {formatPrecise(candidate.end)} · {length.toFixed(1)} s
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

      {job.source && (
        <section aria-label="Preview" className="flex flex-col gap-3">
          <Segmented legend="Preview" options={VIEWS} value={view} onChange={setView} className="max-w-xs" />
          {view === "clip" ? (
            <ClipPreview
              src={mediaUrl(job.id, job.source.preview ?? job.source.video)}
              preview={preview}
              fonts={fonts}
              playback={playback}
            />
          ) : (
            <PreviewPlayer
              src={mediaUrl(job.id, job.source.preview ?? job.source.video)}
              start={candidate.start}
              end={candidate.end}
            />
          )}
          {view === "clip" && (
            <PreviewNotes
              wordsFromTranscript={preview?.words_source === "transcript" && job.options.captions}
              unanalysed={preview?.analysed === false}
              error={previewError}
              preparing={preparing === candidate.id}
              onPrepare={() => {
                setPreparing(candidate.id);
                onPrepare(candidate.id).catch(() => setPreparing(null));
              }}
            />
          )}
        </section>
      )}

      {preview && job.options.captions && (
        <section aria-labelledby="caption-text-heading" className="flex flex-col gap-3">
          <h4 id="caption-text-heading" className="font-semibold">
            Caption text
          </h4>
          <CaptionTextEditor
            key={candidate.id}
            preview={preview}
            clipStart={candidate.start}
            edits={candidate.word_edits}
            playback={playback}
            onChange={(word_edits) => void onSave({ word_edits })}
          />
        </section>
      )}

      <section aria-labelledby="picker-heading" className="flex flex-col gap-3">
        <h4 id="picker-heading" className="font-semibold">
          Transcript
        </h4>
        <Segmented
          legend="Clicking a word sets"
          options={MODES}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setNotice(null);
            if (value !== "new") setPending((old) => (old && old.last === null ? null : old));
          }}
          className="max-w-sm"
        />
        <p className="text-sm text-muted">{MODE_HINTS[mode]}</p>
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

      <HookEditor
        key={candidate.id}
        value={candidate.hook_text}
        onSave={(hook_text) => void onSave({ hook_text })}
        onDraft={setHookDraft}
        timing={{ hook_start: candidate.hook_start, hook_secs: candidate.hook_secs }}
        duration={length}
        onTimingDraft={setTimingDraft}
        onTimingSave={(timing) => void onSave(timing)}
      />

      <div className="flex flex-col gap-1.5">
        <Segmented
          legend="Layout"
          options={LAYOUTS}
          value={candidate.layout}
          onChange={(layout) => void onSave({ layout })}
          className="max-w-md"
        />
        <p className="text-sm text-muted">{LAYOUT_HINTS[candidate.layout]}</p>
      </div>

      <section aria-labelledby="style-heading" className="flex flex-col gap-3">
        <h4 id="style-heading" className="font-semibold">
          Style
        </h4>
        <StylePanel
          key={candidate.id}
          candidate={candidate}
          fonts={fonts}
          onDraft={setStyleDraft}
          onSave={(change) => void onSave(change)}
        />
      </section>

      {candidate.origin === "ai" && <Analysis candidate={candidate} />}
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
export function postingCopy(candidate: Candidate): { label: string; text: string }[] {
  const tags = candidate.hashtags.join(" ");
  const withTags = (text: string) => [text, tags].filter(Boolean).join("\n\n");
  return [
    { label: "TikTok", text: withTags(candidate.descriptions.tiktok) },
    { label: "Instagram", text: withTags(candidate.descriptions.instagram) },
    { label: "Shorts", text: withTags(candidate.descriptions.shorts) },
  ];
}

// Why the AI chose it, and its posting copy.
function Analysis({ candidate }: { candidate: Candidate }) {
  const copy = postingCopy(candidate);
  return (
    <>
      <section aria-labelledby="why-heading" className="flex flex-col gap-2">
        <h4 id="why-heading" className="font-semibold">
          Why this clip
        </h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
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

      <section aria-labelledby="copy-heading" className="flex flex-col gap-3">
        <h4 id="copy-heading" className="font-semibold">
          Posting copy
        </h4>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted">Title</span>
            <CopyButton text={candidate.title} label="Copy title" />
          </div>
          <p className="break-words select-text">{candidate.title}</p>
        </div>
        {copy.map(({ label, text }) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{label}</span>
              <CopyButton text={text} label={`Copy ${label}`} />
            </div>
            <p className="text-sm break-words whitespace-pre-line text-pretty select-text">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
