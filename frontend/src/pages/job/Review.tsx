import { AlertCircle, ArrowLeft, Check, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  api,
  staleCandidate,
  type Candidate,
  type CandidateChange,
  type Clip,
  type ExportPresetList,
  type JobDetail,
  type JobProgress,
  type SavedBy,
} from "../../api";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { CandidateEditor } from "./CandidateEditor";
import { CandidateList } from "./CandidateList";
import { Clips } from "./Clips";
import { ChangeNotice, type Notice } from "./editor/ChangeNotice";
import { collidedParts, fieldsOf, mergeEdits, type Collision } from "./editor/merge";
import { entryToRestore } from "./editor/RevisionHistory";
import { changedText, useCandidateEvents } from "./editor/useCandidateEvents";
import { pickedPreset } from "./exportPresets";
import { RenderButton } from "./RenderButton";

/**
 * Review of a Job's Candidates: the ranked list beside the open Candidate's editor, then the
 * rendered Clips. Each change is saved as it is made, also while Clips render; the open Candidate
 * is kept in the URL (?candidate=…), so a reload comes back to it.
 */
export function Review({
  job,
  clips,
  progress,
  exportPresets,
  pickedExport,
  onPickExport,
  onRender,
  onPrepare,
}: {
  job: JobDetail;
  clips: Clip[];
  progress: JobProgress;
  // The Export Presets (null until loaded), and the one picked for the page's session (null for the default).
  exportPresets: ExportPresetList | null;
  pickedExport: string | null;
  onPickExport: (exportPresetId: string) => void;
  // Queues Clips of these Candidates, or of the selected ones, with an Export Preset (else the default).
  onRender: (candidateIds?: string[], exportPresetId?: string) => Promise<void>;
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
  // Each Candidate as last saved here or taken from elsewhere: the Revision its next save is made
  // from, and what the edits made here meanwhile are merged from (ADR 0003). Its saves are sent one
  // after another.
  const server = useRef(new Map((job.candidates ?? []).map((candidate) => [candidate.id, candidate])));
  const sending = useRef(new Map<string, Promise<unknown>>());
  // The latest Revision of each Candidate saved elsewhere: a save made before it is merged onto it,
  // while one made after only the saves here had moved it on is sent as it is.
  const elsewhere = useRef(new Map<string, number>());
  // A change from elsewhere that came while a save of it was under way: told once that is answered.
  const untold = useRef(new Map<string, { source: SavedBy; parts: string[]; revision: number }>());
  // Kept in step with other editors (ADR 0003): how many times each Candidate was taken as saved
  // elsewhere, which starts its editor's drafts again from it.
  const [synced, setSynced] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const closeNotice = useCallback(() => setNotice(null), []);
  const [deleted, setDeleted] = useState(false);

  const wanted = params.get("candidate");
  const index = Math.max(0, candidates.findIndex((candidate) => candidate.id === wanted));
  const active = candidates[index] ?? null;
  const selected = candidates.filter((candidate) => candidate.selected).length;

  // A Candidate saved elsewhere is taken at once, unless a save of it here is still unanswered: that
  // save then meets the newer Revision.
  function fromElsewhere(next: Candidate, source: SavedBy, parts: string[]) {
    const known = server.current.get(next.id)?.revision;
    if (known === undefined) {
      // Added elsewhere.
      server.current.set(next.id, next);
      setCandidates((old) => [...old, next]);
      return;
    }
    if (next.revision <= known) return;
    elsewhere.current.set(next.id, next.revision);
    if ((inFlight.current.get(next.id) ?? 0) > 0) {
      // Its saves under way are merged onto it; their answer shows it, and then it is told.
      server.current.set(next.id, next);
      untold.current.set(next.id, { source, parts, revision: next.revision });
      return;
    }
    taken(next);
    tell(next.id, source, parts, next.revision);
  }

  // The notice of a change from elsewhere to the open Candidate, whose Restore brings back what it
  // replaced (kept in the Revision History).
  function tell(id: string, source: SavedBy, parts: string[], revision: number) {
    if (id !== active?.id) return;
    setNotice({ id: Date.now(), text: changedText(source, parts, "clip-editor"), action: restoreButton(id, "before", revision) });
  }

  // Shows the Candidate as saved, and starts its editor's drafts again from it.
  function taken(next: Candidate) {
    server.current.set(next.id, next);
    replaceCandidate(next.id, () => next);
    setSynced((old) => ({ ...old, [next.id]: (old[next.id] ?? 0) + 1 }));
  }

  // Saves the Candidate as it was at Revision `entry` of its Revision History, once its saves under
  // way are answered; answers why it couldn't, or null.
  async function restore(id: string, entry: number): Promise<string | null> {
    await sending.current.get(id);
    try {
      taken(await api.restoreRevision(job.id, id, entry, server.current.get(id)?.revision ?? 1, "clip-editor"));
      setError(null);
      return null;
    } catch (reason) {
      return staleCandidate(reason) ? "This clip changed meanwhile (another tab or the agent): look again, then restore." : (reason as Error).message;
    }
  }

  // A notice's Restore: of the state before Revision `revision` came in, or of theirs from it on.
  function restoreButton(id: string, which: "before" | "theirs", revision: number) {
    async function click() {
      const entry = await entryToRestore(job.id, id, which, revision).catch(() => null);
      const failed = entry === null ? "That version isn't in the Revision History." : await restore(id, entry);
      setNotice({ id: Date.now(), text: failed ?? "Restored the clip as it was" });
    }
    return (
      <Button size="xs" onClick={() => void click()}>
        Restore
      </Button>
    );
  }

  function removed(id: string) {
    server.current.delete(id);
    setCandidates((old) => old.filter((candidate) => candidate.id !== id));
    if (id === active?.id) setNotice({ id: Date.now(), text: "This clip was removed elsewhere" });
  }

  const { lost } = useCandidateEvents(job.id, {
    onReady: (stored) => {
      for (const candidate of stored) fromElsewhere(candidate, "unknown", []);
      const ids = new Set(stored.map((candidate) => candidate.id));
      for (const id of [...server.current.keys()]) if (!ids.has(id)) removed(id);
    },
    onCandidate: (event) => fromElsewhere(event.candidate, event.source, event.parts),
    onRemoved: removed,
    onDeleted: () => setDeleted(true),
  });

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

  // Sends `change`, made from `base`: merged onto the Candidate as it is now if it has moved on (mine
  // winning where both changed the same thing), and once more onto the one a refusal carries.
  async function sendMerged(
    id: string,
    change: CandidateChange,
    base: Candidate | undefined,
    retried = false,
  ): Promise<{ answer: Candidate; collisions: Collision[]; theirs: number | null }> {
    // Choosing a Candidate for rendering isn't an edit: it is saved whatever changed meanwhile.
    if (Object.keys(change).every((key) => key === "selected")) {
      return { answer: await api.updateCandidate(job.id, id, change, "clip-editor"), collisions: [], theirs: null };
    }
    const now = server.current.get(id);
    // Saved elsewhere since it was made: merged onto that.
    const theirs = base && (elsewhere.current.get(id) ?? 0) > base.revision ? now : undefined;
    let body = change;
    let collisions: Collision[] = [];
    if (base && theirs) ({ merged: body, collisions } = mergeEdits(fieldsOf(base, change), change, fieldsOf(theirs, change)));
    try {
      const answer = await api.updateCandidate(job.id, id, { ...body, revision: now?.revision }, "clip-editor");
      return { answer, collisions, theirs: theirs?.revision ?? null };
    } catch (reason) {
      const latest = staleCandidate(reason);
      if (!latest || retried) throw reason;
      server.current.set(id, latest);
      elsewhere.current.set(id, latest.revision);
      return sendMerged(id, change, base, true);
    }
  }

  async function save(id: string, change: CandidateChange): Promise<boolean> {
    // Shown at once, except the bounds: the backend snaps them to Words.
    const { start: _start, end: _end, ...shown } = change;
    replaceCandidate(id, (candidate) => ({ ...candidate, ...shown }));
    inFlight.current.set(id, (inFlight.current.get(id) ?? 0) + 1);
    setSaving((n) => n + 1);
    setError(null);
    // What it was made from: merged onto the newer Revision if one is saved before it is sent.
    const base = server.current.get(id);
    const send = (sending.current.get(id) ?? Promise.resolve()).then(() => sendMerged(id, change, base));
    sending.current.set(id, send.catch(() => {}));
    try {
      const { answer, collisions, theirs } = await send;
      server.current.set(id, answer);
      if (inFlight.current.get(id) === 1) replaceCandidate(id, () => answer);
      const told = untold.current.get(id);
      untold.current.delete(id);
      if (collisions.length && theirs && id === active?.id) {
        setNotice({
          id: Date.now(),
          text: `Your changes to ${collidedParts(collisions)} replaced a change made elsewhere`,
          action: restoreButton(id, "theirs", theirs),
        });
      } else if (told) {
        tell(id, told.source, told.parts, told.revision);
      }
      setSaved(true);
      return true;
    } catch (reason) {
      const latest = staleCandidate(reason) ?? server.current.get(id);
      setError(
        staleCandidate(reason)
          ? "Not saved: this clip kept changing elsewhere (another tab or the agent). Showing it as it is now."
          : `Not saved: ${(reason as Error).message}. Showing the clip as it is now.`,
      );
      if (latest) taken(latest);
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
      server.current.set(added.id, added);
      setCandidates((old) => [...old, added]);
      activate(added.id);
      setSaved(true);
      return true;
    } catch (reason) {
      setError(`Not added: ${(reason as Error).message}`);
      return false;
    }
  }

  async function render(candidateIds?: string[], exportPresetId?: string) {
    setQueueing(true);
    setError(null);
    try {
      await onRender(candidateIds, exportPresetId);
    } catch (reason) {
      setError(`Not queued: ${(reason as Error).message}`);
    } finally {
      setQueueing(false);
    }
  }

  if (deleted) {
    return (
      <Panel className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">This Job was deleted</h2>
        <p className="text-muted">It was deleted in another tab, so there is nothing left to edit.</p>
        <Link to="/" className="inline-flex min-h-11 items-center gap-1.5 self-start text-accent-text hover:underline">
          <ArrowLeft aria-hidden size={16} />
          All Jobs
        </Link>
      </Panel>
    );
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
              <RenderButton
                label="Render selected"
                variant="primary"
                presets={exportPresets}
                picked={exportPresets && pickedPreset(exportPresets, pickedExport)}
                onRender={(exportPresetId) => {
                  if (exportPresetId) onPickExport(exportPresetId);
                  void render(undefined, exportPresetId);
                }}
                disabled={selected === 0 || queueing}
              />
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
            {lost ? (
              <>
                <Loader2 aria-hidden size={15} className="motion-safe:animate-spin" />
                Reconnecting…
              </>
            ) : saving > 0 ? (
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
              synced={synced[active.id] ?? 0}
              onRestore={(entry) => restore(active.id, entry)}
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
      <Clips
        jobId={job.id}
        clips={clips}
        candidates={candidates}
        progress={progress}
        exportPresets={exportPresets}
        onRender={(candidateIds, exportPresetId) => render(candidateIds, exportPresetId)}
      />
      <ChangeNotice notice={notice} onClose={closeNotice} />
    </div>
  );
}
