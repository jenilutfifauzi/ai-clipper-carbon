import type { ReactNode } from "react";
import type { ClipSegment, FontInfo, MediaItem, ShapeKind, Transcript } from "../../../api";
import type { AssetTab } from "./Chrome";
import { SourcePicker } from "./MainTrack";
import { MediaAssets, type MediaLanguages, type MediaLibrary } from "./MediaLibrary";
import { ShapeAssets } from "./Shapes";
import type { UntimedTextLayer } from "./TextLayers";
import { TextAssets } from "./TextPresets";

/**
 * An asset tab's content: the Text Presets; the Shapes (the Stickers tab); the episode's moments and
 * the Media Library's videos and images; its songs; the Transitions; or the Looks (the Filters tab).
 * Each added at the playhead by a click, or (but a Shape and a Look) where it is dropped on the
 * timeline; a Look is given to the Pick's Grades, or the Candidate's.
 */
export function AssetPanel({
  tab,
  fonts,
  library,
  transcript,
  near,
  transitions,
  filters,
  onAddText,
  onAddShape,
  onAddMusic,
  onAddSource,
  onAddVideo,
  onAddOverlay,
  languages,
}: {
  tab: AssetTab;
  fonts: FontInfo[] | null;
  library: MediaLibrary;
  transcript: Transcript | null;
  // Where the episode's transcript opens: the Clip's first Segment.
  near: ClipSegment;
  transitions: ReactNode;
  filters: ReactNode;
  onAddText: (made: UntimedTextLayer) => void;
  onAddShape: (kind: ShapeKind) => void;
  onAddMusic: (item: MediaItem) => void;
  onAddSource: (range: { start: number; end: number }) => void;
  onAddVideo: (item: MediaItem) => void;
  onAddOverlay: (item: MediaItem) => void;
  // Each video's language for its Media Words, set from its card.
  languages?: MediaLanguages;
}) {
  if (tab === "text") return <TextAssets fonts={fonts} onAdd={onAddText} />;
  if (tab === "stickers") return <ShapeAssets onAdd={onAddShape} />;
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
          languages={languages}
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
  if (tab === "filters") return filters;
  return transitions;
}
