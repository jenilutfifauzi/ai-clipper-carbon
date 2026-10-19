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

// Roughly how long is left: "almost done", "40s left" or "2:10 left". Not to the second, since
// the estimate isn't.
export function formatTimeLeft(seconds: number): string {
  if (seconds <= 1) return "almost done";
  const whole = Math.round(seconds);
  return whole < 60 ? `${whole}s left` : `${formatClock(whole)} left`;
}

// A render's time left at its pace so far: the time since `startedAt` over the `percent` done,
// times what remains. None until it passes 2%, before which the pace says little.
export function timeLeft(startedAt: string, percent: number | null, now: number): string | null {
  if (percent === null || percent <= 2) return null;
  const done = percent / 100;
  const elapsed = Math.max(0, now - Date.parse(startedAt)) / 1000;
  return formatTimeLeft((elapsed / done) * (1 - done));
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

// The name a file of a Candidate downloads as (`extension` such as "mp4"): its title without the
// characters file systems refuse, or "clip-<id>" without one.
export function downloadName(title: string | undefined, candidateId: string, extension: string): string {
  const name = (title ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${name || `clip-${candidateId}`}.${extension}`;
}

// A still of what a Job is of: YouTube's own thumbnail, known from the URL before anything is
// downloaded, or a frame of the uploaded file once it's stored; null when there's none yet.
export function jobThumbnail(job: Pick<Job, "id" | "url" | "upload" | "source">): string | null {
  if (job.upload) return job.source ? `/api/jobs/${job.id}/thumbnail` : null;
  const id = youtubeId(job.url);
  return id ? `https://i.ytimg.com/vi/${id}/mqdefault.jpg` : null;
}

// The video in a YouTube URL (watch, youtu.be, live, shorts or embed form), or null; the rules of
// video_id in backend/app/references.py.
export function youtubeId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.includes("://") ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = parsed.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const path = parsed.pathname.split("/").filter(Boolean);
  let found = "";
  if (host === "youtu.be" && path.length === 1) found = path[0];
  else if (["youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host) && path.join("/") === "watch") {
    found = parsed.searchParams.get("v") ?? "";
  } else if (["youtube.com", "youtube-nocookie.com"].includes(host) && path.length === 2 && ["live", "shorts", "embed"].includes(path[0])) {
    found = path[1];
  }
  return /^[A-Za-z0-9_-]{11}$/.test(found) ? found : null;
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
