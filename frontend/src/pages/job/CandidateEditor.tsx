import { AlertTriangle, Plus, X } from "lucide-react";
import { useState } from "react";
import { mediaUrl, type Candidate, type CandidateChange, type JobDetail, type Layout, type Transcript } from "../../api";
import { Button } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { formatPrecise } from "../../format";
import { candidateName } from "./CandidateList";
import { HookEditor } from "./HookEditor";
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
 * One Candidate under review: its preview, the Transcript Picker for its edges and for new clips,
 * its hook, layout and selection, and the AI's reasoning and copy. Every change is saved at once.
 * The click mode and a new clip being chosen carry over to the next Candidate opened.
 */
export function CandidateEditor({
  job,
  transcript,
  candidate,
  index,
  onSave,
  onAdd,
}: {
  job: JobDetail;
  transcript: Transcript;
  candidate: Candidate;
  index: number;
  onSave: (change: CandidateChange) => Promise<boolean>;
  onAdd: (range: { start: number; end: number }) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<Mode>("start");
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
          <h3 className="text-lg font-semibold text-balance">
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

      {job.source && <PreviewPlayer src={mediaUrl(job.id, job.source.video)} start={candidate.start} end={candidate.end} />}

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
                <Button variant="ghost" onClick={() => setPending(null)} className="min-h-10 px-3 text-sm">
                  <X aria-hidden size={16} />
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={addClip}
                  disabled={!pendingRange || adding}
                  className="min-h-10 px-3 text-sm"
                >
                  <Plus aria-hidden size={16} />
                  {adding ? "Adding…" : "Add manual clip"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </section>

      <HookEditor key={candidate.id} value={candidate.hook_text} onSave={(hook_text) => void onSave({ hook_text })} />

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

      {candidate.origin === "ai" && <Analysis candidate={candidate} />}
    </div>
  );
}

// Why the AI chose it, and its posting copy.
function Analysis({ candidate }: { candidate: Candidate }) {
  const tags = candidate.hashtags.join(" ");
  const withTags = (text: string) => [text, tags].filter(Boolean).join("\n\n");
  const copy = [
    { label: "TikTok", text: withTags(candidate.descriptions.tiktok) },
    { label: "Instagram", text: withTags(candidate.descriptions.instagram) },
    { label: "Shorts", text: withTags(candidate.descriptions.shorts) },
  ];
  return (
    <>
      <section aria-labelledby="why-heading" className="flex flex-col gap-2">
        <h4 id="why-heading" className="font-semibold">
          Why this clip
        </h4>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted">Reason</dt>
          <dd>{candidate.reason}</dd>
          <dt className="text-muted">Retention</dt>
          <dd>{candidate.retention_notes}</dd>
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
          <p className="select-text">{candidate.title}</p>
        </div>
        {copy.map(({ label, text }) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-muted">{label}</span>
              <CopyButton text={text} label={`Copy ${label}`} />
            </div>
            <p className="text-sm whitespace-pre-line select-text">{text}</p>
          </div>
        ))}
      </section>
    </>
  );
}
