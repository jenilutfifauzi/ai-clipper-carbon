// Formatting shared by the pages.

import type { Job } from "./api";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

// Decimal units, as Finder and the backend's 10 GB threshold count them.
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit >= 3 ? 1 : 0)} ${units[unit]}`;
}

// A position on the Source's timeline: "4:05" or "1:02:03".
export function formatClock(seconds: number): string {
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

// A Candidate's edge, to the tenth of a second: "4:05.3".
export function formatPrecise(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  return `${formatClock(Math.floor(tenths / 10))}.${tenths % 10}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["second", 60],
  ["minute", 60],
  ["hour", 24],
  ["day", 7],
  ["week", 4.35],
  ["month", 12],
  ["year", Infinity],
];

// "2 minutes ago", "yesterday".
export function formatRelative(iso: string): string {
  let value = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(value) < size) return relative.format(Math.round(value), unit);
    value /= size;
  }
  return iso;
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// What a Job is of: its uploaded file's name, or its shortened URL.
export function jobTitle(job: Pick<Job, "url" | "upload">): string {
  return job.upload ? job.upload.name : shortUrl(job.url);
}

// A YouTube URL shortened to what tells episodes apart: its video id.
export function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("v") ?? parsed.pathname.split("/").filter(Boolean).pop();
    return id ? `${parsed.hostname.replace(/^www\./, "")} · ${id}` : url;
  } catch {
    return url;
  }
}
