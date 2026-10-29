import type { AgentAttachment, Candidate } from "../../../../api";
import { formatClock } from "../../../../format";

// How many Agent Attachments go with one message (backend/app/agent/attachments.py).
export const MAX_ATTACHMENTS = 6;
// A text file's size, in bytes.
export const MAX_TEXT_BYTES = 50 * 1024;
// A referenced Candidate's name: its hook, cut to this many characters (as the backend names it).
const MAX_HOOK_NAME = 48;
// The text files the Agent reads, by extension: the file input's `accept`.
export const TEXT_FILE_TYPES = [".txt", ".md", ".srt", ".vtt", ".json", ".csv"];

const tooMany = `At most ${MAX_ATTACHMENTS} attachments go with a message.`;
const typesNamed = `${TEXT_FILE_TYPES.slice(0, -1).join(", ")} or ${TEXT_FILE_TYPES.at(-1)}`;
const isTextName = (name: string) => TEXT_FILE_TYPES.some((type) => name.toLowerCase().endsWith(type));

/**
 * `attached` with `files` added as text attachments, read in the browser, up to MAX_ATTACHMENTS.
 * A file that isn't one of TEXT_FILE_TYPES, holds a NUL (so isn't text) or is over MAX_TEXT_BYTES is
 * left out; `error` says why the first was, or that the limit was reached.
 */
export async function attachTextFiles(attached: AgentAttachment[], files: File[]): Promise<{ attached: AgentAttachment[]; error: string | null }> {
  const read = await Promise.all(files.map(async (file) => ({ file, text: isTextName(file.name) && file.size <= MAX_TEXT_BYTES ? await file.text() : null })));
  let error: string | null = null;
  const added: AgentAttachment[] = [];
  for (const { file, text } of read) {
    const refused =
      !isTextName(file.name) || (text !== null && text.includes("\0"))
        ? `${file.name} isn't a text file: attach a ${typesNamed}.`
        : file.size > MAX_TEXT_BYTES
          ? `${file.name} is over ${MAX_TEXT_BYTES / 1024} KB.`
          : attached.length + added.length >= MAX_ATTACHMENTS
            ? tooMany
            : null;
    if (refused) error ??= refused;
    else added.push({ kind: "text", name: file.name, text: text ?? "" });
  }
  return { attached: [...attached, ...added], error };
}

/**
 * `attached` with `attachment` added, unless it is already there (a Candidate referenced twice) or
 * MAX_ATTACHMENTS are, which `error` then says.
 */
export function attach(attached: AgentAttachment[], attachment: AgentAttachment): { attached: AgentAttachment[]; error: string | null } {
  if (attached.some((each) => sameAttachment(each, attachment))) return { attached, error: null };
  if (attached.length >= MAX_ATTACHMENTS) return { attached, error: tooMany };
  return { attached: [...attached, attachment], error: null };
}

const sameAttachment = (a: AgentAttachment, b: AgentAttachment) => a.kind === "candidate" && b.kind === "candidate" && a.candidate_id === b.candidate_id;

// What the clip picker and a chip need of another Candidate of the Job.
export type ReferableClip = Pick<Candidate, "id" | "start" | "end" | "hook_text">;

/** The clip picker's rows: each of `clips` by its name and Source range, and whether it is `attached` already. */
export function clipChoices(clips: ReferableClip[], attached: AgentAttachment[]): { id: string; name: string; range: string; attached: boolean }[] {
  const referenced = new Set(attached.flatMap((each) => (each.kind === "candidate" ? [each.candidate_id] : [])));
  return clips.map((clip) => ({
    id: clip.id,
    name: hookName(clip.hook_text) || clip.id,
    range: `${formatClock(clip.start)}–${formatClock(clip.end)}`,
    attached: referenced.has(clip.id),
  }));
}

/** An attachment's name on its chip: a file's name; a Candidate's hook (or id), as the chat will keep it. */
export function attachmentName(attachment: AgentAttachment, clips: ReferableClip[]): string {
  if (attachment.kind === "text") return attachment.name;
  const clip = clips.find((each) => each.id === attachment.candidate_id);
  return (clip && hookName(clip.hook_text)) || attachment.candidate_id;
}

// A hook on one line without its Emphasis marks, cut to MAX_HOOK_NAME characters (attachments.py's _hook_name).
function hookName(hook: string): string {
  const line = hook.replaceAll("*", "").split(/\s+/).filter(Boolean).join(" ");
  return line.length <= MAX_HOOK_NAME ? line : `${line.slice(0, MAX_HOOK_NAME - 1).trimEnd()}…`;
}
