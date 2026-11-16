import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, FileVideo, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, uploadJob, uploadMedia, type Aspect, type JobDetail, type UploadProgress } from "../api";
import { Button } from "../components/Button";
import { Panel } from "../components/Panel";
import { ProgressBar } from "../components/ProgressBar";
import { Segmented } from "../components/Segmented";
import { cx, formatBytes, jobTitle } from "../format";
import { useJobEvents } from "../hooks/useJobEvents";
import { FileDrop } from "./home/FileDrop";
import { RecentJobs } from "./home/RecentJobs";
import { ErrorNote, StoppedNote } from "./job/JobStatusNotes";

const ASPECTS = [
  { value: "9:16", label: "9:16" },
  { value: "4:5", label: "4:5" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
] as const satisfies readonly { value: Aspect; label: string }[];

// Statuses in which a Project's Candidate can be opened in the Advanced Edit.
const OPENABLE = new Set(["review", "rendering"]);

// Projects (GLOSSARY.md): videos opened straight in the Advanced Edit, like a CapCut project, with
// no transcription nor AI analysis; and the ones made before.
export function ProjectsPage() {
  return (
    <div className="flex flex-col gap-5">
      <NewProject />
      <RecentJobs project />
    </div>
  );
}

// Pick one or more videos and an aspect: the others go to the Media Library first, then the first is
// uploaded as the Project's main video, and the Project opens.
function NewProject() {
  const navigate = useNavigate();
  const id = useId();
  const [files, setFiles] = useState<File[]>([]);
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  function move(from: number, to: number) {
    setFiles((list) => {
      const next = [...list];
      const [file] = next.splice(from, 1);
      next.splice(to, 0, file);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const [main, ...others] = files;
    if (!main) return;
    setPending(true);
    setError(null);
    try {
      const media: string[] = [];
      for (const [i, file] of others.entries()) {
        setStep(`Adding video ${i + 2} of ${files.length} to the Media Library: ${file.name}`);
        setUploaded({ loaded: 0, total: file.size });
        const upload = uploadMedia(file, setUploaded);
        cancel.current = upload.abort;
        media.push((await upload.done).id);
      }
      setStep(`Uploading the main video: ${main.name}`);
      // Asked first: the answer to the upload itself would only come once all of it was sent.
      await api.checkUpload(main.size);
      setUploaded({ loaded: 0, total: main.size });
      const upload = uploadJob(main, { aspect, captions: false, template: null }, setUploaded, { media });
      cancel.current = upload.abort;
      const job = await upload.done;
      navigate(`/projects/${job.id}`);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError((reason as Error).message);
      setPending(false);
      setStep(null);
      setUploaded(null);
    } finally {
      cancel.current = null;
    }
  }

  return (
    <Panel aria-labelledby={`${id}-heading`}>
      <h1 id={`${id}-heading`} className="text-2xl font-semibold tracking-tight text-balance">
        New Project
      </h1>
      <p className="mt-1 max-w-prose text-pretty text-muted">
        Pick your videos and edit them straight away in the Advanced Edit. Nothing is transcribed or analyzed.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Videos</span>
          <FileDrop
            id={`${id}-files`}
            file={null}
            onFiles={(picked) => setFiles((list) => [...list, ...picked])}
            disabled={pending}
          />
          {files.length > 0 && (
            <ol className="mt-1 flex flex-col">
              {files.map((file, i) => (
                <li key={`${file.name}-${file.size}-${i}`} className="flex min-h-11 items-center gap-2 border-t border-border first:border-t-0">
                  <span className="w-6 shrink-0 text-right text-sm text-muted tabular-nums">{i + 1}</span>
                  <FileVideo aria-hidden size={18} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{file.name}</span>
                  <span className="shrink-0 text-sm text-muted tabular-nums">
                    {i === 0 ? "main · " : ""}
                    {formatBytes(file.size)}
                  </span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Move ${file.name} up`} disabled={pending || i === 0} onClick={() => move(i, i - 1)}>
                    <ArrowUp aria-hidden size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Move ${file.name} down`}
                    disabled={pending || i === files.length - 1}
                    onClick={() => move(i, i + 1)}
                  >
                    <ArrowDown aria-hidden size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${file.name}`}
                    disabled={pending}
                    onClick={() => setFiles((list) => list.filter((_, j) => j !== i))}
                  >
                    <X aria-hidden size={16} />
                  </Button>
                </li>
              ))}
            </ol>
          )}
          {files.length > 1 && (
            <span className="text-sm text-muted">
              The videos after the first go to the Media Library, which takes videos of up to 3 minutes.
            </span>
          )}
        </div>

        <Segmented
          legend="Shape"
          options={ASPECTS}
          value={aspect}
          onChange={setAspect}
          className={cx("sm:max-w-sm", pending && "pointer-events-none opacity-60")}
        />

        {step && (
          <div className="flex flex-col gap-2" role="status">
            <p className="truncate text-sm text-muted">{step}</p>
            {uploaded && <ProgressBar percent={(100 * uploaded.loaded) / Math.max(uploaded.total, 1)} label="Upload progress" />}
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={pending || files.length === 0}>
            {pending ? <Loader2 aria-hidden size={18} className="motion-safe:animate-spin" /> : <ArrowRight aria-hidden size={18} />}
            {pending ? "Creating…" : "Create Project"}
          </Button>
          {pending && (
            <Button onClick={() => cancel.current?.()}>Cancel</Button>
          )}
        </div>
      </form>
    </Panel>
  );
}

// A Project as it is being opened (its main video stored and its preview copy made): it goes on to
// the Advanced Edit of its Candidate as soon as that is there.
export function ProjectOpening() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const events = useJobEvents(jobId);

  const load = useCallback(() => api.getJob(jobId).then(setJob, (reason: Error) => setLoadError(reason.message)), [jobId]);
  useEffect(() => void load(), [load]);
  useEffect(() => {
    if (events.ended === "review") void load();
  }, [events.ended, load]);
  useEffect(() => {
    const candidate = job?.candidates?.[0];
    if (job && candidate && OPENABLE.has(job.status)) {
      navigate(`/jobs/${job.id}/candidates/${candidate.id}/advanced`, { replace: true });
    }
  }, [job, navigate]);

  async function act(change: (id: string) => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await change(jobId);
      events.reconnect();
    } catch (reason) {
      setActionError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const progress = events.progress;
  return (
    <div className="flex flex-col gap-5">
      <Link to="/projects" className="inline-flex min-h-11 items-center gap-1.5 self-start text-muted hover:text-text">
        <ArrowLeft aria-hidden size={16} />
        All Projects
      </Link>
      {loadError ? (
        <Panel>
          <h1 className="text-xl font-semibold">Couldn't open the Project</h1>
          <p className="mt-2 text-muted">{loadError}</p>
        </Panel>
      ) : (
        <Panel aria-live="polite" className="flex flex-col gap-3">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            {progress?.status !== "error" && progress?.status !== "stopped" && (
              <Loader2 aria-hidden size={20} className="text-accent-text motion-safe:animate-spin" />
            )}
            {job ? jobTitle(job) : "Opening the Project"}
          </h1>
          {progress?.status === "queued" && <p className="text-sm text-muted">Queued: it starts when the Job ahead of it is done.</p>}
          {progress?.status === "downloading" && (
            <>
              <p className="text-sm text-muted">{progress.message ?? "Preparing the main video…"}</p>
              <ProgressBar percent={progress.progress} label="Preparing progress" />
            </>
          )}
          {progress && OPENABLE.has(progress.status) && <p className="text-sm text-muted">Opening the editor…</p>}
        </Panel>
      )}
      {progress?.status === "error" && job && (
        <ErrorNote progress={progress} uploaded retrying={busy} retryError={actionError} onRetry={() => act(api.retryJob)} />
      )}
      {progress?.status === "stopped" && (
        <StoppedNote progress={progress} uploaded continuing={busy} continueError={actionError} onContinue={() => act(api.continueJob)} />
      )}
    </div>
  );
}
