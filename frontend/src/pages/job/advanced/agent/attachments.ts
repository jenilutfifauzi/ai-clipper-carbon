import type { AgentAttachment } from "../../../../api";

// How many Agent Attachments go with one message (backend/app/agent/attachments.py).
export const MAX_ATTACHMENTS = 6;
// A text file's size, in bytes.
export const MAX_TEXT_BYTES = 50 * 1024;
// The text files the Agent reads, by extension: the file input's `accept`.
export const TEXT_FILE_TYPES = [".txt", ".md", ".srt", ".vtt", ".json", ".csv"];

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
            ? `At most ${MAX_ATTACHMENTS} attachments go with a message.`
            : null;
    if (refused) error ??= refused;
    else added.push({ kind: "text", name: file.name, text: text ?? "" });
  }
  return { attached: [...attached, ...added], error };
}
