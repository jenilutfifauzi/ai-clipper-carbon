// A Clip's downloads, named after its Candidate's title: its MP4 and its caption files (SRT and VTT),
// from the Clips list and from the Advanced Edit's menu.

// A Candidate's title as a file name, without the characters file systems refuse; `clip-<id>` for a
// Candidate with no title, or none left once they are taken out.
export function clipFileName(title: string | undefined, candidateId: string): string {
  const name = (title ?? "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return name || `clip-${candidateId}`;
}

// Hands the browser `text` to save as `name`, as a link with `download` would.
export function saveText(text: string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // After the click has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
