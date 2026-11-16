import { ArrowLeft, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, ApiError, type Clip, type ExportPresetList, type JobDetail } from "../api";
import { buttonClass } from "../components/Button";
import { Panel } from "../components/Panel";
import { jobTitle } from "../format";
import { useJobEvents } from "../hooks/useJobEvents";
import { Clips } from "./job/Clips";
import { ExportPresetsSheet } from "./job/ExportPresetsSheet";
import { pickedPreset, sourceHeight } from "./job/exportPresets";
import { JobSkeleton } from "./job/JobSkeleton";
import { progressOf } from "./JobPage";

export function ProjectClipsPage() {
  const { jobId = "" } = useParams();
  return <ProjectClips key={jobId} jobId={jobId} />;
}

// A Project's exports: its Clips, to watch, download or render again, and a way back to its editor.
function ProjectClips({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<JobDetail | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [exportPresets, setExportPresets] = useState<ExportPresetList | null>(null);
  const [managingExport, setManagingExport] = useState(false);
  const events = useJobEvents(jobId);
  useEffect(() => void api.listExportPresets().then(setExportPresets, () => {}), []);

  useEffect(
    () =>
      void api.getJob(jobId).then(
        (loaded) => {
          setJob(loaded);
          setClips(loaded.clips);
        },
        (reason: ApiError) => setLoadError(reason),
      ),
    [jobId],
  );
  const loadClips = useCallback(() => api.listClips(jobId).then(setClips, () => {}), [jobId]);
  // Each new render message means the Clip before it is done; the end of the renders, the last.
  const renderMessage = events.progress?.status === "rendering" ? events.progress.message : null;
  useEffect(() => {
    if (renderMessage || events.ended) void loadClips();
  }, [renderMessage, events.ended, loadClips]);

  async function render(candidateIds: string[], exportPresetId?: string) {
    setClips(await api.render(jobId, candidateIds, exportPresetId));
    events.reconnect();
  }

  const back = (
    <Link to="/projects" className="inline-flex min-h-11 items-center gap-1.5 self-start text-muted hover:text-text">
      <ArrowLeft aria-hidden size={16} />
      All Projects
    </Link>
  );
  if (loadError) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Panel>
          <h1 className="text-xl font-semibold">{loadError.status === 404 ? "No such Project" : "Couldn't load the Project"}</h1>
          <p className="mt-2 text-muted">{loadError.message}</p>
        </Panel>
      </div>
    );
  }
  if (!job) return <JobSkeleton />;

  const candidate = job.candidates?.[0];
  return (
    <div className="flex flex-col gap-5">
      {back}
      <Panel className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="min-w-0 truncate text-xl font-semibold">{jobTitle(job)}</h1>
        {candidate && (
          <Link to={`/jobs/${job.id}/candidates/${candidate.id}/advanced`} className={buttonClass("secondary", "sm")}>
            <SlidersHorizontal aria-hidden size={16} />
            Open in the editor
          </Link>
        )}
      </Panel>
      {clips.length === 0 ? (
        <Panel>
          <p className="text-muted">Nothing exported yet. Export from the editor, and the video shows here to download.</p>
        </Panel>
      ) : (
        <Clips
          jobId={job.id}
          clips={clips}
          candidates={job.candidates ?? []}
          progress={events.progress ?? progressOf(job)}
          exportPresets={exportPresets}
          sourceFps={job.source?.metadata.fps ?? 30}
          onRender={render}
          onManageExport={() => setManagingExport(true)}
        />
      )}
      {exportPresets && (
        <ExportPresetsSheet
          open={managingExport}
          list={exportPresets}
          initial={pickedPreset(exportPresets, null)}
          sourceHeight={job.source ? sourceHeight(job.source.metadata) : null}
          onClose={() => setManagingExport(false)}
          onChange={setExportPresets}
        />
      )}
    </div>
  );
}
