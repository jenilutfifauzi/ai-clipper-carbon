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
  // Each line's centre, at any position (the backend keeps the line in the frame); null: centred.
  x: number | null;
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
  // Of the words marked *like this*.
  emphasis_colour: string;
  // Around and behind the text, in output pixels; the box has neither.
  outline: number;
  outline_colour: string;
  shadow: number;
  shadow_colour: string;
  box_colour: string;
  box_opacity: number;
  radius: number;
  // A badge with quote marks on the corner of the first line's box.
  quote: boolean;
  quote_colour: string;
  // The Kicker's text, and its pill.
  kicker_colour: string;
  kicker_box_colour: string;
  position: HookPosition;
  // The box's top, for the custom position.
  y: number;
  // Its middle, at any position (the backend keeps it in the frame); null: its lines centred.
  x: number | null;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
}

// Nothing, a line of text, or one of the Logos.
export type WatermarkKind = "none" | "text" | "logo";
// A corner, an edge's middle or the middle of the safe area; or custom, centred on (x, y).
export type WatermarkPosition =
  | "top_left"
  | "top"
  | "top_right"
  | "left"
  | "middle"
  | "right"
  | "bottom_left"
  | "bottom"
  | "bottom_right"
  | "custom";

// Shown over the whole Clip, under the captions and the hook.
export interface WatermarkStyle {
  kind: WatermarkKind;
  text: string;
  font: string;
  colour: string;
  // A thin black outline around the text.
  outline: boolean;
  // The Logo's id.
  logo: string | null;
  position: WatermarkPosition;
  // Its centre in output pixels, for the custom position.
  x: number;
  y: number;
  // How tall it is: the Logo's height, or the text's font size (libass's).
  size: number;
  opacity: number;
}

// An uploaded image a Watermark can show, kept as a PNG of this size.
export interface Logo {
  id: string;
  name: string;
  width: number;
  height: number;
  created: string;
}

export type MediaKind = "video" | "audio" | "image";

// A video, song or image in the Media Library (backend/app/media.py), normalized: its length (null
// for an image) and picture size (null for audio).
export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  size_bytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  has_audio: boolean;
  created: string;
}

// A Candidate that uses a Media Library item, as a refused delete names it.
export interface MediaUse {
  job_id: string;
  candidate_id: string;
  title: string;
}

export interface StylePreset {
  id: string;
  name: string;
  caption: CaptionStyle;
  hook: HookStyle;
  watermark: WatermarkStyle;
  // Built-in Presets can't be changed or deleted.
  builtin: boolean;
}

export type StyleValue = string | number | boolean | null;

// The fields of the Preset's styles a Candidate replaces.
export interface StyleOverrides {
  caption: Partial<Record<keyof CaptionStyle, StyleValue>>;
  hook: Partial<Record<keyof HookStyle, StyleValue>>;
  watermark: Partial<Record<keyof WatermarkStyle, StyleValue>>;
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

// "fill": a Media Library video cropped to fill the frame.
export type SceneLayout = "track" | "split" | "blur" | "passthrough" | "fill";

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
  // Each line's emphasised runs, as [start, end) ranges of its characters.
  emphasis: [number, number][][];
  // Above the lines; null without one.
  kicker: HookKicker | null;
  // The Quote Mark's badge; null without one.
  quote: Box | null;
}

// The Kicker's text at font `size` on its pill, placed by its anchor (the middle of its text and its baseline).
export interface HookKicker {
  text: string;
  size: number;
  box: Box;
  anchor: [number, number];
}

// The Watermark in `area` for the whole Clip: the text at font `size`, centred in it, or the Logo filling it.
export interface WatermarkEvent {
  kind: WatermarkKind;
  area: Box;
  opacity: number;
  text: string;
  size: number;
  logo: string | null;
}

export type TextAlign = "center" | "left" | "right";

// A free text overlay of the Advanced Edit (backend/app/candidates.py): its text (lines split at
// newlines) from `start` for `secs` in Timeline time, centred on (x, y) in output pixels.
export interface TextLayer {
  id: string;
  text: string;
  start: number;
  secs: number;
  x: number;
  y: number;
  font: string;
  // libass's, as the captions'.
  size: number;
  colour: string;
  outline: number;
  outline_colour: string;
  box: boolean;
  box_colour: string;
  box_opacity: number;
  align: TextAlign;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
}

