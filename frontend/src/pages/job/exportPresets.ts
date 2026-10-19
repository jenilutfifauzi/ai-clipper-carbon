import type { Clip, ExportPresetList, ExportSettings, RenderedClip } from "../../api";

const CODECS: Record<ExportSettings["codec"], string> = { h264: "H.264", hevc: "HEVC", av1: "AV1" };
const QUALITIES: Record<ExportSettings["quality"], string> = { high: "High", recommended: "Recommended", smallest: "Smallest" };

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
