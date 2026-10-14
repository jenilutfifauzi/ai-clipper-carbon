// The backend's HTTP API (backend/app/api.py), as the frontend uses it.

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "review"
  // In review, with Clips queued or being rendered.
  | "rendering"
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
  // A copy the browser can play, for previews, when it can't play `video` (an HEVC or ProRes master).
  preview: string | null;
}

// The master file the owner uploaded for a Job, in place of a URL.
export interface Upload {
  // Its name on the owner's machine, and its size in bytes.
  name: string;
  size: number;
  // The stored file, in the Job's directory.
  file: string;
}

export interface Job {
  id: string;
  // Empty for an uploaded master file.
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
  upload: Upload | null;
  source: Source | null;
  prompt_version: string | null;
  history: { status: JobStatus; at: string }[];
  // Candidates queued to be prepared for the clip editor.
  preparing: string[];
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

// The Layout of the one Scene that holds `at` (seconds on the Source's timeline), in place of the
// Candidate's there. Auto chooses that Scene's by its faces.
export interface LayoutOverride {
  at: number;
  layout: Layout;
}

// The owner's correction of one caption Word, keyed by a time on the Source's timeline (the Word
// whose span holds it). `text` replaces the Word's (null keeps it; "" removes the Word).
export interface WordEdit {
  at: number;
  text: string | null;
  break_before: boolean;
}

export type Highlight = "colour" | "box" | "none";
export type CaptionPosition = "auto" | "top" | "middle" | "bottom" | "custom";
export type HookPosition = "top" | "middle" | "bottom" | "custom";
// How the hook comes on or goes off: at once, fading, popping from 70%, or sliding 60 px up.
export type Animation = "none" | "fade" | "pop" | "slide";

// How captions look and are broken into lines (backend/app/styles.py). Sizes are libass's, which
// sets a font so that its Windows ascent plus descent is the size (see FontInfo).
export interface CaptionStyle {
  font: string;
  size: number;
  colour: string;
  active_colour: string;
  outline: number;
  outline_colour: string;
  shadow: number;
  shadow_colour: string;
  uppercase: boolean;
  highlight: Highlight;
  position: CaptionPosition;
  // The line's centre, for the custom position.
  y: number;
  max_chars: number;
  max_words: number | null;
  max_secs: number;
  pause_secs: number;
}

// One box behind all the lines, a strip behind each, or none.
export type HookShape = "block" | "strips" | "none";
export type HookAlign = "center" | "left";

export interface HookStyle {
  shape: HookShape;
  font: string;
  size: number;
  // 1 to 4: the hook is set smaller only when even this many lines are too wide.
  max_lines: number;
  uppercase: boolean;
  align: HookAlign;
  colour: string;
  // Around and behind the text, in output pixels; the box has neither.
  outline: number;
  outline_colour: string;
  shadow: number;
  shadow_colour: string;
  box_colour: string;
  box_opacity: number;
  radius: number;
  position: HookPosition;
  // The box's top, for the custom position.
  y: number;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
}

export interface StylePreset {
  id: string;
  name: string;
  caption: CaptionStyle;
  hook: HookStyle;
  // Built-in Presets can't be changed or deleted.
  builtin: boolean;
}

export type StyleValue = string | number | boolean | null;

// The fields of the Preset's styles a Candidate replaces.
export interface StyleOverrides {
  caption: Partial<Record<keyof CaptionStyle, StyleValue>>;
  hook: Partial<Record<keyof HookStyle, StyleValue>>;
}

// The Render Plan (backend/app/planner.py), in output pixels (1080x1920) and seconds into the Clip.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPoint {
  at: number;
  x: number;
  y: number;
}

export interface Panel {
  area: Box;
  // The crop's size in Source pixels; `path` holds where it is from each change point on.
  crop_width: number;
  crop_height: number;
  path: CropPoint[];
  blur: boolean;
}

export type SceneLayout = "track" | "split" | "blur" | "passthrough";

export interface ScenePlan {
  start: number;
  end: number;
  layout: SceneLayout;
  panels: Panel[];
}

export interface CaptionEvent {
  text: string;
  start: number;
  end: number;
  // Each highlighted from its start to its end.
  words: Word[];
  area: Box;
  size: number;
}

