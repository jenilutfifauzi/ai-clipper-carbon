import { Hand, PenLine } from "lucide-react";
import type { Candidate } from "../../api";
import { ScoreRing } from "../../components/ScoreRing";
import { cx, formatClock } from "../../format";

// The ranked Candidates, the AI's first and the manual ones after. Choosing a row opens it in the
// editor; its checkbox selects it for rendering.
export function CandidateList({
  candidates,
  activeId,
  onActivate,
  onSelect,
}: {
  candidates: Candidate[];
  activeId: string | null;
  onActivate: (id: string) => void;
  onSelect: (id: string, selected: boolean) => void;
}) {
  if (candidates.length === 0) {
    return <p className="text-muted">Selection found no Candidates in this episode. Add one from the transcript.</p>;
  }
  return (
    <ol className="-mx-2 flex flex-col gap-1">
      {candidates.map((candidate, i) => {
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
              className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-control px-2 py-2.5 text-left"
            >
              <Score candidate={candidate} />
              <span className="font-medium text-pretty">
                <span className="sr-only">#{i + 1} </span>
                {name}
              </span>
              <span className="col-start-2 text-sm text-muted tabular-nums">
                {formatClock(candidate.start)}–{formatClock(candidate.end)} · {Math.round(candidate.end - candidate.start)} s
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
                  {candidate.emotion && " · "}hook {candidate.hook_strength}
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
    </ol>
  );
}

export function candidateName(candidate: Candidate, index: number): string {
  return candidate.title || (candidate.origin === "manual" ? `Manual clip ${formatClock(candidate.start)}` : `Candidate ${index + 1}`);
}

function Score({ candidate }: { candidate: Candidate }) {
  if (candidate.predicted_score === null) {
    return (
      <span className="row-span-3 grid size-10 place-items-center rounded-full bg-fill text-muted" title="Added by hand: no AI score">
        <Hand aria-hidden size={17} />
        <span className="sr-only">Manual,</span>
      </span>
    );
  }
  return <ScoreRing score={candidate.predicted_score} className="row-span-3" />;
}
