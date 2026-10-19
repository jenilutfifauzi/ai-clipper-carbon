import { AlertCircle, Download, Hourglass, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, mediaUrl, type Candidate, type Clip, type ExportPresetList, type JobProgress, type RenderedClip, type StylePreset } from "../../api";
import { buttonClass } from "../../components/Button";
import { CopyButton } from "../../components/CopyButton";
import { Panel } from "../../components/Panel";
import { ScoreRing } from "../../components/ScoreRing";
import { Skeleton } from "../../components/Skeleton";
import { downloadName, formatBytes, timeLeft } from "../../format";
import { useReveal } from "../../hooks/useReveal";
import { candidateName } from "./CandidateList";
import { postingCopy } from "./CandidateEditor";
import { againPreset, settingsLine } from "./exportPresets";
import { RenderButton } from "./RenderButton";
import { SaveAudioButton } from "./SaveAudio";
import { same } from "./editor/merge";
import { overridden } from "./editor/useStyleDraft";

// How many more Clips are drawn each time the end of the grid comes into reach.
const BATCH = 6;

/**
 * The rendered Clips, in their Candidates' order (by score): each with its player, the AI's
 * reasoning, what it was made with, its posting copy and a download. A Clip still rendering, or
 * whose Candidate has changed since it was rendered, says so (its Export Settings never count).
 */
export function Clips({
  jobId,
  clips,
  candidates,
  progress,
  exportPresets,
  onRender,
}: {
  jobId: string;
  clips: Clip[];
  candidates: Candidate[];
  progress: JobProgress;
  exportPresets: ExportPresetList | null;
  onRender: (candidateIds: string[], exportPresetId?: string) => Promise<void>;
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
              exportPresets={exportPresets}
              index={index}
              percent={clip.status === "rendering" ? progress.progress : null}
              onRender={(exportPresetId) => onRender([clip.candidate_id], exportPresetId)}
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
 * Whether the Candidate would render differently from its Clip: another Revision of it (any edit),
 * or (with the Presets at hand) styles its Preset now resolves differently. A Clip rendered before
 * Revisions is compared field by field instead, and one rendered before the editor by range, hook
 * and layout only.
 */
function changedSince(candidate: Candidate, output: RenderedClip, presets: StylePreset[] | null): boolean {
  if (output.revision != null) return candidate.revision !== output.revision || restyled(candidate, output, presets);
  if (
    candidate.start !== output.start ||
    candidate.end !== output.end ||
    candidate.hook_text !== output.hook_text ||
    candidate.hook_kicker !== output.hook_kicker ||
    candidate.layout !== output.layout
  )
    return true;
  if (output.preset_id === null) return false;
  const edits = ["preset_id", "style_overrides", "word_edits", "hook_start", "hook_secs", "layout_overrides", "text_layers", "shapes", "music", "source_volume", "segments", "overlays", "transitions"] as const;
  if (edits.some((field) => !same(candidate[field], output[field]))) return true;
  return restyled(candidate, output, presets);
}

// Whether the Candidate's Preset (edited since, say) now resolves to other styles than its Clip's.
function restyled(candidate: Candidate, output: RenderedClip, presets: StylePreset[] | null): boolean {
  const preset = presets?.find((p) => p.id === candidate.preset_id) ?? presets?.[0];
  if (!preset || !output.caption_style || !output.hook_style) return false;
  // A Clip rendered before Watermarks had none.
  const watermark = overridden(preset.watermark, candidate.style_overrides.watermark);
  return (
    !same(overridden(preset.caption, candidate.style_overrides.caption), output.caption_style) ||
    !same(overridden(preset.hook, candidate.style_overrides.hook), output.hook_style) ||
    (output.watermark_style ? !same(watermark, output.watermark_style) : watermark.kind !== "none")
  );
}

function ClipCard({
  jobId,
  clip,
  candidate,
  presets,
  exportPresets,
  index,
  percent,
  onRender,
}: {
  jobId: string;
  clip: Clip;
  // Null once Selection has replaced it.
  candidate: Candidate | null;
  presets: StylePreset[] | null;
  exportPresets: ExportPresetList | null;
  index: number;
  percent: number | null;
  onRender: (exportPresetId?: string) => void;
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
        {output && (
          <p className="text-sm text-muted tabular-nums">
            {settingsLine(output, exportPresets)}
            {output.bitrate_fallback && <span className="text-accent-text"> · CBR fell back to VBR</span>}
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
            download={downloadName(candidate?.title, clip.candidate_id, "mp4")}
            className={buttonClass("primary", "sm")}
          >
            <Download aria-hidden size={16} />
            Download
          </a>
        )}
        {/* Rendered again with its Preset as it is now; another can be picked from its menu. */}
        {candidate && !busy && (
          <RenderButton
            label={output ? "Render again" : "Try again"}
            presets={exportPresets}
            picked={exportPresets && againPreset(exportPresets, clip)}
            onRender={onRender}
          />
        )}
        {/* The saved edit's sound alone, at its Clip's Preset's loudness. */}
        {candidate && (
          <SaveAudioButton jobId={jobId} candidate={candidate} exportPresetId={exportPresets && againPreset(exportPresets, clip)} />
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
  // Worked out as progress comes in, not on every render in between.
  const left = useMemo(
    () => (clip.started_at ? timeLeft(clip.started_at, percent, Date.now()) : null),
    [clip.started_at, percent],
  );
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
        {left && <span className="tabular-nums text-muted">· {left}</span>}
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
