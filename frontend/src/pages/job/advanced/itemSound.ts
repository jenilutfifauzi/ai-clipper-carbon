// Save sound as WAV (.scratch/audio-mixing/spec.md): a Segment's, Music Clip's or video Overlay's
// sound alone, as it is heard in the Clip, made by the backend from the draft (the unsaved edits
// too) and downloaded by the browser.
import type { MediaItem, SoundKind } from "../../../api";
import type { AdvancedEdits } from "./edits";
import type { ItemRef } from "./pick";

// What "Save sound as WAV" saves of an item.
export interface ItemSound {
  kind: SoundKind;
  id: string;
  // How a notice names it: "Segment 2", the song's name, "the episode's sound", "Overlay intro".
  name: string;
  // Why it has no sound to save, when it hasn't: the menu's entry is then off, saying so.
  silent: string | null;
}

/**
 * The sound "Save sound as WAV" would save of `item`: a Segment's (not a Freeze frame's, nor a
 * silent video's), a Music Clip's, or a video Overlay's (not an image's, nor one turned down to
 * nothing); null for an item that has no sound at all (a Text Layer, a Shape) or is gone. Muted
 * items have theirs: the WAV is the item as heard but for that.
 */
export function itemSound(item: ItemRef, edits: AdvancedEdits, mediaById: Map<string, MediaItem>): ItemSound | null {
  if (item.kind === "segment") {
    const index = edits.segments.findIndex((segment) => segment.id === item.id);
    const segment = edits.segments[index];
    if (!segment) return null;
    const silent =
      segment.hold != null
        ? "A Freeze frame is silent"
        : segment.media && mediaById.get(segment.media)?.has_audio === false
          ? "Its video has no sound"
          : null;
    return { kind: "segment", id: item.id, name: `Segment ${index + 1}`, silent };
  }
  if (item.kind === "music") {
    const clip = edits.music.find((music) => music.id === item.id);
    if (!clip) return null;
    const song = clip.media ? mediaById.get(clip.media) : undefined;
    const name = !clip.media ? "the episode's sound" : (song?.name ?? "Music Clip");
    return { kind: "music", id: item.id, name, silent: song?.has_audio === false ? "Its video has no sound" : null };
  }
  if (item.kind === "overlay") {
    const overlay = edits.overlays.find((shown) => shown.id === item.id);
    if (!overlay) return null;
    const video = mediaById.get(overlay.media);
    const silent =
      video?.kind === "image"
        ? "An image has no sound"
        : video?.has_audio === false
          ? "Its video has no sound"
          : overlay.volume <= 0 && !overlay.keys.volume?.length
            ? "Its sound is turned down to nothing"
            : null;
    return { kind: "overlay", id: item.id, name: `Overlay ${video?.name ?? ""}`.trim(), silent };
  }
  return null;
}

/** The file name a Content-Disposition header gives (its UTF-8 `filename*` first); null without one. */
export function attachmentName(header: string | null): string | null {
  if (!header) return null;
  const encoded = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // not percent-encoded as it should be: the plain name, if any
    }
  }
  const plain = header.match(/filename\s*=\s*(?:"([^"]*)"|([^;]+))/i);
  return plain ? (plain[1] ?? plain[2]).trim() : null;
}

// How long a downloaded file's object URL is kept for the browser to start saving it.
const REVOKE_AFTER_MS = 60_000;

/** Has the browser save `blob` as `name`, as a link with `download` does. */
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}
