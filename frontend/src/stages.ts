import type { JobProgress, JobStatus } from "./api";

// The stages the Job page lists, in order. Review is where the pipeline ends; Clips are rendered
// from there, as often as the owner asks.
export const STAGES = [
  { status: "downloading", label: "Download", noun: "download" },
  { status: "transcribing", label: "Transcript", noun: "transcription" },
  { status: "analyzing", label: "Analyze", noun: "analysis" },
  { status: "review", label: "Review", noun: "review" },
  { status: "rendering", label: "Render", noun: "rendering" },
] as const satisfies readonly { status: JobStatus; label: string; noun: string }[];

export type StageState = "pending" | "active" | "waiting" | "failed" | "done";

// The statuses in which the Job is still on its way to review or error, so its list entry changes by itself.
export const ACTIVE: ReadonlySet<JobStatus> = new Set([
  "queued",
  "downloading",
  "transcribing",
  "analyzing",
  "rendering",
  "waiting_quota",
]);

export function stageIndex(status: JobStatus | null): number {
  return STAGES.findIndex((stage) => stage.status === status);
}

export function stageLabel(status: JobStatus | null): string {
  return STAGES.find((stage) => stage.status === status)?.label ?? "Queue";
}

// For sentences: "Failed during transcription".
export function stageNoun(status: JobStatus | null): string {
  return STAGES.find((stage) => stage.status === status)?.noun ?? "the queue";
}

/**
 * Each stage's state. `reached` is the furthest stage the Job has been in, so that a Job queued
 * again (after a retry or a quota wait) keeps the stages it has finished; it resumes after them.
 * In review, Render is done once the Job has rendered.
 */
export function stageStates(progress: JobProgress, reached: number): StageState[] {
  const { status, stage } = progress;
  if (status === "review") return STAGES.map((_, i) => (i <= Math.max(reached, stageIndex("review")) ? "done" : "pending"));
  const current =
    status === "error" || status === "waiting_quota" ? stageIndex(stage) : stageIndex(status);
  return STAGES.map((_, i) => {
    if (current === -1) return i < reached ? "done" : "pending";
    if (i < current) return "done";
    if (i > current) return "pending";
    return status === "error" ? "failed" : status === "waiting_quota" ? "waiting" : "active";
  });
}
