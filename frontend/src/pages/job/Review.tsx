import { AlertCircle, Check, Clapperboard, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, type Candidate, type CandidateChange, type Clip, type JobDetail, type JobProgress } from "../../api";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { CandidateEditor } from "./CandidateEditor";
import { CandidateList } from "./CandidateList";
import { Clips } from "./Clips";

/**
 * Review of a Job's Candidates: the ranked list beside the open Candidate's editor, then the
 * rendered Clips. Each change is saved as it is made, also while Clips render; the open Candidate
 * is kept in the URL (?candidate=…), so a reload comes back to it.
 */
export function Review({
  job,
  clips,
  progress,
  onRender,
}: {
  job: JobDetail;
  clips: Clip[];
  progress: JobProgress;
  // Queues Clips of these Candidates, or of the selected ones.
  onRender: (candidateIds?: string[]) => Promise<void>;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>(job.candidates ?? []);
  const [params, setParams] = useSearchParams();
  const [saving, setSaving] = useState(0);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  // Saves still on their way, per Candidate: only the last one's answer is shown, so an earlier
  // answer never undoes a change made since.
  const inFlight = useRef(new Map<string, number>());

  const wanted = params.get("candidate");
  const index = Math.max(0, candidates.findIndex((candidate) => candidate.id === wanted));
  const active = candidates[index] ?? null;
  const selected = candidates.filter((candidate) => candidate.selected).length;

  function activate(id: string) {
    setParams({ candidate: id }, { replace: true });
  }

  function replaceCandidate(id: string, change: (candidate: Candidate) => Candidate) {
    setCandidates((old) => old.map((candidate) => (candidate.id === id ? change(candidate) : candidate)));
  }

  async function save(id: string, change: CandidateChange): Promise<boolean> {
    // Shown at once, except the bounds: the backend snaps them to Words.
    const { start: _start, end: _end, ...shown } = change;
    replaceCandidate(id, (candidate) => ({ ...candidate, ...shown }));
    inFlight.current.set(id, (inFlight.current.get(id) ?? 0) + 1);
    setSaving((n) => n + 1);
    setError(null);
    try {
      const answer = await api.updateCandidate(job.id, id, change);
      if (inFlight.current.get(id) === 1) replaceCandidate(id, () => answer);
      setSaved(true);
      return true;
    } catch (reason) {
      setError(`Not saved: ${(reason as Error).message}`);
      // Show what is stored instead.
      api.getJob(job.id).then((stored) => stored.candidates && setCandidates(stored.candidates), () => {});
      return false;
    } finally {
      inFlight.current.set(id, (inFlight.current.get(id) ?? 1) - 1);
      setSaving((n) => n - 1);
    }
  }

  async function add(range: { start: number; end: number }): Promise<boolean> {
    setError(null);
    try {
      const added = await api.addCandidate(job.id, range);
      setCandidates((old) => [...old, added]);
      activate(added.id);
      setSaved(true);
      return true;
    } catch (reason) {
      setError(`Not added: ${(reason as Error).message}`);
      return false;
    }
  }

  async function render(candidateIds?: string[]) {
    setQueueing(true);
    setError(null);
    try {
      await onRender(candidateIds);
    } catch (reason) {
      setError(`Not queued: ${(reason as Error).message}`);
    } finally {
      setQueueing(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <Panel
          aria-labelledby="candidates-heading"
          className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto"
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h2 id="candidates-heading" className="font-semibold">
              Candidates
            </h2>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted tabular-nums">{selected} selected</span>
              <Button
                variant="primary"
                onClick={() => void render()}
                disabled={selected === 0 || queueing}
                className="min-h-10 px-3 text-sm"
              >
                <Clapperboard aria-hidden size={16} />
                Render selected
              </Button>
            </div>
          </div>
          <CandidateList
            candidates={candidates}
            activeId={active?.id ?? null}
            onActivate={activate}
            onSelect={(id, value) => void save(id, { selected: value })}
          />
        </Panel>

        <Panel aria-label="Candidate" className="flex flex-col gap-4">
          <div aria-live="polite" className="flex min-h-5 items-center gap-1.5 text-sm text-muted">
            {saving > 0 ? (
              <>
                <Loader2 aria-hidden size={15} className="motion-safe:animate-spin" />
                Saving…
              </>
            ) : (
              saved &&
              !error && (
                <>
                  <Check aria-hidden size={15} className="text-success" />
                  All changes saved
                </>
              )
            )}
          </div>
          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-control bg-danger-surface p-3 text-sm text-danger">
              <AlertCircle aria-hidden size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
          {active && job.transcript ? (
            <CandidateEditor
              job={job}
              transcript={job.transcript}
              candidate={active}
              index={index}
              onSave={(change) => save(active.id, change)}
              onAdd={add}
            />
          ) : (
            <p className="text-muted">Nothing to review yet.</p>
          )}
        </Panel>
      </div>
      <Clips jobId={job.id} clips={clips} candidates={candidates} progress={progress} onRender={render} />
    </div>
  );
}
