import { mainTrackOf, type Aspect, type Candidate, type Clip, type ExportPresetList, type ExportSettings, type RenderedClip, type SourceMetadata } from "../../api";
import { trackLength } from "./editor/segmentTime";

export const CODECS: Record<ExportSettings["codec"], string> = { h264: "H.264", hevc: "HEVC", av1: "AV1" };
export const QUALITIES: Record<ExportSettings["quality"], string> = { high: "High", recommended: "Recommended", smallest: "Smallest" };

/**
 * The Source's effective height, which a resolution above is "Larger than the Source": its short
 * side, as the resolution is the frame's (the "1080" of a 1080p video, landscape or portrait).
 */
export const sourceHeight = (metadata: Pick<SourceMetadata, "width" | "height">) => Math.min(metadata.width, metadata.height);

/** How long the Clips of `candidates` last in all: their Main Tracks, less their Transitions' overlaps. */
export function batchSecs(candidates: Pick<Candidate, "start" | "end" | "segments" | "transitions">[]): number {
  return candidates.reduce((sum, candidate) => {
    const segments = mainTrackOf(candidate);
    const joins = segments.map((segment) => candidate.transitions.find((transition) => transition.after === segment.id)?.secs ?? null);
    return sum + trackLength(segments, joins);
  }, 0);
}

/**
 * How long the Clips of `candidates` last in all of each Canvas Aspect, the aspects in their first
 * Candidate's order: a size is estimated per aspect, as a wide Clip has more pixels than a square one.
 */
export function batchParts(candidates: Pick<Candidate, "start" | "end" | "segments" | "transitions" | "aspect">[]): { aspect: Aspect; secs: number }[] {
  const aspects = [...new Set(candidates.map((candidate) => candidate.aspect))];
  return aspects.map((aspect) => ({ aspect, secs: batchSecs(candidates.filter((candidate) => candidate.aspect === aspect)) }));
}

/** The Export Preset the Render button renders with: the one picked this session while it exists, else the default. */
export function pickedPreset(list: ExportPresetList, picked: string | null): string {
  return picked !== null && list.presets.some((preset) => preset.id === picked) ? picked : list.default;
}

/**
 * The Export Preset "Render again" renders a Clip with: the one it was last asked for, or the
 * default once that is deleted (and for a Clip from before Export Presets).
 */
export function againPreset(
  list: ExportPresetList,
  clip: Pick<Clip, "export_preset_id"> & { output: Pick<RenderedClip, "export_preset_id"> | null },
): string {
  return pickedPreset(list, clip.export_preset_id ?? clip.output?.export_preset_id ?? null);
}

/**
 * What a Clip was made with, such as "1080p · H.264 · Recommended · −14 LUFS · Shorts / TikTok /
 * Reels": its Preset named while it exists. A Clip rendered before Export Presets was 1080p H.264.
 */
export function settingsLine(
  output: Pick<RenderedClip, "export_preset_id" | "export" | "bitrate_fallback">,
  list: ExportPresetList | null,
): string {
  const settings = output.export;
  if (!settings) return "1080p · H.264";
  const name = list?.presets.find((preset) => preset.id === output.export_preset_id)?.name;
  return [
    settings.resolution === 2160 ? "4K" : `${settings.resolution}p`,
    settings.fps !== null && `${settings.fps} fps`,
    CODECS[settings.codec],
    settings.bitrate ? `${settings.bitrate.mode.toUpperCase()} ${settings.bitrate.kbps} kb/s` : QUALITIES[settings.quality],
    settings.loudness === null ? "Loudness off" : `−${-settings.loudness} LUFS`,
    name,
  ]
    .filter(Boolean)
    .join(" · ");
}
