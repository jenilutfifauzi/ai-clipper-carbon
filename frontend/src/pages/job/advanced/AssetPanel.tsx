import type { ReactNode } from "react";
import type { ClipSegment, FontInfo, MediaItem, TextLayer, Transcript } from "../../../api";
import type { AssetTab } from "./Chrome";
import { SourcePicker } from "./MainTrack";
import { MediaAssets, type MediaLibrary } from "./MediaLibrary";
import { TextAssets } from "./TextLayers";

/**
 * An asset tab's content: the Text Layers' looks; the episode's moments and the Media Library's
 * videos and images; its songs; or the Transitions. Each added at the playhead by a click, or where
 * it is dropped on the timeline.
 */
export function AssetPanel({
  tab,
  fonts,
  library,
  transcript,
  near,
  transitions,
  onAddText,
  onAddMusic,
  onAddSource,
  onAddVideo,
  onAddOverlay,
}: {
  tab: AssetTab;
  fonts: FontInfo[] | null;
  library: MediaLibrary;
  transcript: Transcript | null;
  // Where the episode's transcript opens: the Clip's first Segment.
  near: ClipSegment;
  transitions: ReactNode;
  onAddText: (look: Omit<TextLayer, "id" | "start" | "secs">) => void;
  onAddMusic: (item: MediaItem) => void;
  onAddSource: (range: { start: number; end: number }) => void;
  onAddVideo: (item: MediaItem) => void;
  onAddOverlay: (item: MediaItem) => void;
}) {
  if (tab === "text") return <TextAssets fonts={fonts} onAdd={onAddText} />;
  if (tab === "media") {
    return (
      <div className="flex flex-col gap-4">
        {transcript && <SourcePicker transcript={transcript} near={near} onAdd={onAddSource} />}
        <MediaAssets
          library={library}
          kinds={["video", "image"]}
          onAdd={onAddVideo}
          addable={(item) => item.kind === "video"}
          onOverlay={onAddOverlay}
          hint="Videos up to 3 minutes (500 MB) and PNG, JPEG or WebP images up to 5 MB, kept for every Job. Click a video to put it after the Segment at the playhead, or drag it onto the Video track; an image (or a video with its layers button) goes over the clip, or drag it onto the Overlay track."
        />
      </div>
    );
  }
  if (tab === "audio") {
    return (
      <MediaAssets
        library={library}
        kinds={["audio"]}
        onAdd={onAddMusic}
        hint="MP3, M4A, WAV or AAC songs up to 50 MB, kept for every Job. Click to add at the playhead, or drag onto the Audio track. Use music you have the rights to: the platforms mute or take down clips that don't."
      />
    );
  }
  return transitions;
}