// A Text Layer as drawn: its lines at font `size`, each placed by its anchor (the middle of its text
// and its baseline), in `area`; `box` is the area when it has one.
export interface TextEvent {
  layer: TextLayer;
  lines: string[];
  start: number;
  end: number;
  area: Box;
  size: number;
  anchors: [number, number][];
  box: Box | null;
}

// A song (or a video's sound) from the Media Library under the Clip: `secs` of it from `offset`
// seconds into the file, heard from `start` in Timeline time, at `volume` (0 to 2), faded in and out.
export interface MusicClip {
  id: string;
  media: string;
  start: number;
  secs: number;
  offset: number;
  volume: number;
  fade_in: number;
  fade_out: number;
}

// A Music Clip as heard, cut where the Clip or its song ends.
export interface AudioEvent {
  media: string;
  start: number;
  end: number;
  offset: number;
  volume: number;
  fade_in: number;
  fade_out: number;
}

// A video or image from the Media Library laid over the Clip: from `start` for `secs` in Timeline
// time (a video from `offset` into it), centred on (x, y), `size` pixels wide, at `opacity`, a
// video's sound at `volume` (0, muted, by default).
export interface Overlay {
  id: string;
  media: string;
  start: number;
  secs: number;
  offset: number;
  x: number;
  y: number;
  size: number;
  opacity: number;
  volume: number;
}

// An Overlay as drawn: scaled into `area`, from `start` to `end`; `image` for a still.
export interface OverlayEvent {
  media: string;
  area: Box;
  start: number;
  end: number;
  offset: number;
  opacity: number;
  image: boolean;
}

// How one Segment gives way to the next (ffmpeg's xfade transitions of these names).
export type TransitionKind =
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "wipeleft"
  | "zoomin"
  | "circleopen";

// A Transition from the Segment `after` into the next, the two overlapping by `secs` (0.2 to 1.5).
export interface Transition {
  after: string;
  kind: TransitionKind;
  secs: number;
}

// A Transition as drawn, from `start` to `end` seconds into the Clip.
export interface TransitionEvent {
  kind: TransitionKind;
  start: number;
  end: number;
}

// A Segment of a Clip cut into several, as played: the Source from `source_start` to `source_end`,
// from `start` to `end` seconds into the Clip.
export interface SegmentPlan {
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  // A Media Library video's instead of the Source's, its sound at `volume` (none when `silent`).
  media: string | null;
  volume: number;
  silent: boolean;
  // How many of the plan's Scenes, in order, are its.
  scenes: number;
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
  watermark: WatermarkEvent | null;
  watermark_style: WatermarkStyle;
  // The Text Layers that show, in drawing order.
  texts: TextEvent[];
  // The Music Clips heard, under the Clip's own sound at `source_volume`.
  audio: AudioEvent[];
  source_volume: number;
  // A Clip cut into several Segments: each, in order; [] for a Clip of one range.
  segments: SegmentPlan[];
  // Laid over the Segments, in drawing order.
  overlays: OverlayEvent[];
  // Between Segments, in order.
  transitions: TransitionEvent[];
}

// A Word the captions are made of, as heard (in seconds into the Clip), with its middle on the
// Source's timeline (what a Word Edit of it is keyed by) and its Word Edit.
export interface PreviewWord extends Word {
  edit: WordEdit | null;
  at: number;
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
  watermark?: Partial<WatermarkStyle>;
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

// How a Media Library video fills the vertical frame: cropped to fill it, or whole over its blur.
export type Fit = "fill" | "blur";

// A piece of a Candidate's Main Track (docs/adr/0002-segments-and-timeline-time.md): the Source
// from `start` to `end`, snapped to Words; or, with `media`, a Media Library video from `start` to
// `end` seconds into it, filled as `fit` says, its own sound at `volume`.
export interface ClipSegment {
  id: string;
  start: number;
  end: number;
  media?: string | null;
  fit?: Fit;
  volume?: number;
}

export interface Candidate {
  id: string;
  // On the Source's timeline; with several Segments, the hull of what they show.
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
  // A short label in a pill above the hook; "" for none.
  hook_kicker: string;
  // The Advanced Edit's, drawn in this order (the last on top).
  text_layers: TextLayer[];
  // Its Music Clips, under its own sound at `source_volume` (0 to 2).
  music: MusicClip[];
  source_volume: number;
  // Its Main Track; [] (one piece, from `start` to `end`) unless the Advanced Edit has cut it.
  segments: ClipSegment[];
  // Laid over the Main Track, the last on top.
  overlays: Overlay[];
  // Between its Segments, each by the Segment it follows.
  transitions: Transition[];
  // Its saved state's number: each save that changes it makes the next (ADR 0003).
  revision: number;
}

// A Candidate's Main Track: its Segments, or its one range.
export const mainTrackOf = (candidate: Pick<Candidate, "start" | "end" | "segments">): ClipSegment[] =>
  candidate.segments.length ? candidate.segments : [{ id: "main", start: candidate.start, end: candidate.end }];

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
  hook_kicker?: string;
  // Replaces the Candidate's Text Layers as a whole.
  text_layers?: TextLayer[];
  // Replaces the Candidate's Music Clips as a whole.
  music?: MusicClip[];
  source_volume?: number;
  // Replaces the Main Track as a whole; one Segment is kept as `start` and `end`.
  segments?: ClipSegment[];
  // Replaces the Candidate's Overlays as a whole.
  overlays?: Overlay[];
  // Replaces the Candidate's Transitions as a whole; those without a join are left out.
  transitions?: Transition[];
  // The Revision the change was made from: refused (409) if the Candidate has moved past it.
  revision?: number;
}

