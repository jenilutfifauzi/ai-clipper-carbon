import type { Candidate } from "../../api";
import { formatClock } from "../../format";

// The ranked Candidates, read-only. The Review UI (preview, Transcript Picker, edits) replaces this.
export function CandidateList({ candidates }: { candidates: Candidate[] }) {
  if (candidates.length === 0) {
    return <p className="text-muted">Selection found no Candidates in this episode.</p>;
  }
  return (
    <ol className="-mx-2 flex flex-col">
      {candidates.map((candidate, i) => (
        <li
          key={candidate.id}
          className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 border-t border-border px-2 py-3 first:border-t-0"
        >
          <span className="text-muted tabular-nums">#{i + 1}</span>
          <p className="font-medium">{candidate.title}</p>
          <span className="text-right font-semibold text-accent-text tabular-nums" title="Predicted score">
            {candidate.predicted_score}
            <span className="sr-only"> out of 100</span>
          </span>
          <p className="col-start-2 text-sm text-muted tabular-nums">
            {formatClock(candidate.start)}–{formatClock(candidate.end)} · {Math.round(candidate.end - candidate.start)} s
          </p>
        </li>
      ))}
    </ol>
  );
}
