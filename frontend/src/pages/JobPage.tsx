import { ExternalLink, FileVideo } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { api, ApiError, type Clip, type ExportPresetList, type JobDetail, type JobProgress } from "../api";
import { Panel } from "../components/Panel";
import { StageProgress } from "../components/StageProgress";
import { StatusBadge } from "../components/StatusBadge";
import { formatBytes, formatRelative } from "../format";
import { useJobEvents } from "../hooks/useJobEvents";
import { stageIndex } from "../stages";
import { BackLink, JobSkeleton } from "./job/JobSkeleton";
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

// A Job's live progress, then (in review) the review of its Candidates and its Clips.
function JobView({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const events = useJobEvents(jobId);
  // Whether the Job was in review when last loaded: then only its Clips change by themselves.
  const reviewing = useRef(false);
  // The Export Presets for the Render buttons, and the one picked for this page's session: the
  // default until another is.
  const [exportPresets, setExportPresets] = useState<ExportPresetList | null>(null);
  const [pickedExport, setPickedExport] = useState<string | null>(null);
  useEffect(() => void api.listExportPresets().then(setExportPresets, () => {}), []);

  const load = useCallback(
    () =>
      api.getJob(jobId).then(
        (loaded) => {
          reviewing.current = loaded.status === "review" || loaded.status === "rendering";
          setJob(loaded);
          setClips(loaded.clips);
        },
        (reason: ApiError) => setLoadError(reason),
      ),
    [jobId],
  );
  const loadClips = useCallback(() => api.listClips(jobId).then(setClips, () => {}), [jobId]);
  useEffect(() => void load(), [load]);
  // The Candidates come with the Job, not with its events: fetch it again once it settles. After
  // renders, fetch just the Clips, so that the review in progress isn't reset.
  useEffect(() => {
    if (events.ended !== "review" && events.ended !== "error") return;
    void (reviewing.current ? loadClips() : load());
  }, [events.ended, load, loadClips]);
  // Each new render message means the Clip before it is done.
  const renderMessage = events.progress?.status === "rendering" ? events.progress.message : null;
  useEffect(() => {
    if (renderMessage) void loadClips();
  }, [renderMessage, loadClips]);

  if (loadError) {
    return (
      <Panel>
        <h1 className="text-xl font-semibold">{loadError.status === 404 ? "No such Job" : "Couldn't load the Job"}</h1>
        <p className="mt-2 text-muted">{loadError.message}</p>
        <BackLink />
      </Panel>
    );
  }
  if (!job) return <JobSkeleton />;

  const progress = events.progress ?? progressOf(job);
  const reached = Math.max(
    -1,
    ...job.history.map((change) => stageIndex(change.status)),
    stageIndex(progress.status),
    clips.length > 0 ? stageIndex("rendering") : -1,
  );

  // Queue Clips of the given Candidates (the selected ones by default) with an Export Preset (the
  // default without one), and follow the renders.
  async function render(candidateIds?: string[], exportPresetId?: string) {
    setClips(await api.render(jobId, candidateIds, exportPresetId));
    events.reconnect();
  }

  // Queue a Candidate's transcription and analysis for its preview, and follow it like a render.
  async function prepare(candidateId: string) {
    await api.prepareCandidate(jobId, candidateId);
    events.reconnect();
  }

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
          <StatusBadge status={progress.status} uploaded={job.upload !== null} />
        </div>
        {job.upload ? (
          <p className="inline-flex max-w-full items-center gap-1.5 self-start">
            <FileVideo aria-hidden size={16} className="shrink-0 text-muted" />
            <span className="truncate">{job.upload.name}</span>
            <span className="shrink-0 text-sm text-muted tabular-nums">· uploaded, {formatBytes(job.upload.size)}</span>
          </p>
        ) : (
          <a
            href={job.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 self-start text-accent-text hover:underline"
          >
            <span className="truncate">{job.url}</span>
            <ExternalLink aria-hidden size={14} className="shrink-0" />
          </a>
        )}
        <p className="text-sm text-pretty text-muted">
          Started {formatRelative(job.created_at)} · clips {job.options.min_secs}–{job.options.max_secs} s · captions{" "}
          {job.options.captions ? "on" : "off"} · language {job.options.language}
        </p>
        {job.options.brief && <p className="text-sm break-words">Brief: {job.options.brief}</p>}
      </header>

      <Panel aria-label="Progress" className="flex flex-col gap-3">
        {progress.status === "queued" && (
          <p className="text-sm text-muted">Queued: it starts when the Job ahead of it is done.</p>
        )}
        <StageProgress progress={progress} reached={reached} uploaded={job.upload !== null} />
        {events.lost && (
          <p className="text-sm text-muted">Reconnecting to live progress…</p>
        )}
      </Panel>

      {progress.status === "waiting_quota" && <WaitingNote progress={progress} />}
      {progress.status === "error" && (
        <ErrorNote
          progress={progress}
          uploaded={job.upload !== null}
          retrying={retrying}
          retryError={retryError}
          onRetry={retry}
        />
      )}
      {progress.warnings.length > 0 && <Warnings warnings={progress.warnings} uploaded={job.upload !== null} />}

      {(progress.status === "review" || progress.status === "rendering") && job.candidates && (
        <Review
          key={job.updated_at}
          job={job}
          clips={clips}
          progress={progress}
          exportPresets={exportPresets}
          pickedExport={pickedExport}
          onPickExport={setPickedExport}
          onRender={render}
          onPrepare={prepare}
        />
      )}
    </div>
  );
}
