import { ChevronRight, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { api, type Job } from "../../api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Panel } from "../../components/Panel";
import { StatusBadge } from "../../components/StatusBadge";
import { formatRelative, jobTitle } from "../../format";
import { ACTIVE } from "../../stages";

// While some Job is on its way, the list is fetched again this often to follow its status.
const REFRESH_MS = 4000;

// The Jobs, newest first, each linking to its page, with a delete that asks first.
export function RecentJobs({ onDeleted }: { onDeleted: () => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    api.listJobs().then(
      (list) => {
        if (cancelled) return;
        setJobs(list);
        setLoadError(null);
        if (list.some((job) => ACTIVE.has(job.status))) {
          timer = setTimeout(() => setVersion((n) => n + 1), REFRESH_MS);
        }
      },
      (reason: Error) => !cancelled && setLoadError(reason.message),
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [version]);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteJob(deleting.id);
      setJobs((list) => list?.filter((job) => job.id !== deleting.id) ?? null);
      setDeleting(null);
      onDeleted();
    } catch (reason) {
      setDeleteError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="font-semibold">
        Recent Jobs
      </h2>
      {loadError && <p className="mt-3 text-sm text-danger">Couldn't load the Jobs: {loadError}</p>}
      {jobs?.length === 0 && <p className="mt-3 text-muted">No Jobs yet. Start one above.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="mt-3 -mx-2 flex flex-col">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-1 border-t border-border first:border-t-0">
              <Link
                to={`/jobs/${job.id}`}
                className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 hover:bg-surface-raised"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{jobTitle(job)}</p>
                  <p className="truncate text-sm text-muted">
                    {formatRelative(job.created_at)}
                    {job.options.brief && <> · {job.options.brief}</>}
                  </p>
                </div>
                <StatusBadge status={job.status} />
                <ChevronRight aria-hidden size={18} className="shrink-0 text-muted" />
              </Link>
              <Button
                variant="ghost"
                aria-label={`Delete Job ${jobTitle(job)}`}
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(job);
                }}
                className="size-11 shrink-0 px-0"
              >
                <Trash2 aria-hidden size={18} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this Job?"
        confirmLabel="Delete Job"
        busyLabel="Deleting…"
        busy={busy}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      >
        {deleting && (
          <p>
            <span className="text-text">{jobTitle(deleting)}</span> and all its files ({deleting.upload ? "the uploaded file" : "the downloaded video"}, the
            Transcript and the Candidates) will be removed. This can't be undone.
          </p>
        )}
      </ConfirmDialog>
    </Panel>
  );
}