export interface HookEvent {
  lines: string[];
  start: number;
  end: number;
  // Holds all of the hook.
  area: Box;
  size: number;
  // Each line's anchor: the middle of its text and its baseline.
  anchors: [number, number][];
  // Drawn behind the lines in the box colour: one block, a strip per line, or none.
  boxes: Box[];
}

export interface RenderPlan {
  start: number;
  end: number;
  source_width: number;
  source_height: number;
  fps: number;
  scenes: ScenePlan[];
  captions: CaptionEvent[];
  hook: HookEvent | null;
  caption_style: CaptionStyle;
  hook_style: HookStyle;
  width: number;
  height: number;
}

// A Word the captions are made of, as heard (in seconds into the Clip), with its Word Edit.
export interface PreviewWord extends Word {
  edit: WordEdit | null;
}

export interface PreviewPlan {
  plan: RenderPlan;
  words: PreviewWord[];
  // "clip": transcribed for the Clip; "transcript": the episode's, until it is.
  words_source: "clip" | "transcript";
  // False while the Clip is planned as one Scene, unanalysed.
  analysed: boolean;
}

export interface NewPreset {
  name: string;
  caption?: Partial<CaptionStyle>;
  hook?: Partial<HookStyle>;
}

// A bundled font and its measures in its units.
export interface FontInfo {
  id: string;
  label: string;
  family: string;
  // Windows ascent plus descent: libass's font size. A browser's is the em.
  units: number;
  em: number;
  ascent: number;
  cap_height: number;
  descent: number;
}

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
  // The owner has changed its bounds, hook text, layout or style.
  edited: boolean;
  preset_id: string;
  style_overrides: StyleOverrides;
  word_edits: WordEdit[];
  // When the hook comes on, in seconds into the Clip, and how long it stays.
  hook_start: number;
  hook_secs: number;
  layout_overrides: LayoutOverride[];
}

// A review edit: fields left out stay as they are. The backend snaps start and end to Words.
export interface CandidateChange {
  start?: number;
  end?: number;
  hook_text?: string;
  layout?: Layout;
  selected?: boolean;
  preset_id?: string;
  // Replaces the Candidate's overrides as a whole.
  style_overrides?: StyleOverrides;
  // Replaces the Candidate's Word Edits as a whole.
  word_edits?: WordEdit[];
  hook_start?: number;
  hook_secs?: number;
  // Replaces the Candidate's Layout Overrides as a whole.
  layout_overrides?: LayoutOverride[];
}

// A finished render: the Candidate as it was rendered, and its files (relative to the Job's directory).
export interface RenderedClip {
  start: number;
  end: number;
  hook_text: string;
  layout: Layout;
  video: string;
  poster: string;
  plan: string;
  duration: number;
  size_bytes: number;
  encoder: string;
  render_secs: number;
  at: string;
  // The clip editor's edits as rendered and the styles they resolved to; null in a Clip rendered
  // before the editor.
  preset_id: string | null;
  style_overrides: StyleOverrides | null;
  word_edits: WordEdit[] | null;
  hook_start: number | null;
  hook_secs: number | null;
  layout_overrides: LayoutOverride[] | null;
  caption_style: CaptionStyle | null;
  hook_style: HookStyle | null;
}

export type ClipStatus = "queued" | "rendering" | "done" | "error";

export interface Clip {
  candidate_id: string;
  // Where its latest render request is.
  status: ClipStatus;
  requested_at: string;
  // The latest finished render; kept while it is rendered again, and when that fails.
  output: RenderedClip | null;
  error: string | null;
}

