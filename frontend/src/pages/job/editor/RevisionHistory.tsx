import { History, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, type EditSource, type RevisionEntry } from "../../../api";
import { Button } from "../../../components/Button";
import { cx, formatRelative } from "../../../format";
import { savedByLabel } from "./useCandidateEvents";

/**
 * The Candidate's Revision History (ADR 0003): a button that opens its entries, newest first, each
 * with when, by which editor, and the parts it changed, and a Restore of any but the newest (after
 * a confirmation). `onRestore` saves the edits waiting first, then restores; it answers why it
 * couldn't, or null once it has.
 */
export function RevisionHistory({
  jobId,
  candidateId,
  revision,
  here,
  onRestore,
  size = "icon",
}: {
  jobId: string;
  candidateId: string;
  // The Candidate's Revision now: its entry is the current state, not something to restore.
  revision: number;
  here: EditSource;
  onRestore: (revision: number) => Promise<string | null>;
  size?: "icon" | "sm";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<RevisionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The entry asked to be restored, and whether the Restore is under way.
  const [asked, setAsked] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    setEntries(null);
    setError(null);
    setAsked(null);
    api.listRevisions(jobId, candidateId).then(setEntries, (reason: Error) => setError(reason.message));
  }, [open, jobId, candidateId]);

  async function restore(entry: number) {
    setBusy(true);
    setError(null);
    const failed = await onRestore(entry);
    setBusy(false);
    if (failed) setError(failed);
    else setOpen(false);
  }

  return (
    <>
      <Button
        variant={size === "icon" ? "ghost" : "secondary"}
        size={size}
        onClick={() => setOpen(true)}
        aria-label={size === "icon" ? "Revision History" : undefined}
      >
        <History aria-hidden size={size === "icon" ? 18 : 16} />
        {size !== "icon" && "Revision History"}
      </Button>
      <dialog
        ref={dialog}
        aria-labelledby="revision-history-title"
        onCancel={(event) => {
          event.preventDefault();
          if (!busy) setOpen(false);
        }}
        className="glass m-auto w-[min(32rem,calc(100%-2rem))] rounded-panel bg-bg/85! p-0 text-text backdrop:bg-black/50"
      >
        <div className="flex max-h-[min(80dvh,40rem)] flex-col gap-4 p-6">
          <div className="flex flex-col gap-1">
            <h2 id="revision-history-title" className="text-lg font-semibold">
              Revision History
            </h2>
            <p className="text-sm text-muted">The last 50 saved versions of this clip. Restoring one saves it again; nothing is lost.</p>
          </div>
          {error && (
            <p role="alert" className="rounded-control bg-danger-surface p-3 text-sm text-danger">
              {error}
            </p>
          )}
          {!entries ? (
            !error && (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <Loader2 aria-hidden size={16} className="motion-safe:animate-spin" />
                Loading
              </p>
            )
          ) : entries.length === 0 ? (
            <p className="text-sm text-muted">Nothing saved yet: versions appear here once this clip is changed.</p>
          ) : (
            <ol className="-mx-2 flex min-h-0 flex-col overflow-y-auto">
              {entries.map((entry) => (
                <li key={entry.revision} className={cx("flex flex-col gap-2 rounded-control p-2", asked === entry.revision && "bg-fill")}>
                  <div className="flex items-center gap-3">
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="text-sm font-medium">
                        {savedByLabel(entry.source, entry.tab, here)}
                        {entry.at && <span className="font-normal text-muted"> · {formatRelative(entry.at)}</span>}
                      </span>
                      <span className="truncate text-xs text-muted">{entry.parts.length ? entry.parts.join(", ") : "As it was"}</span>
                    </div>
                    {entry.revision === revision ? (
                      <span className="text-xs text-muted">Now</span>
                    ) : (
                      asked !== entry.revision && (
                        <Button size="xs" onClick={() => setAsked(entry.revision)} disabled={busy}>
                          Restore
                        </Button>
                      )
                    )}
                  </div>
                  {asked === entry.revision && (
                    <div className="flex items-center justify-end gap-2">
                      <span className="mr-auto text-sm text-muted">Restore this version?</span>
                      <Button size="xs" onClick={() => setAsked(null)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button size="xs" variant="primary" onClick={() => void restore(entry.revision)} disabled={busy}>
                        {busy ? "Restoring…" : "Restore"}
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="flex justify-end">
            <Button onClick={() => setOpen(false)} disabled={busy} autoFocus>
              Close
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/**
 * The entry a notice's Restore brings back, found once it is clicked (saves keep going into the
 * newest entry): the state before Revision `revision` came in, or ("theirs") the other editor's
 * version from that Revision on.
 */
export async function entryToRestore(
  jobId: string,
  candidateId: string,
  which: "before" | "theirs",
  revision: number,
): Promise<number | null> {
  const entries = await api.listRevisions(jobId, candidateId);
  const found =
    which === "before"
      ? entries.find((entry) => entry.revision < revision)
      : entries.findLast((entry) => entry.revision >= revision);
  return found?.revision ?? null;
}