// Which editor saves an edit, so that other editors can say who changed a Candidate.
export type EditSource = "advanced-edit" | "clip-editor";
// Who saved a Revision: an editor, the agent (MCP), a Restore, or unknown (a CLI run, an older caller);
// "original" for a Candidate as Selection (or the owner, for a manual one) made it.
export type SavedBy = EditSource | "agent" | "restore" | "unknown" | "original";

// This tab's id, sent with its edits: its own saves are then told apart from another tab's.
export const TAB_ID = crypto.randomUUID();

// An entry of a Candidate's Revision History: the last of a stretch of saves from one editor (in one
// tab), with the parts it changed since the entry before.
export interface RevisionEntry {
  revision: number;
  // null when it isn't known (a state written by another process).
  at: string | null;
  source: SavedBy;
  tab: string | null;
  parts: string[];
}

// A new Revision of one of a Job's Candidates, from its Candidate events: who saved it (`tab` for an
// editor's), and the parts it changed since the one before, as the editors name them.
export interface CandidateEvent {
  candidate: Candidate;
  source: SavedBy;
  tab: string | null;
  parts: string[];
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
  // "" in a Clip rendered before Kickers.
  hook_kicker: string;
  // null in a Clip rendered before Watermarks.
  watermark_style: WatermarkStyle | null;
  // [] in a Clip rendered before Text Layers, and before music.
  text_layers: TextLayer[];
  music: MusicClip[];
  source_volume: number;
  segments: ClipSegment[];
  overlays: Overlay[];
  transitions: Transition[];
  // The Candidate's Revision it was rendered from; null in a Clip rendered before Revisions.
  revision: number | null;
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

export interface NewJob {
  url: string;
  options: Partial<JobOptions>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // What the backend said besides its message, such as a refused delete's uses.
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // A FormData body sets its own multipart type, with its boundary.
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const [message, detail] = await errorMessage(response);
    throw new ApiError(response.status, message, detail);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// The Candidate as it is now, when a save was refused for being made from an older Revision.
export function staleCandidate(reason: unknown): Candidate | null {
  if (!(reason instanceof ApiError) || reason.status !== 409) return null;
  const detail = reason.detail as { candidate?: Candidate } | undefined;
  return detail?.candidate ?? null;
}

// FastAPI's `detail`: a message, a list of validation errors, or an object with a message.
async function errorMessage(response: Response): Promise<[string, unknown]> {
  try {
    const { detail } = await response.json();
    return [detailMessage(detail) ?? `${response.status} ${response.statusText}`, detail];
  } catch {
    // not JSON: fall through to the status line
  }
  return [`${response.status} ${response.statusText}`, undefined];
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((error: { msg: string }) => error.msg).join("; ");
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  return null;
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
  updateCandidate: (jobId: string, id: string, change: CandidateChange, source: EditSource) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(change),
      headers: { "X-Edit-Source": source, "X-Edit-Tab": TAB_ID },
    }),
  // The Candidate's Revision History, newest first.
  listRevisions: (jobId: string, id: string) =>
    request<{ revisions: RevisionEntry[] }>(`/jobs/${jobId}/candidates/${id}/revisions`).then((answer) => answer.revisions),
  // Saves the Candidate as it was at Revision `restore`, as its next Revision; refused (409) when it
  // has moved past `revision`.
  restoreRevision: (jobId: string, id: string, restore: number, revision: number, source: EditSource) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}/revisions/${restore}/restore`, {
      method: "POST",
      body: JSON.stringify({ revision }),
      headers: { "X-Edit-Source": source, "X-Edit-Tab": TAB_ID },
    }),
  addCandidate: (jobId: string, range: { start: number; end: number }) =>
    request<Candidate>(`/jobs/${jobId}/candidates`, { method: "POST", body: JSON.stringify(range) }),
  // Queues Clips of the given Candidates, or of the selected ones; answers with the Job's Clips.
  render: (jobId: string, candidateIds?: string[]) =>
    request<Clip[]>(`/jobs/${jobId}/render`, {
      method: "POST",
      body: candidateIds ? JSON.stringify({ candidate_ids: candidateIds }) : undefined,
    }),
  listClips: (jobId: string) => request<Clip[]>(`/jobs/${jobId}/clips`),
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
  listLogos: () => request<Logo[]>("/logos"),
  // A PNG, JPEG or WebP image of 5 MB at most; rejects with the backend's message otherwise.
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Logo>("/logos", { method: "POST", body: form });
  },
  deleteLogo: (id: string) => request<void>(`/logos/${id}`, { method: "DELETE" }),
  listMedia: () => request<MediaItem[]>("/media"),
  // Rejects with an ApiError of 409 whose detail lists the clips using it.
  deleteMedia: (id: string) => request<void>(`/media/${id}`, { method: "DELETE" }),
};

export const fontUrl = (id: string) => `/api/fonts/${encodeURIComponent(id)}`;
export const logoUrl = (id: string) => `/api/logos/${encodeURIComponent(id)}`;
// A Media Library item's normalized file, a video's small copy for the preview, and its still.
export const mediaItemUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
export const mediaProxyUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/proxy`;
export const mediaThumbnailUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/thumbnail`;
// A video's Filmstrip chunk from `start` seconds, a multiple of 30 (docs/adr/0005-timeline-media-is-derived-per-chunk.md).
export const mediaFilmstripUrl = (id: string, start: number) => `/api/media/${encodeURIComponent(id)}/filmstrip/v1/${start}.jpg`;

// A file from the Job's directory (such as "clips/<id>.mp4"), served with range support for the
// player. `version` tells a file rendered again from the one the browser has cached.
export const mediaUrl = (jobId: string, file: string, version?: string) =>
  `/media/${jobId}/${file.split("/").map(encodeURIComponent).join("/")}` +
  (version ? `?v=${encodeURIComponent(version)}` : "");

// A still of the Source where a Candidate starts. Its range is in the URL, so a trim fetches the new
// still rather than the cached one.
export const candidateThumbnailUrl = (jobId: string, candidate: Pick<Candidate, "id" | "start" | "end">) =>
  `/api/jobs/${jobId}/candidates/${candidate.id}/thumbnail?v=${candidate.start}-${candidate.end}`;

// A Filmstrip chunk of the Job's Source from `start` seconds, a multiple of 30, made when first asked for.
export const jobFilmstripUrl = (jobId: string, start: number) => `/api/jobs/${encodeURIComponent(jobId)}/filmstrip/v1/${start}.jpg`;

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
export const candidateEventsUrl = (id: string) => `/api/jobs/${id}/candidates/events`;

/**
 * Upload a video, song or image to the Media Library, with its upload progress (XHR, as uploadJob).
 * The backend converts it before it answers, so the upload reaching 100% isn't the end.
 */
export function uploadMedia(file: File, onProgress: (progress: UploadProgress) => void): { done: Promise<MediaItem>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<MediaItem>((resolve, reject) => {
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the status line
      }
      if (xhr.status === 201 && body) return resolve(body as MediaItem);
      reject(new ApiError(xhr.status, detailMessage(body?.detail) ?? `${xhr.status} ${xhr.statusText}`, body?.detail));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload stopped: the connection to AI Clipper was lost."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
  });
  const form = new FormData();
  form.append("file", file);
  xhr.open("POST", "/api/media");
  xhr.send(form);
  return { done, abort: () => xhr.abort() };
}