export interface JobDetail extends Job {
  transcript: Transcript | null;
  // Best first; null until the Job has been analyzed.
  candidates: Candidate[] | null;
  // In their Candidates' order.
  clips: Clip[];
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

// How a hook text is shown on the Clip: its lines, and whether they fit at the hook's size (the
// render sets them smaller when they don't).
export interface HookFit {
  lines: string[];
  fits: boolean;
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
  // Newest first: a page of `limit`, the one before the Job created at `before` (the last listed).
  listJobs: (page: { limit: number; before?: string }) => {
    const query = new URLSearchParams({ limit: String(page.limit) });
    if (page.before) query.set("before", page.before);
    return request<Job[]>(`/jobs?${query}`);
  },
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  createJob: (job: NewJob) => request<Job>("/jobs", { method: "POST", body: JSON.stringify(job) }),
  retryJob: (id: string) => request<Job>(`/jobs/${id}/retry`, { method: "POST" }),
  deleteJob: (id: string) => request<void>(`/jobs/${id}`, { method: "DELETE" }),
  // Rejects with the backend's message (507) when an upload this size wouldn't fit on the disk.
  checkUpload: (size: number) => request<void>(`/jobs/upload/check?size=${size}`),
  updateCandidate: (jobId: string, id: string, change: CandidateChange) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  addCandidate: (jobId: string, range: { start: number; end: number }) =>
    request<Candidate>(`/jobs/${jobId}/candidates`, { method: "POST", body: JSON.stringify(range) }),
  // Queues Clips of the given Candidates, or of the selected ones; answers with the Job's Clips.
  render: (jobId: string, candidateIds?: string[]) =>
    request<Clip[]>(`/jobs/${jobId}/render`, {
      method: "POST",
      body: candidateIds ? JSON.stringify({ candidate_ids: candidateIds }) : undefined,
    }),
  listClips: (jobId: string) => request<Clip[]>(`/jobs/${jobId}/clips`),
  hookFit: (text: string, signal?: AbortSignal) => request<HookFit>(`/hook?text=${encodeURIComponent(text)}`, { signal }),
  listFonts: () => request<FontInfo[]>("/fonts"),
  // The Candidate's Render Plan, or that of an unsaved draft of its edits.
  previewPlan: (jobId: string, id: string, draft?: CandidateChange, signal?: AbortSignal) =>
    request<PreviewPlan>(`/jobs/${jobId}/candidates/${id}/preview-plan`, {
      method: "POST",
      body: draft ? JSON.stringify(draft) : undefined,
      signal,
    }),
  prepareCandidate: (jobId: string, id: string) =>
    request<Job>(`/jobs/${jobId}/candidates/${id}/prepare`, { method: "POST" }),
  listPresets: () => request<StylePreset[]>("/presets"),
  createPreset: (preset: NewPreset) => request<StylePreset>("/presets", { method: "POST", body: JSON.stringify(preset) }),
  updatePreset: (id: string, preset: NewPreset) =>
    request<StylePreset>(`/presets/${id}`, { method: "PUT", body: JSON.stringify(preset) }),
  deletePreset: (id: string) => request<void>(`/presets/${id}`, { method: "DELETE" }),
};

export const fontUrl = (id: string) => `/api/fonts/${encodeURIComponent(id)}`;

// A file from the Job's directory (such as "clips/<id>.mp4"), served with range support for the
// player. `version` tells a file rendered again from the one the browser has cached.
export const mediaUrl = (jobId: string, file: string, version?: string) =>
  `/media/${jobId}/${file.split("/").map(encodeURIComponent).join("/")}` +
  (version ? `?v=${encodeURIComponent(version)}` : "");

// A still of the Source where a Candidate starts. Its range is in the URL, so a trim fetches the new
// still rather than the cached one.
export const candidateThumbnailUrl = (jobId: string, candidate: Pick<Candidate, "id" | "start" | "end">) =>
  `/api/jobs/${jobId}/candidates/${candidate.id}/thumbnail?v=${candidate.start}-${candidate.end}`;

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Create a Job from a master file, streamed to the backend as multipart/form-data. XHR rather than
 * fetch, because only XHR reports upload progress. `abort()` cancels the upload, which then rejects
 * with an AbortError; the backend keeps nothing of it.
 */
export function uploadJob(
  file: File,
  options: Partial<JobOptions>,
  onProgress: (progress: UploadProgress) => void,
): { done: Promise<Job>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<Job>((resolve, reject) => {
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the status line
      }
      if (xhr.status === 201 && body) return resolve(body as Job);
      const detail = body?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((error: { msg: string }) => error.msg).join("; ")
            : `${xhr.status} ${xhr.statusText}`;
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload stopped: the connection to AI Clipper was lost."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
  });
  const form = new FormData();
  // The options go first: the backend checks them before it stores any of the file.
  form.append("options", JSON.stringify(options));
  form.append("file", file);
  xhr.open("POST", "/api/jobs/upload");
  xhr.send(form);
  return { done, abort: () => xhr.abort() };
}

export const jobEventsUrl = (id: string) => `/api/jobs/${id}/events`;
