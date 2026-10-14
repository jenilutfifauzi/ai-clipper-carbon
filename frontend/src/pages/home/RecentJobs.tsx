import { ChevronRight, Film, Loader2, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { api, type Job } from "../../api";
import { Button } from "../../components/Button";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { Panel } from "../../components/Panel";
import { Skeleton } from "../../components/Skeleton";
import { StatusBadge } from "../../components/StatusBadge";
import { formatClock, formatRelative, jobThumbnail, jobTitle } from "../../format";
import { useOnVisible } from "../../hooks/useOnVisible";
import { ACTIVE } from "../../stages";

// While some Job is on its way, the list is fetched again this often to follow its status.
const REFRESH_MS = 4000;
// How many Jobs are fetched at a time: the next page as the end of the list comes into reach.
const PAGE = 20;

// The Jobs, newest first, each linking to its page, with a delete that asks first.
export function RecentJobs() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // How many Jobs are listed, for the refresh to fetch them all again.
  const listed = useRef(0);
  listed.current = jobs?.length ?? 0;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    const limit = Math.max(PAGE, listed.current);
    api.listJobs({ limit }).then(
      (list) => {
        if (cancelled) return;
        // A full answer may leave out older Jobs listed meanwhile (by a next page): keep those.
        setJobs((old) => {
          const last = list.at(-1);
          if (!old || !last || list.length < limit) return list;
          return [...list, ...old.filter((job) => job.created_at < last.created_at)];
        });
        if (list.length < limit) setHasMore(false);
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

  async function loadMore() {
    const last = jobs?.at(-1);
    if (!last) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api.listJobs({ limit: PAGE, before: last.created_at });
      setJobs((old) => old && [...old, ...page.filter((job) => !old.some((listed) => listed.id === job.id))]);
      setHasMore(page.length === PAGE);
    } catch (reason) {
      setMoreError((reason as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }
  const endRef = useOnVisible(loadMore, hasMore && !loadingMore && !moreError, jobs?.length);

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await api.deleteJob(deleting.id);
      setJobs((list) => list?.filter((job) => job.id !== deleting.id) ?? null);
      setDeleting(null);
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
      {!jobs && !loadError && <JobsSkeleton />}
      {jobs?.length === 0 && <p className="mt-3 text-muted">No Jobs yet. Start one above.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="mt-3 -mx-2 flex flex-col">
          {jobs.map((job) => (
            <li key={job.id} className="flex items-center gap-1 border-t border-border first:border-t-0">
              <Link
                to={`/jobs/${job.id}`}
                className="flex min-h-20 min-w-0 flex-1 items-center gap-3 rounded-control px-2 py-2 hover:bg-fill motion-safe:transition-colors"
              >
                <Thumbnail job={job} />
                {/* On a phone the status goes under the title, which keeps the width. */}
                <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{jobTitle(job)}</p>
                    <p className="truncate text-sm text-muted">
                      {formatRelative(job.created_at)}
                      {job.options.brief && <> · {job.options.brief}</>}
                    </p>
                  </div>
                  <StatusBadge status={job.status} uploaded={job.upload !== null} />
                </div>
                <ChevronRight aria-hidden size={18} className="shrink-0 text-muted" />
              </Link>
              <Button
                variant="ghost"
                aria-label={`Delete Job ${jobTitle(job)}`}
                onClick={() => {
                  setDeleteError(null);
                  setDeleting(job);
                }}
                size="icon"
              >
                <Trash2 aria-hidden size={18} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {jobs && jobs.length > 0 && hasMore && (
        <div ref={endRef} className="mt-1 flex min-h-11 items-center justify-center gap-2 text-sm text-muted">
          {moreError ? (
            <>
              <span className="text-danger">Couldn't load more Jobs: {moreError}</span>
              <Button variant="ghost" size="sm" onClick={() => setMoreError(null)}>
                Try again
              </Button>
            </>
          ) : (
            <span role="status" className="inline-flex items-center gap-2">
              <Loader2 aria-hidden size={16} className="motion-safe:animate-spin" />
              Loading more Jobs…
            </span>
          )}
        </div>
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

// Rows shaped like the Jobs' own, while the first page loads.
function JobsSkeleton() {
  return (
    <>
      <p role="status" className="sr-only">
        Loading the Jobs
      </p>
      <ul aria-hidden className="mt-3 -mx-2 flex flex-col">
        {[0, 1, 2, 3].map((row) => (
          <li key={row} className="flex items-center gap-1 border-t border-border first:border-t-0">
            <div className="flex min-h-20 flex-1 items-center gap-3 px-2 py-2">
              <Skeleton className="aspect-video w-20 shrink-0 rounded-[calc(var(--radius-control)_-_8px)] sm:w-28" />
              <div className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="my-1 h-4 w-3/5 rounded-full" />
                  <Skeleton className="my-[3px] h-3.5 w-2/5 rounded-full" />
                </div>
                <Skeleton className="my-[3px] h-3.5 w-24 rounded-full" />
              </div>
              <span className="size-[18px] shrink-0" />
            </div>
            <span className="size-11 shrink-0" />
          </li>
        ))}
      </ul>
    </>
  );
}

// A 16:9 still of the Job's video, with its length once that's known; a film icon until there's one.
function Thumbnail({ job }: { job: Job }) {
  const src = jobThumbnail(job);
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <div className="relative aspect-video w-20 shrink-0 overflow-hidden rounded-[calc(var(--radius-control)_-_8px)] bg-fill outline-1 -outline-offset-1 outline-border sm:w-28">
      {src && failed !== src ? (
        <img src={src} alt="" width={320} height={180} loading="lazy" decoding="async" onError={() => setFailed(src)} className="size-full object-cover" />
      ) : (
        <Film aria-hidden size={20} className="absolute inset-0 m-auto text-muted" />
      )}
      {job.source && (
        <span className="pointer-events-none absolute right-1 bottom-1 rounded-[4px] bg-black/70 px-1 text-xs leading-4 font-medium text-white tabular-nums select-none">
          {formatClock(job.source.metadata.duration)}
        </span>
      )}
    </div>
  );
}
