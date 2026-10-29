import type { AgentAttachment, AgentImageType, Candidate } from "../../../../api";
import { formatClock } from "../../../../format";

// How many Agent Attachments go with one message (backend/app/agent/attachments.py).
export const MAX_ATTACHMENTS = 6;
// A text file's size, in bytes.
export const MAX_TEXT_BYTES = 50 * 1024;
// A referenced Candidate's name: its hook, cut to this many characters (as the backend names it).
const MAX_HOOK_NAME = 48;
// The text files the Agent reads, by extension: the file input's `accept`.
export const TEXT_FILE_TYPES = [".txt", ".md", ".srt", ".vtt", ".json", ".csv"];
// An image as it is sent: its base64, as Anthropic limits it (about 3.75 MB of image).
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;
// An image's long edge as it is sent, in pixels: models see little past it.
export const MAX_IMAGE_EDGE = 2048;
// A picture attached, in bytes: a bigger one is scaled down when sent, but one past this isn't read.
export const MAX_IMAGE_FILE_BYTES = 30 * 1024 * 1024;
// The JPEG qualities a picture too big to send as it is is re-encoded at, the first that fits going.
const JPEG_QUALITIES = [0.85, 0.7];
// The pictures the model sees: the image input's `accept`.
export const IMAGE_TYPES: AgentImageType[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/**
 * An image in the composer, until it is sent: its file, and an object URL of it for the chip's
 * thumbnail, which whoever drops the image revokes. Sent, it is read as base64 (`encodeAttachments`).
 */
export type DraftImage = { kind: "image"; name: string; media_type: AgentImageType; file: File; preview: string };
// What the composer holds: an image as a file, any other attachment as the turn request sends it.
export type DraftAttachment = Exclude<AgentAttachment, { kind: "image" }> | DraftImage;

const tooMany = `At most ${MAX_ATTACHMENTS} attachments go with a message.`;
const typesNamed = `${TEXT_FILE_TYPES.slice(0, -1).join(", ")} or ${TEXT_FILE_TYPES.at(-1)}`;
const isTextName = (name: string) => TEXT_FILE_TYPES.some((type) => name.toLowerCase().endsWith(type));

/**
 * `attached` with `files` added as text attachments, read in the browser, up to MAX_ATTACHMENTS.
 * A file that isn't one of TEXT_FILE_TYPES, holds a NUL (so isn't text) or whose text is over
 * MAX_TEXT_BYTES in UTF-8 (as the backend counts it) is left out; `error` says why the first was, or
 * that the limit was reached.
 */
export async function attachTextFiles(attached: DraftAttachment[], files: File[]): Promise<{ attached: DraftAttachment[]; error: string | null }> {
  // A file far bigger than its text could be isn't read at all.
  const read = await Promise.all(files.map(async (file) => ({ file, text: isTextName(file.name) && file.size <= 2 * MAX_TEXT_BYTES ? await file.text() : null })));
  let error: string | null = null;
  const added: DraftAttachment[] = [];
  for (const { file, text } of read) {
    const refused =
      !isTextName(file.name) || (text !== null && text.includes("\0"))
        ? `${file.name} isn't a text file: attach a ${typesNamed}.`
        : text === null || new TextEncoder().encode(text).length > MAX_TEXT_BYTES
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
 * `attached` with `files` added as images, up to MAX_ATTACHMENTS, each with a `preview` made by
 * `preview` (URL.createObjectURL). A file that isn't a PNG, JPEG, WebP or GIF, or is over
 * MAX_IMAGE_FILE_BYTES, is left out; `error` says why the first was, or that the limit was reached.
 * One too big to send as it is is scaled down when sent (`encodeAttachments`).
 */
export function attachImages(
  attached: DraftAttachment[],
  files: File[],
  preview: (file: File) => string = (file) => URL.createObjectURL(file),
): { attached: DraftAttachment[]; error: string | null } {
  let error: string | null = null;
  const added: DraftAttachment[] = [];
  for (const file of files) {
    const refused = !isImageType(file.type)
      ? `${file.name || "That"} isn't a picture the Agent can see: attach a PNG, JPEG, WebP or GIF.`
      : file.size > MAX_IMAGE_FILE_BYTES
        ? `${file.name || "That image"} is over ${MAX_IMAGE_FILE_BYTES / 1024 / 1024} MB.`
        : attached.length + added.length >= MAX_ATTACHMENTS
          ? tooMany
          : null;
    if (refused) error ??= refused;
    // A pasted screenshot comes unnamed.
    else added.push({ kind: "image", name: file.name || `Pasted image.${file.type.split("/")[1]}`, media_type: file.type as AgentImageType, file, preview: preview(file) });
  }
  return { attached: [...attached, ...added], error };
}

/** Whether a file dropped or pasted goes as an image (else as a text file). */
export const isImageFile = (file: File) => file.type.startsWith("image/");

const isImageType = (type: string): type is AgentImageType => (IMAGE_TYPES as string[]).includes(type);

/**
 * The attachments as the turn request sends them: each image read into base64, scaled down first when
 * it is too big to send as it is (`imageFit`). Throws, naming it, for one still too big scaled down.
 */
export async function encodeAttachments(attached: DraftAttachment[]): Promise<AgentAttachment[]> {
  return Promise.all(
    attached.map(async (attachment): Promise<AgentAttachment> => {
      if (attachment.kind !== "image") return attachment;
      const { media_type, bytes } = await fittedImage(attachment.file, attachment.media_type);
      const data = base64(bytes);
      if (data.length > MAX_IMAGE_BASE64) throw new Error(`${attachment.name} is too big to send, even scaled down: attach a smaller picture.`);
      return { kind: "image", name: attachment.name, media_type, data };
    }),
  );
}

/** The base64 length of `bytes` bytes. */
const base64Length = (bytes: number) => 4 * Math.ceil(bytes / 3);

/**
 * The size an image of `bytes` bytes at `width`×`height` is re-encoded at to be sent: null while it
 * goes as it is (its base64 at most MAX_IMAGE_BASE64, its long edge at most MAX_IMAGE_EDGE); else
 * its size with the long edge brought down to MAX_IMAGE_EDGE (unchanged when it is that already).
 */
export function imageFit({ bytes, width, height }: { bytes: number; width: number; height: number }): { width: number; height: number } | null {
  const edge = Math.max(width, height);
  if (base64Length(bytes) <= MAX_IMAGE_BASE64 && edge <= MAX_IMAGE_EDGE) return null;
  const scale = Math.min(1, MAX_IMAGE_EDGE / edge);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * An image's bytes as they are sent: as they are while they fit (`imageFit`), else drawn at the size
 * it gives and re-encoded as JPEG, at the first of JPEG_QUALITIES that fits. Without
 * createImageBitmap (an old browser, the tests) it goes as it is, for the backend to refuse when too big.
 */
async function fittedImage(file: File, media_type: AgentImageType): Promise<{ media_type: AgentImageType; bytes: Uint8Array }> {
  const asIs = async () => ({ media_type, bytes: new Uint8Array(await file.arrayBuffer()) });
  if (typeof createImageBitmap !== "function") return asIs();
  const bitmap = await createImageBitmap(file);
  try {
    const size = imageFit({ bytes: file.size, width: bitmap.width, height: bitmap.height });
    if (!size) return asIs();
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return asIs();
    // JPEG has no transparency: what was transparent goes white, not black.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    let blob: Blob | null = null;
    for (const quality of JPEG_QUALITIES) {
      blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
      if (blob && base64Length(blob.size) <= MAX_IMAGE_BASE64) break;
    }
    return blob ? { media_type: "image/jpeg", bytes: new Uint8Array(await blob.arrayBuffer()) } : asIs();
  } finally {
    bitmap.close();
  }
}

// In slices, as String.fromCharCode takes only so many arguments.
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  return btoa(binary);
}

/** `attached` without those of `sent` (the very ones: one attached since, however alike, stays). */
export const withoutSent = (attached: DraftAttachment[], sent: DraftAttachment[]) => attached.filter((attachment) => !sent.includes(attachment));

/**
 * `attached` with `attachment` added, unless it is already there (a Candidate referenced twice, the
 * Channel Profile twice) or
 * MAX_ATTACHMENTS are, which `error` then says.
 */
export function attach(attached: DraftAttachment[], attachment: DraftAttachment): { attached: DraftAttachment[]; error: string | null } {
  if (attached.some((each) => sameAttachment(each, attachment))) return { attached, error: null };
  if (attached.length >= MAX_ATTACHMENTS) return { attached, error: tooMany };
  return { attached: [...attached, attachment], error: null };
}

const sameAttachment = (a: DraftAttachment, b: DraftAttachment) =>
  a.kind === "channel_profile" ? b.kind === "channel_profile" : a.kind === "candidate" && b.kind === "candidate" && a.candidate_id === b.candidate_id;

// What the clip picker and a chip need of another Candidate of the Job.
export type ReferableClip = Pick<Candidate, "id" | "start" | "end" | "hook_text">;

/** The clip picker's rows: each of `clips` by its name and Source range, and whether it is `attached` already. */
export function clipChoices(clips: ReferableClip[], attached: DraftAttachment[]): { id: string; name: string; range: string; attached: boolean }[] {
  const referenced = new Set(attached.flatMap((each) => (each.kind === "candidate" ? [each.candidate_id] : [])));
  return clips.map((clip) => ({
    id: clip.id,
    name: hookName(clip.hook_text) || clip.id,
    range: `${formatClock(clip.start)}–${formatClock(clip.end)}`,
    attached: referenced.has(clip.id),
  }));
}

/** An attachment's name on its chip, as the chat will keep it: a file's name; a Candidate's hook (or id); "Channel Profile". */
export function attachmentName(attachment: AgentAttachment | DraftAttachment, clips: ReferableClip[]): string {
  if (attachment.kind === "text" || attachment.kind === "image") return attachment.name;
  if (attachment.kind === "channel_profile") return "Channel Profile";
  const clip = clips.find((each) => each.id === attachment.candidate_id);
  return (clip && hookName(clip.hook_text)) || attachment.candidate_id;
}

// A hook on one line without its Emphasis marks, cut to MAX_HOOK_NAME characters (code points, as
// attachments.py's _hook_name cuts it). The chat's chips take the backend's own name from turn_started.
function hookName(hook: string): string {
  const line = Array.from(hook.replaceAll("*", "").split(/\s+/).filter(Boolean).join(" "));
  return line.length <= MAX_HOOK_NAME ? line.join("") : `${line.slice(0, MAX_HOOK_NAME - 1).join("").trimEnd()}…`;
}
