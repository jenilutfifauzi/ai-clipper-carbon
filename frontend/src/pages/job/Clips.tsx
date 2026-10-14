import { AlertCircle, Clapperboard, Download, Hourglass, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, mediaUrl, type Candidate, type Clip, type JobProgress, type RenderedClip, type StylePreset } from "../../api";
import { Button, buttonClass } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Panel } from "../../components/Panel";
import { ScoreRing } from "../../components/ScoreRing";
import { Skeleton } from "../../components/Skeleton";
import { formatBytes } from "../../format";
import { useReveal } from "../../hooks/useReveal";
import { candidateName } from "./CandidateList";
import { postingCopy } from "./CandidateEditor";

// How many more Clips are drawn each time the end of the grid comes into reach.
const BATCH = 6;

/**
 * The rendered Clips, in their Candidates' order (by score): each with its player, the AI's
 * reasoning, its posting copy and a download. A Clip still rendering, or whose Candidate has changed
 * since it was rendered, says so.
 */
export function Clips({
  jobId,
  clips,
  candidates,
  progress,
  onRender,
}: {
  jobId: string;
  clips: Clip[];
  candidates: Candidate[];
  progress: JobProgress;
  onRender: (candidateIds: string[]) => Promise<void>;
}) {
  const [presets, setPresets] = useState<StylePreset[] | null>(null);
  useEffect(() => {
    if (clips.length > 0) api.listPresets().then(setPresets, () => {});
  }, [clips.length > 0]);
  const { shown, more, sentinelRef } = useReveal(clips.length, BATCH);
  if (clips.length === 0) return null;
  const done = clips.filter((clip) => clip.output).length;
  const waiting = clips.filter((clip) => clip.status === "queued" || clip.status === "rendering").length;
  return (
    <Panel aria-labelledby="clips-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="clips-heading" className="font-semibold">
          Clips
        </h2>
        <p className="text-sm text-muted tabular-nums">
          {done} rendered{waiting > 0 && ` · ${waiting} in the render queue`}
        </p>
      </div>
      <ul className="grid gap-x-5 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
        {clips.slice(0, shown).map((clip) => {
          const index = candidates.findIndex((candidate) => candidate.id === clip.candidate_id);
          return (
            <ClipCard
              key={clip.candidate_id}
              jobId={jobId}
              clip={clip}
              candidate={candidates[index] ?? null}
              presets={presets}
              index={index}
              percent={clip.status === "rendering" ? progress.progress : null}
              onRender={() => onRender([clip.candidate_id])}
            />
          );
        })}
        {more && (
          <li ref={sentinelRef} aria-hidden className="flex min-w-0 flex-col gap-3">
            <Skeleton className="mx-auto aspect-[9/16] w-full max-w-[calc(85svh*9/16)] rounded-[20px]" />
            <Skeleton className="h-4 w-3/4 rounded-full" />
            <Skeleton className="h-3.5 w-1/2 rounded-full" />
          </li>
        )}
      </ul>
    </Panel>
  );
}

/**
 * Whether the Candidate would render differently from its Clip: a different range, hook, layout or
 * edit, or (with the Presets at hand) styles its Preset now resolves differently. A Clip rendered
 * before the editor is compared by range, hook and layout only.
 */
function changedSince(candidate: Candidate, output: RenderedClip, presets: StylePreset[] | null): boolean {
  if (
    candidate.start !== output.start ||
    candidate.end !== output.end ||
    candidate.hook_text !== output.hook_text ||
    candidate.layout !== output.layout
  )
    return true;
  if (output.preset_id === null) return false;
  const edits = ["preset_id", "style_overrides", "word_edits", "hook_start", "hook_secs", "layout_overrides"] as const;
  if (edits.some((field) => !same(candidate[field], output[field]))) return true;
  const preset = presets?.find((p) => p.id === candidate.preset_id) ?? presets?.[0];
  if (!preset || !output.caption_style || !output.hook_style) return false;
  return (
    !same({ ...preset.caption, ...candidate.style_overrides.caption }, output.caption_style) ||
    !same({ ...preset.hook, ...candidate.style_overrides.hook }, output.hook_style)
  );
}

