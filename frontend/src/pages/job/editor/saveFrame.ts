import { api, type CandidateChange } from "../../../api";

// What a file name can't hold on macOS or Windows, replaced.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * The frame of a Clip `duration` long at `fps` that shows at `at` seconds into it: the last that
 * starts by then, within the Clip (as the backend's `shown_frame`).
 */
export function shownFrame(at: number, fps: number, duration: number): number {
  return Math.max(0, Math.min(Math.floor(at * fps + 1e-6), Math.ceil(duration * fps - 1e-6) - 1));
}

/** A saved frame's download name: `<title>-<mm.ss.ff>.png`, ff the frame within its second. */
export function frameFileName(title: string, at: number, fps: number, duration: number): string {
  const frame = shownFrame(at, fps, duration);
  const secs = Math.floor(frame / fps + 1e-6);
  const frames = frame - Math.ceil(secs * fps - 1e-6);
  const two = (n: number) => String(n).padStart(2, "0");
  const name = title.replace(UNSAFE, "-").trim() || "Frame";
  return `${name}-${two(Math.floor(secs / 60))}.${two(secs % 60)}.${two(frames)}.png`;
}

/**
 * Save the frame at `at` (Timeline time) of the Candidate as its `draft` shows it, as the render
 * draws it, and download it named after `title`; the PNG is given back, to add to the Media Library.
 */
export async function saveFrame(
  jobId: string,
  candidateId: string,
  draft: CandidateChange,
  at: number,
  name: string,
): Promise<File> {
  const saved = await api.saveFrame(jobId, candidateId, { at, draft });
  const response = await fetch(saved.url);
  if (!response.ok) throw new Error(`The frame couldn't be downloaded (${response.status})`);
  const file = new File([await response.blob()], name, { type: "image/png" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return file;
}
