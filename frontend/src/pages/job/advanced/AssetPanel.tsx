import type { ReactNode } from "react";
import type { ClipSegment, FontInfo, MediaItem, ShapeKind, Transcript } from "../../../api";
import type { AssetTab } from "./Chrome";
import { SourcePicker } from "./MainTrack";
import { MediaAssets, mediaSections, type MediaCategory, type MediaLanguages, type MediaLibrary } from "./MediaLibrary";
import { ShapeAssets } from "./Shapes";
import type { UntimedTextLayer } from "./TextLayers";
import { TextAssets } from "./TextPresets";

/**
 * An asset tab's content: the Text Presets; the Shapes (the Stickers tab); the Media tab, by its
 * `category` (the episode's moments, the Media Library's videos and images, its songs); the Narrate tab (a script read aloud); the Transitions; the Looks (the Filters tab); or
 * the Video Effects (the Effects tab); or the Templates, one applied to the whole Clip. Each added at the playhead by a click, or (but a Shape, a Look
 * and an effect) where it is dropped on the timeline; a Look is given to the Pick's Grades, or the
 * Candidate's, and an effect to the Pick's stacks.
 */
export function AssetPanel({
  tab,
  category = "all",
  fonts,
  library,
  transcript,
  near,
  transitions,
  filters,
  effects,
  narrate,
  templates,
  onAddText,
  onAddShape,
  onAddMusic,
  onAddSource,
  onAddVideo,
  onAddOverlay,
  languages,
}: {
  tab: AssetTab;
  // The Media tab's category (MediaCategories).
  category?: MediaCategory;
  fonts: FontInfo[] | null;
  library: MediaLibrary;
  transcript: Transcript | null;
  // Where the episode's transcript opens: the Clip's first Segment.
  near: ClipSegment;
  transitions: ReactNode;
  filters: ReactNode;
  effects: ReactNode;
  narrate: ReactNode;
  // The Templates tab (desktop) or sheet (phone): TemplatesPanel.
  templates: ReactNode;
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
    const shown = mediaSections(category);
    // In All, the videos and images first, then the songs, each under its heading.
    const headed = shown.sections.length > 1;
    return (
      <div className="flex flex-col gap-4">
        {shown.source && transcript && <SourcePicker transcript={transcript} near={near} onAdd={onAddSource} />}
        {shown.sections.map((kinds, i) => {
          const audio = kinds.includes("audio");
          const section = audio ? (
            <MediaAssets
              library={library}
              kinds={kinds}
              onAdd={onAddMusic}
              uploads={i === 0}
              hint="Click to add at the playhead, or drag onto the Audio track."
              details={
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  <li>MP3, M4A, WAV or AAC, up to 50 MB. Kept for every Job.</li>
                  <li>Use music you have the rights to: the platforms mute or take down clips that don't.</li>
                </ul>
              }
            />
          ) : (
            <MediaAssets
              library={library}
              kinds={kinds}
              onAdd={onAddVideo}
              addable={(item) => item.kind === "video"}
              onOverlay={onAddOverlay}
              languages={languages}
              uploads={i === 0}
              hint="Click to add, or drag onto the timeline."
              details={
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  <li>A video goes after the Segment at the playhead, or where you drop it on the Video track.</li>
                  <li>An image, or a video added with its layers button, goes over the clip, or onto the Overlay track.</li>
                  <li>MP4, MOV or WebM videos up to 3 minutes (500 MB); PNG, JPEG or WebP images up to 5 MB. Kept for every Job.</li>
                </ul>
              }
            />
          );
          return headed ? (
            <section key={kinds.join()} className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{audio ? "Audio" : "Videos and images"}</h3>
              {section}
            </section>
          ) : (
            <div key={kinds.join()}>{section}</div>
          );
        })}
      </div>
    );
  }
  if (tab === "narrate") return narrate;
  if (tab === "filters") return filters;
  if (tab === "effects") return effects;
  if (tab === "templates") return templates;
  return transitions;
}
