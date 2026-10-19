import { api, type CandidateChange, type SavedExport } from "../../../api";
import { fileTitle } from "../../../format";

/**
 * A saved frame's download name: the Candidate's `title` in place of its id in the name the backend
 * gave it, `<candidate>-<mm.ss.ff>.png`, so the time is the backend's.
 */
export function frameFileName(title: string, candidateId: string, saved: Pick<SavedExport, "name">): string {
  return fileTitle(title, candidateId) + saved.name.slice(candidateId.length);
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
  title: string,
): Promise<File> {
  const saved = await api.saveFrame(jobId, candidateId, { at, draft });
  const response = await fetch(saved.url);
  if (!response.ok) throw new Error(`The frame couldn't be downloaded (${response.status})`);
  const name = frameFileName(title, candidateId, saved);
  const file = new File([await response.blob()], name, { type: "image/png" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(file);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  return file;
}
