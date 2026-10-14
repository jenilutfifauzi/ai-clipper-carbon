import { Film, Hand, PenLine } from "lucide-react";
import { useState } from "react";
import { candidateThumbnailUrl, type Candidate } from "../../api";
import { ScoreRing } from "../../components/ScoreRing";
import { Skeleton } from "../../components/Skeleton";
import { cx, formatClock } from "../../format";
import { useReveal } from "../../hooks/useReveal";

// How many more Candidates are drawn each time the end of the list comes into reach.
const BATCH = 12;

// The ranked Candidates, the AI's first and the manual ones after, each with a still of where it
// starts. Choosing a row opens it in the editor; its checkbox selects it for rendering. They're
// drawn a batch at a time as the list is scrolled, always down to the open one.
export function CandidateList({
  jobId,
  candidates,
  activeId,
  onActivate,
  onSelect,
}: {
  jobId: string;
  candidates: Candidate[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onSelect: (id: string, selected: boolean) => void;
}) {
  const activeIndex = candidates.findIndex((candidate) => candidate.id === activeId);
  const { shown, more, sentinelRef } = useReveal(candidates.length, BATCH, activeIndex + 1);
  if (candidates.length === 0) {
    return <p className="text-muted">Selection found no Candidates in this episode. Add one from the transcript.</p>;
  }
  return (
    <ol className="@container -mx-2 flex flex-col gap-1">
      {candidates.slice(0, shown).map((candidate, i) => {
        const active = candidate.id === activeId;
        const name = candidateName(candidate, i);
        return (
          <li
            key={candidate.id}
            className={cx(
              "relative grid grid-cols-[minmax(0,1fr)_auto] items-start rounded-control motion-safe:transition-colors",
              active ? "raised ring-1 ring-accent/70" : "hover:bg-fill",
            )}
          >
            <button
              type="button"
              onClick={() => onActivate(candidate.id)}
              aria-current={active ? "true" : undefined}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-control p-2 text-left"
            >
              <Thumbnail jobId={jobId} candidate={candidate} />
              <span className="font-medium text-pretty">
                <span className="sr-only">#{i + 1} </span>
                {name}
              </span>
              <span className="col-start-2 text-sm text-muted tabular-nums">
                {formatClock(candidate.start)}–{formatClock(candidate.end)}
                <span className="sr-only">, {Math.round(candidate.end - candidate.start)} seconds</span>
                {candidate.edited && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 align-[-2px]" title="Edited">
                    <PenLine aria-hidden size={13} />
                    <span className="sr-only">, edited</span>
                  </span>
                )}
              </span>
              {candidate.origin === "ai" && (
                <span className="col-start-2 text-sm text-muted">
                  {candidate.emotion && <span className="capitalize">{candidate.emotion}</span>}
                  {candidate.emotion && " · "}
                  <span className="whitespace-nowrap">hook {candidate.hook_strength}</span>
                </span>
              )}
            </button>
            <label className="grid size-11 cursor-pointer place-items-center self-center">
              <input
                type="checkbox"
                checked={candidate.selected}
                onChange={(event) => onSelect(candidate.id, event.target.checked)}
                aria-label={`Select ${name} for rendering`}
                className="size-5 cursor-pointer"
              />
            </label>
          </li>
        );
      })}
      {more && (
        <li ref={sentinelRef} aria-hidden className="flex flex-col gap-1">
          {[0, 1].map((row) => (
            <span key={row} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 p-2">
              <Skeleton className="aspect-video w-20 rounded-[calc(var(--radius-control)_-_6px)] @sm:w-24 @md:w-28" />
              <span className="flex flex-col gap-2">
                <Skeleton className="h-4 w-3/4 rounded-full" />
                <Skeleton className="h-3.5 w-1/2 rounded-full" />
              </span>
              <Skeleton className="mx-3 size-5 rounded-[5px]" />
            </span>
          ))}
        </li>
      )}
    </ol>
  );
}

export function candidateName(candidate: Candidate, index: number): string {
  return candidate.title || (candidate.origin === "manual" ? `Manual clip ${formatClock(candidate.start)}` : `Candidate ${index + 1}`);
}

// A 16:9 still with the score in its corner, on a scrim so it reads over any frame, and the Clip's
// length in the other; a film icon while there's no still.
function Thumbnail({ jobId, candidate }: { jobId: string; candidate: Candidate }) {
  const src = candidateThumbnailUrl(jobId, candidate);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span className="relative row-span-3 aspect-video w-20 shrink-0 overflow-hidden rounded-[calc(var(--radius-control)_-_6px)] bg-fill outline-1 -outline-offset-1 outline-border @sm:w-24 @md:w-28">
      {failed === src ? (
        <Film aria-hidden size={18} className="absolute inset-0 m-auto text-muted" />
      ) : (
        <img
          src={src}
          alt=""
          width={320}
          height={180}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
          className={cx("size-full object-cover motion-safe:transition-opacity motion-safe:duration-200", loaded === src ? "opacity-100" : "opacity-0")}
        />
      )}
      <span className="absolute top-1 left-1 grid place-items-center rounded-full bg-black/65 text-white backdrop-blur-sm">
        {candidate.predicted_score === null ? (
          <span className="grid size-6 place-items-center" title="Added by hand: no AI score">
            <Hand aria-hidden size={13} />
            <span className="sr-only">Manual,</span>
          </span>
        ) : (
          <ScoreRing score={candidate.predicted_score} size={24} className="[&_circle:first-child]:stroke-white/25 [&>span]:text-[10px]" />
        )}
      </span>
      <span aria-hidden className="pointer-events-none absolute right-1 bottom-1 rounded-[4px] bg-black/70 px-1 text-xs leading-4 font-medium text-white tabular-nums select-none">
        {formatClock(Math.round(candidate.end - candidate.start))}
      </span>
    </span>
  );
}
