import { Info, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, NO_TEMPLATE, type AppliedTemplate, type Candidate, type TemplateInfo } from "../../api";
import { Button } from "../../components/Button";
import { Select } from "../../components/Select";
import { cx, formatClock } from "../../format";
import { applyToTicked, firstPick, pickChoices, ticked, ticksOf } from "./applyTemplate";
import { candidateName } from "./CandidateList";

// How long the ticks and pick must rest before the dry run is asked for again.
const DRY_RUN_MS = 250;

/**
 * Apply Template on the Review page (.scratch/templates/issues/07): a Template, or "No Template",
 * and the Job's Candidates as a checklist, those selected for rendering ticked. Each ticked one shows
 * what applying it would tell (a dry run); Apply sends one request for all of them, all changed or
 * none. The cards then refresh from the Job's events.
 */
export function ApplyTemplateDialog({
  open,
  jobId,
  candidates,
  onClose,
  onApplied,
}: {
  open: boolean;
  jobId: string;
  candidates: Candidate[];
  onClose: () => void;
  // Told what was applied (its name, or null for No Template) and what it made of each Candidate.
  onApplied: (name: string | null, applied: AppliedTemplate[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null);
  const [pick, setPick] = useState(NO_TEMPLATE);
  const [ticks, setTicks] = useState(() => ticksOf(candidates));
  const [preview, setPreview] = useState<Record<string, string[]>>({});
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Each opening starts from the Candidates selected now and the default Template.
  useEffect(() => {
    if (!open) return;
    setTicks(ticksOf(candidates));
    setError(null);
    setPreview({});
    let current = true;
    api.listTemplates().then(
      (listed) => {
        if (!current) return;
        setTemplates(listed);
        setPick(firstPick(listed));
      },
      (reason) => current && setError(`Templates not loaded: ${(reason as Error).message}`),
    );
    return () => void (current = false);
    // Only on opening: the ticks are the owner's while it is open.
  }, [open]);

  // The dry run of the pick on the ticked Candidates, once they rest.
  useEffect(() => {
    if (!open || templates === null || ticks.size === 0) {
      setPreview({});
      setChecking(false);
      return;
    }
    let current = true;
    setChecking(true);
    const timer = setTimeout(() => {
      applyToTicked(jobId, pick, candidates, ticks, true).then(
        (answer) => {
          if (!current) return;
          setPreview(Object.fromEntries(answer.candidates.map((applied) => [applied.candidate_id, applied.notices])));
          setChecking(false);
        },
        (reason) => {
          if (!current) return;
          setPreview({});
          setChecking(false);
          setError((reason as Error).message);
        },
      );
    }, DRY_RUN_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [open, templates, pick, ticks]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const answer = await applyToTicked(jobId, pick, candidates, ticks);
      onApplied(templates?.find((template) => template.id === pick)?.name ?? null, answer.candidates);
      onClose();
    } catch (reason) {
      setError(`Not applied: ${(reason as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const count = ticks.size;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={`${id}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className={cx(
        "glass m-auto w-[min(36rem,calc(100%-2rem))] rounded-panel bg-bg/85! p-0 text-text backdrop:bg-black/50",
        "scale-100 opacity-100 starting:open:scale-95 starting:open:opacity-0",
        "motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      <form
        method="dialog"
        className="flex max-h-[min(90dvh,48rem)] flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (count > 0 && !busy) void apply();
        }}
      >
        <div className="flex items-center justify-between gap-3 px-6 pt-5 pb-3">
          <h2 id={`${id}-title`} className="text-lg font-semibold">
            Apply Template
          </h2>
          <Button variant="ghost" size="icon" onClick={onClose} disabled={busy} aria-label="Close">
            <X aria-hidden size={18} />
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-6 pb-4">
          <ApplyTemplateForm
            templates={templates ?? []}
            pick={pick}
            onPick={setPick}
            candidates={candidates}
            ticks={ticks}
            onTick={(candidateId, on) => setTicks((old) => ticked(old, candidateId, on))}
            preview={preview}
            checking={checking}
            disabled={busy || templates === null}
          />
          {error && (
            <p role="alert" className="rounded-control bg-danger-surface p-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-6 py-4">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || count === 0 || templates === null}>
            {busy ? "Applying…" : `Apply to ${count} ${count === 1 ? "clip" : "clips"}`}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

// The picker and the checklist, each ticked Candidate with the dry run's notices under it.
export function ApplyTemplateForm({
  templates,
  pick,
  onPick,
  candidates,
  ticks,
  onTick,
  preview,
  checking,
  disabled,
}: {
  templates: TemplateInfo[];
  pick: string;
  onPick: (pick: string) => void;
  candidates: Candidate[];
  ticks: ReadonlySet<string>;
  onTick: (id: string, on: boolean) => void;
  // The dry run's notices, by Candidate.
  preview: Record<string, string[]>;
  // The dry run is under way.
  checking: boolean;
  disabled?: boolean;
}) {
  const all = candidates.length > 0 && candidates.every((candidate) => ticks.has(candidate.id));
  return (
    <>
      <Select label="Template" value={pick} options={pickChoices(templates)} onChange={onPick} disabled={disabled} />
      {pick === NO_TEMPLATE && (
        <p className="text-sm text-muted">Takes the Template items off the ticked clips; what you made by hand stays.</p>
      )}
      <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={disabled}>
        <legend className="mb-1.5 flex w-full items-center justify-between gap-3 text-sm font-medium">
          Clips
          <span aria-live="polite" className="flex items-center gap-1.5 font-normal text-muted tabular-nums">
            {checking && <Loader2 aria-hidden size={14} className="motion-safe:animate-spin" />}
            {checking ? "Checking…" : `${ticks.size} of ${candidates.length} ticked`}
          </span>
        </legend>
        {candidates.length > 1 && (
          <Button
            size="xs"
            variant="ghost"
            className="self-start"
            onClick={() => candidates.forEach((candidate) => onTick(candidate.id, !all))}
          >
            {all ? "Untick all" : "Tick all"}
          </Button>
        )}
        <ul className="flex flex-col gap-1">
          {candidates.map((candidate, i) => {
            const name = candidateName(candidate, i);
            const on = ticks.has(candidate.id);
            const notices = on ? (preview[candidate.id] ?? []) : [];
            return (
              <li key={candidate.id}>
                <label
                  className={cx(
                    "flex min-h-11 cursor-pointer items-start gap-3 rounded-[10px] border border-border px-3 py-2.5 text-sm",
                    "has-checked:border-accent/60 has-checked:bg-fill hover:bg-fill",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(event) => onTick(candidate.id, event.target.checked)}
                    aria-label={`Apply to ${name}`}
                    className="mt-0.5 size-5 shrink-0 cursor-pointer accent-accent"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="font-medium text-pretty">{name}</span>
                      <span className="text-muted tabular-nums">
                        {formatClock(candidate.start)}–{formatClock(candidate.end)}
                      </span>
                    </span>
                    {notices.map((notice) => (
                      <span key={notice} className="flex items-start gap-1.5 text-muted">
                        <Info aria-hidden size={14} className="mt-0.5 shrink-0" />
                        {notice}
                      </span>
                    ))}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </>
  );
}
