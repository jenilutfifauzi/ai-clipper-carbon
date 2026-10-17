import type { ReactNode } from "react";
import type { ClipSegment, FontInfo, MediaItem, TextLayer, Transcript } from "../../../api";
import type { AssetTab } from "./Chrome";
import { SourcePicker } from "./MainTrack";
import { MediaAssets, type MediaLibrary } from "./MediaLibrary";
import { TextAssets } from "./TextPresets";

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
  onAddText: (look: Omit<TextLayer, "id" | "start" | "secs" | "keys">) => void;
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
          hint="Click to add, or drag onto the timeline."
          details={
            <ul className="flex list-disc flex-col gap-1 pl-4">
              <li>A video goes after the Segment at the playhead, or where you drop it on the Video track.</li>
              <li>An image, or a video added with its layers button, goes over the clip, or onto the Overlay track.</li>
              <li>MP4, MOV or WebM videos up to 3 minutes (500 MB); PNG, JPEG or WebP images up to 5 MB. Kept for every Job.</li>
            </ul>
          }
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
        hint="Click to add at the playhead, or drag onto the Audio track."
        details={
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>MP3, M4A, WAV or AAC, up to 50 MB. Kept for every Job.</li>
            <li>Use music you have the rights to: the platforms mute or take down clips that don't.</li>
          </ul>
        }
      />
    );
  }
  return transitions;
}
