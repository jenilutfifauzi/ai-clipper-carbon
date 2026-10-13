import { ArrowLeft, ExternalLink } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type JobDetail, type JobProgress } from "../api";
import { Panel } from "../components/Panel";
import { StageProgress } from "../components/StageProgress";
import { StatusBadge } from "../components/StatusBadge";
import { formatRelative } from "../format";
import { useJobEvents } from "../hooks/useJobEvents";
import { stageIndex } from "../stages";
import { ErrorNote, WaitingNote, Warnings } from "./job/JobStatusNotes";
import { Review } from "./job/Review";

export function JobPage() {
  const { jobId = "" } = useParams();
  return <JobView key={jobId} jobId={jobId} />;
}

function progressOf(job: JobDetail): JobProgress {
  const { status, stage, progress, message, error, warnings, quota } = job;
  return { status, stage, progress, message, error, warnings, retry_at: quota?.retry_at ?? null };
}

// A Job's live progress, then (in review) the review of its Candidates.
function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const events = useJobEvents(jobId);

  const load = useCallback(
    () => api.getJob(jobId).then(setJob, (reason: ApiError) => setLoadError(reason)),
    [jobId],
  );
  useEffect(() => void load(), [load]);
  // The Candidates come with the Job, not with its events: fetch it again once it settles.
  useEffect(() => {
    if (events.ended === "review" || events.ended === "error") void load();
  }, [events.ended, load]);

  if (loadError) {
    return (
      <Panel>
        <h1 className="text-xl font-semibold">{loadError.status === 404 ? "No such Job" : "Couldn't load the Job"}</h1>
        <p className="mt-2 text-muted">{loadError.message}</p>
        <BackLink />
      </Panel>
    );
  }
  if (!job) return <p className="text-muted">Loading the Job…</p>;

  const progress = events.progress ?? progressOf(job);
  const reached = Math.max(-1, ...job.history.map((change) => stageIndex(change.status)), stageIndex(progress.status));

  async function retry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const queued = await api.retryJob(jobId);
      setJob((old) => old && { ...old, ...queued });
      events.reconnect();
    } catch (reason) {
      setRetryError((reason as Error).message);
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <BackLink />
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Job</h1>
          <StatusBadge status={progress.status} />
        </div>
        <a
          href={job.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-full items-center gap-1.5 self-start text-accent-text hover:underline"
        >
          <span className="truncate">{job.url}</span>
          <ExternalLink aria-hidden size={14} className="shrink-0" />
        </a>
        <p className="text-sm text-muted">
          Started {formatRelative(job.created_at)} · clips {job.options.min_secs}–{job.options.max_secs} s · captions{" "}
          {job.options.captions ? "on" : "off"} · language {job.options.language}
        </p>
        {job.options.brief && <p className="text-sm">Brief: {job.options.brief}</p>}
      </header>

      <Panel aria-label="Progress" className="flex flex-col gap-3">
        {progress.status === "queued" && (
          <p className="text-sm text-muted">Queued: it starts when the Job ahead of it is done.</p>
        )}
        <StageProgress progress={progress} reached={reached} />
        {events.lost && (
          <p className="text-sm text-muted">Reconnecting to live progress…</p>
        )}
      </Panel>

      {progress.status === "waiting_quota" && <WaitingNote progress={progress} />}
      {progress.status === "error" && (
        <ErrorNote progress={progress} retrying={retrying} retryError={retryError} onRetry={retry} />
      )}
      {progress.warnings.length > 0 && <Warnings warnings={progress.warnings} />}

      {progress.status === "review" && job.candidates && <Review key={job.updated_at} job={job} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/" className="inline-flex items-center gap-1.5 self-start py-2 text-sm text-muted hover:text-text">
      <ArrowLeft aria-hidden size={16} />
      All Jobs
    </Link>
  );
}
