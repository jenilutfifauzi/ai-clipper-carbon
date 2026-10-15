import { AlertCircle, Check, Clapperboard, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, staleCandidate, type Candidate, type CandidateChange, type Clip, type JobDetail, type JobProgress } from "../../api";
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
  onPrepare,
}: {
  job: JobDetail;
  clips: Clip[];
  progress: JobProgress;
  // Queues Clips of these Candidates, or of the selected ones.
  onRender: (candidateIds?: string[]) => Promise<void>;
  // Queues a Candidate's transcription and analysis, for its preview.
  onPrepare: (candidateId: string) => Promise<void>;
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
  // Each Candidate's Revision as last saved or loaded, which its next save is made from; and its
  // saves, sent one after another so that each is made from the Revision the one before made.
  const revisions = useRef(new Map((job.candidates ?? []).map((candidate) => [candidate.id, candidate.revision])));
  const sending = useRef(new Map<string, Promise<unknown>>());
  // How many of each Candidate's saves were refused for a stale Revision: a save queued before a
  // refusal was made from what was shown then, so it isn't sent after it.
  const refusals = useRef(new Map<string, number>());

  const wanted = params.get("candidate");
  const index = Math.max(0, candidates.findIndex((candidate) => candidate.id === wanted));
  const active = candidates[index] ?? null;
  const selected = candidates.filter((candidate) => candidate.selected).length;

  function activate(id: string) {
    setParams({ candidate: id }, { replace: true });
  }

  // Below the two-column width the editor sits under the list: bring it into view.
  function openFromList(id: string) {
    activate(id);
    if (!window.matchMedia("(max-width: 63.999rem)").matches) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() =>
      document.getElementById("candidate-editor")?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" }),
    );
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
    // Choosing a Candidate for rendering isn't an edit: it is saved whatever changed meanwhile.
    const choosing = Object.keys(change).every((key) => key === "selected");
    const refused = refusals.current.get(id) ?? 0;
    const send = (sending.current.get(id) ?? Promise.resolve()).then(() => {
      if (!choosing && (refusals.current.get(id) ?? 0) !== refused) return null;
      return api.updateCandidate(job.id, id, choosing ? change : { ...change, revision: revisions.current.get(id) }, "clip-editor");
    });
    sending.current.set(id, send.catch(() => {}));
    try {
      const answer = await send;
      // Made before a refusal: dropped, as the refusal's message says.
      if (!answer) return false;
      revisions.current.set(id, answer.revision);
      if (inFlight.current.get(id) === 1) replaceCandidate(id, () => answer);
      setSaved(true);
      return true;
    } catch (reason) {
      const latest = staleCandidate(reason);
      if (latest) {
        // Changed elsewhere since it was loaded: show it as it is now, and edit on from there.
        setError("Not saved: changed elsewhere (another tab or the agent). Showing the clip as it is now.");
        refusals.current.set(id, refused + 1);
        revisions.current.set(id, latest.revision);
        replaceCandidate(id, () => latest);
        return false;
      }
      setError(`Not saved: ${(reason as Error).message}`);
      // Show what is stored instead.
      api.getJob(job.id).then((stored) => {
        if (!stored.candidates) return;
        setCandidates(stored.candidates);
        for (const candidate of stored.candidates) revisions.current.set(candidate.id, candidate.revision);
      }, () => {});
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
      revisions.current.set(added.id, added.revision);
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
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
        <Panel
          aria-labelledby="candidates-heading"
          className="lg:sticky lg:top-4 lg:max-h-[calc(100dvh-2rem)] lg:overflow-y-auto lg:overscroll-contain"
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
                size="sm"
              >
                <Clapperboard aria-hidden size={16} />
                Render selected
              </Button>
            </div>
          </div>
          <CandidateList
            jobId={job.id}
            candidates={candidates}
            activeId={active?.id ?? null}
            onActivate={openFromList}
            onSelect={(id, value) => void save(id, { selected: value })}
          />
        </Panel>

        <Panel id="candidate-editor" aria-label="Candidate" className="flex scroll-mt-4 flex-col gap-4">
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
              progress={progress}
              onSave={(change) => save(active.id, change)}
              onAdd={add}
              onPrepare={onPrepare}
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
