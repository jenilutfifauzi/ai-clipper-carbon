import type { JobStatus } from "./api";

const LABELS: Record<JobStatus, string> = {
  queued: "Menunggu",
  downloading: "Mengunduh",
  transcribing: "Transkripsi",
  analyzing: "Analisis AI",
  review: "Siap ditinjau",
  rendering: "Merender",
  waiting_quota: "Menunggu kuota",
  error: "Gagal",
};

export function statusLabel(status: string): string {
  return (LABELS as Record<string, string>)[status] ?? status;
}

/** A Job in one of these waits on a person, so polling it only spends battery and data. */
export function isSettled(status: string): boolean {
  return status === "review" || status === "error";
}