// Deep equality of JSON values, whatever the order of their keys.
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((key) => same((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

function ClipCard({
  jobId,
  clip,
  candidate,
  presets,
  index,
  percent,
  onRender,
}: {
  jobId: string;
  clip: Clip;
  // Null once Selection has replaced it.
  candidate: Candidate | null;
  presets: StylePreset[] | null;
  index: number;
  percent: number | null;
  onRender: () => void;
}) {
  const output = clip.output;
  const name = candidate ? candidateName(candidate, index) : "Clip of a Candidate no longer listed";
  const changed = output && candidate && changedSince(candidate, output, presets);
  const busy = clip.status === "queued" || clip.status === "rendering";

  return (
    <li className="flex min-w-0 flex-col gap-3">
      {/* On a phone held sideways the 9:16 frame would outgrow the screen: cap it to the height. */}
      <div className="mx-auto w-full max-w-[calc(85svh*9/16)]">
        {output ? (
          <video
            controls
            playsInline
            preload="none"
            poster={mediaUrl(jobId, output.poster, output.at)}
            src={mediaUrl(jobId, output.video, output.at)}
            aria-label={`Clip: ${name}`}
            className="aspect-[9/16] w-full rounded-[20px] bg-black object-contain shadow-raised outline-1 -outline-offset-1 outline-white/10"
          />
        ) : (
          <div className="grid aspect-[9/16] w-full place-items-center rounded-[20px] border border-dashed border-border bg-fill p-4 text-center text-sm text-muted">
            {clip.status === "error" ? "Not rendered" : "Not rendered yet"}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-3">
          <h3 className="min-w-0 flex-1 font-semibold tracking-tight text-balance break-words">
            {index >= 0 && <span className="text-muted tabular-nums">#{index + 1} </span>}
            {name}
          </h3>
          {candidate?.predicted_score != null && <ScoreRing score={candidate.predicted_score} size={36} />}
        </div>
        {output && (
          <p className="text-sm text-muted tabular-nums">
            {output.duration.toFixed(1)} s · {formatBytes(output.size_bytes)}
          </p>
        )}
        <RenderState clip={clip} percent={percent} />
        {changed && !busy && (
          <p className="text-sm text-accent-text">Changed since this render: render it again to update it.</p>
        )}
      </div>

      {candidate?.reason && <p className="text-sm text-pretty break-words text-muted">{candidate.reason}</p>}

      <div className="flex flex-wrap gap-2">
        {output && (
          <a
            href={mediaUrl(jobId, output.video, output.at)}
            download={`${fileName(candidate?.title) || `clip-${clip.candidate_id}`}.mp4`}
            className={buttonClass("primary", "sm")}
          >
            <Download aria-hidden size={16} />
            Download
          </a>
        )}
        {candidate && !busy && (output === null || changed || clip.status === "error") && (
          <Button onClick={onRender} size="sm">
            <Clapperboard aria-hidden size={16} />
            {output ? "Render again" : "Try again"}
          </Button>
        )}
      </div>

      {candidate && candidate.origin === "ai" && (
        <div role="group" aria-label="Copy posting text" className="flex flex-wrap gap-2">
          <CopyButton text={candidate.title} label="Title" />
          {postingCopy(candidate).map(({ label, text }) => (
            <CopyButton key={label} text={text} label={label} />
          ))}
        </div>
      )}
    </li>
  );
}

function RenderState({ clip, percent }: { clip: Clip; percent: number | null }) {
  if (clip.status === "queued") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-muted">
        <Hourglass aria-hidden size={14} />
        {clip.output ? "Queued to render again" : "Queued to render"}
      </p>
    );
  }
  if (clip.status === "rendering") {
    return (
      <p className="flex items-center gap-1.5 text-sm text-accent-text">
        <Loader2 aria-hidden size={14} className="motion-safe:animate-spin" />
        Rendering{percent !== null && <span className="tabular-nums">{Math.round(percent)}%</span>}
      </p>
    );
  }
  if (clip.status === "error") {
    return (
      <p className="flex items-start gap-1.5 text-sm text-danger">
        <AlertCircle aria-hidden size={14} className="mt-0.5 shrink-0" />
        <span className="min-w-0 break-words">
          {clip.output ? "Rendering again failed" : "Rendering failed"}: {clip.error}
        </span>
      </p>
    );
  }
  return null;
}

// A title as a file name: without the characters file systems refuse.
function fileName(title: string | undefined): string {
  return (title ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}
