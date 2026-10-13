// The backend's HTTP API (backend/app/api.py), as the frontend uses it.

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "review"
  | "waiting_quota"
  | "error";

export interface JobOptions {
  language: string;
  min_secs: number;
  max_secs: number;
  captions: boolean;
  brief: string | null;
  transcribe_locally: boolean;
}

export interface JobWarning {
  stage: JobStatus;
  message: string;
}

export interface QuotaWait {
  since: string;
  errors: number;
  retry_at: string;
  scored: number;
}

export interface SourceMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
}

export interface Source {
  video: string;
  caption_track: string | null;
  metadata: SourceMetadata;
}

export interface Job {
  id: string;
  url: string;
  options: JobOptions;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  // The stage running now, or the one the Job stopped in (error, waiting_quota).
  stage: JobStatus | null;
  error: string | null;
  progress: number | null;
  message: string | null;
  warnings: JobWarning[];
  quota: QuotaWait | null;
  source: Source | null;
  prompt_version: string | null;
  history: { status: JobStatus; at: string }[];
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

// A line of the Transcript, for display.
export interface Segment {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  language: string;
  source: "youtube" | "whisper";
  words: Word[];
  segments: Segment[];
}

export type Layout = "auto" | "track" | "split" | "blur";

export interface Candidate {
  id: string;
  start: number;
  end: number;
  // The AI's assessment; null for a manual Candidate.
  predicted_score: number | null;
  hook_strength: number | null;
  emotion: string;
  reason: string;
  retention_notes: string;
  hook_text: string;
  title: string;
  descriptions: { tiktok: string; instagram: string; shorts: string };
  hashtags: string[];
  window_id: string | null;
  window_score: number | null;
  origin: "ai" | "manual";
  layout: Layout;
  // Chosen for rendering.
  selected: boolean;
  // The owner has changed its bounds, hook text or layout.
  edited: boolean;
}

// A review edit: fields left out stay as they are. The backend snaps start and end to Words.
export interface CandidateChange {
  start?: number;
  end?: number;
  hook_text?: string;
  layout?: Layout;
  selected?: boolean;
}

export interface JobDetail extends Job {
  transcript: Transcript | null;
  // Best first; null until the Job has been analyzed.
  candidates: Candidate[] | null;
}

// A `job` event from GET /api/jobs/{id}/events.
export interface JobProgress {
  status: JobStatus;
  stage: JobStatus | null;
  progress: number | null;
  message: string | null;
  error: string | null;
  warnings: JobWarning[];
  retry_at: string | null;
}

export interface DiskUsage {
  used_bytes: number;
  free_bytes: number;
  total_bytes: number;
  warning: boolean;
  warning_below_bytes: number;
}

export interface NewJob {
  url: string;
  options: Partial<JobOptions>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    throw new ApiError(response.status, await errorMessage(response));
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// FastAPI's `detail`: a message, or a list of validation errors.
async function errorMessage(response: Response): Promise<string> {
  try {
    const { detail } = await response.json();
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((error: { msg: string }) => error.msg).join("; ");
  } catch {
    // not JSON: fall through to the status line
  }
  return `${response.status} ${response.statusText}`;
}

export const api = {
  listJobs: () => request<Job[]>("/jobs"),
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  createJob: (job: NewJob) => request<Job>("/jobs", { method: "POST", body: JSON.stringify(job) }),
  retryJob: (id: string) => request<Job>(`/jobs/${id}/retry`, { method: "POST" }),
  deleteJob: (id: string) => request<void>(`/jobs/${id}`, { method: "DELETE" }),
  disk: () => request<DiskUsage>("/system/disk"),
  updateCandidate: (jobId: string, id: string, change: CandidateChange) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  addCandidate: (jobId: string, range: { start: number; end: number }) =>
    request<Candidate>(`/jobs/${jobId}/candidates`, { method: "POST", body: JSON.stringify(range) }),
};

// A file from the Job's directory, served with range support for the player.
export const mediaUrl = (jobId: string, file: string) => `/media/${jobId}/${encodeURIComponent(file)}`;

export const jobEventsUrl = (id: string) => `/api/jobs/${id}/events`;
