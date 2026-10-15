import { Music, Type } from "lucide-react";
import { mediaThumbnailUrl, type MediaItem, type MusicClip, type Overlay, type RenderPlan, type TextLayer, type TransitionKind } from "../../../api";
import { cx, formatPrecise } from "../../../format";
import type { PlayedSegment, Playback } from "../editor/playback";
import { TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { DRAG_MEDIA, DRAG_TEXT, DRAG_TRANSITION } from "./drag";
import { ITEM_MIN_SECS, round, trackLanes, type AdvancedEdits } from "./edits";
import { SEGMENT_MIN_SECS } from "./MainTrack";
import { isPicked, keyOf, picked, toggled, type ItemRef, type Pick } from "./pick";

// The hook's shortest and longest time (hook_secs in backend/app/api.py).
const HOOK_MIN_SECS = 0.5;
const HOOK_MAX_SECS = 30;

// Where a Media Library item dropped on the timeline goes.
export type DropTrack = "segment" | "overlay" | "music";

export interface TrackHandlers {
  onSelect: (pick: Pick) => void;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) => void;
  onJoin: (after: string) => void;
  onDropTransition: (after: string, kind: TransitionKind) => void;
  // A Media Library item (its id) or a Text Layer's look (its name) dropped at `time`.
  onDropMedia: (track: DropTrack, media: string, time: number) => void;
  onDropText: (look: string, time: number) => void;
  // Deletes the picked items.
  onDelete?: () => void;
}

// How far into a caption line a click on it seeks, so that the line shows.
const CAPTION_SEEK_IN = 0.05;

/**
 * The tracks, top to bottom: the Text Layers' lanes, the Overlays' lanes, the Main Track (its
 * Segments as played over their Scenes, and the joins between them), the caption lines, the hook,
 * and the Music Clips' lanes. Each track takes what is dropped on it from the asset panel.
 */
export function Tracks({
  geometry,
  duration,
  plan,
  edits,
  pick,
  played,
  playback,
  mediaById,
  handlers,
  changed,
}: {
  geometry: TimeGeometry;
  duration: number;
  plan: RenderPlan | null;
  edits: AdvancedEdits;
  pick: Pick;
  // The Main Track as it plays: snapped to Words once the plan has it, cut short at Transitions.
  played: PlayedSegment[];
  playback: Playback;
  // The Media Library, by id: names, lengths and stills.
  mediaById: Map<string, MediaItem>;
  handlers: TrackHandlers;
  // The items just changed in another editor, by id ("hook" for the hook).
  changed: Set<string>;
}) {
  const { pps } = geometry;
  const { onSelect, onDelete } = handlers;
  // An item clicked: picked alone, or added to the Pick or taken out of it.
  const choose = (item: ItemRef) => (toggle: boolean) => onSelect(toggle ? toggled(pick, item) : picked(item));
  const hookEnd = Math.min(edits.hook_start + edits.hook_secs, duration);
  // The first lane next to the video, later ones above it; one row even when empty, to drop on.
  const lanes = <T extends { start: number; secs: number }>(items: T[], upward: boolean) => {
    const found = trackLanes(items);
    return found.length ? (upward ? found.reverse() : found) : [[] as T[]];
  };
  const dropMedia = (track: DropTrack) => ({
    types: [DRAG_MEDIA],
    onDrop: (data: DataTransfer, clientX: number) => handlers.onDropMedia(track, data.getData(DRAG_MEDIA), geometry.timeAt(clientX)),
  });
  const textLanes = lanes(edits.text_layers, true);
  const overlayLanes = lanes(edits.overlays, true);
  const musicLanes = lanes(edits.music, false);
  return (
    <>
      {textLanes.map((lane, i) => (
        <TrackRow
          key={`text${textLanes.length - i}`}
          label={i === textLanes.length - 1 ? "Text" : ""}
          drop={{ types: [DRAG_TEXT], onDrop: (data, clientX) => handlers.onDropText(data.getData(DRAG_TEXT), geometry.timeAt(clientX)) }}
        >
          {lane.map((layer) => {
            const selected = isPicked(pick, "text", layer.id);
            return (
              <TimelineItem
                key={layer.id}
                geometry={geometry}
                start={layer.start}
                end={Math.min(layer.start + layer.secs, duration)}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                tone="text"
                selected={selected}
                changed={changed.has(layer.id)}
                label={`Text "${layer.text}", from ${layer.start.toFixed(1)} s for ${layer.secs.toFixed(1)} s`}
                pickKey={keyOf({ kind: "text", id: layer.id })}
                onSelect={choose({ kind: "text", id: layer.id })}
                onChange={({ start, end }, group) => handlers.onText({ ...layer, start: round(start), secs: round(end - start) }, group)}
                onDelete={selected ? onDelete : undefined}
              >
                <Type aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium">{layer.text.split("\n").join(" ") || "Empty text"}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      {overlayLanes.map((lane, i) => (
        <TrackRow key={`overlay${overlayLanes.length - i}`} label={i === overlayLanes.length - 1 ? "Overlay" : ""} drop={dropMedia("overlay")}>
          {lane.map((overlay) => {
            const selected = isPicked(pick, "overlay", overlay.id);
            const item = mediaById.get(overlay.media);
            const length = item?.duration ?? Infinity;
            return (
              <TimelineItem
                key={overlay.id}
                geometry={geometry}
                start={overlay.start}
                end={Math.min(overlay.start + overlay.secs, duration)}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                maxSecs={length - overlay.offset}
                trimMin={item?.duration != null ? overlay.start - overlay.offset : undefined}
                tone="overlay"
                selected={selected}
                changed={changed.has(overlay.id)}
                label={`Overlay ${item?.name ?? ""}, from ${overlay.start.toFixed(1)} s for ${overlay.secs.toFixed(1)} s`}
                pickKey={keyOf({ kind: "overlay", id: overlay.id })}
                onSelect={choose({ kind: "overlay", id: overlay.id })}
                onChange={({ start, end, edge }, group) =>
                  handlers.onOverlay(
                    {
                      ...overlay,
                      start: round(start),
                      secs: round(end - start),
                      // Trimming a video's start starts it later in the video.
                      offset: edge === "start" && item?.duration != null ? round(Math.max(0, overlay.offset + start - overlay.start)) : overlay.offset,
                    },
                    group,
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <img src={mediaThumbnailUrl(overlay.media)} alt="" className="h-6 w-auto shrink-0 rounded-sm" />
                <span className="truncate font-medium">{item?.name ?? "Overlay"}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      <TrackRow label="Video" height="h-14" drop={dropMedia("segment")}>
        {/* The Scenes as planned, under the Segments. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-1 left-0 overflow-hidden rounded-md bg-surface-raised" style={{ width: duration * pps }}>
          {plan?.scenes.map((scene, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-l border-border px-1.5 pt-5 text-[10px] font-medium text-muted capitalize first:border-l-0"
              style={{ left: scene.start * pps, width: (scene.end - scene.start) * pps }}
            >
              {(scene.end - scene.start) * pps > 48 ? (scene.layout === "passthrough" ? "As shot" : scene.layout) : ""}
            </span>
          ))}
        </div>
        {played.map((shown, i) => {
          const segment = edits.segments[i];
          if (!segment) return null;
          const selected = isPicked(pick, "segment", segment.id);
          const volume = segment.media ? 1 : edits.source_volume * (segment.volume ?? 1);
          return (
            <TimelineItem
              key={segment.id}
              geometry={geometry}
              start={shown.start}
              end={shown.end}
              min={-1e6}
              max={1e6}
              minSecs={SEGMENT_MIN_SECS}
              tone="video"
              selected={selected}
              changed={changed.has(segment.id)}
              label={`Segment ${i + 1}, ${formatPrecise(shown.source_start)} to ${formatPrecise(shown.source_end)} of ${segment.media ? "its video" : "the episode"}`}
              pickKey={keyOf({ kind: "segment", id: segment.id })}
              onSelect={choose({ kind: "segment", id: segment.id })}
              onChange={(moved, group) => handlers.onSegment(segment.id, moved, group)}
              onDelete={selected ? onDelete : undefined}
            >
              {segment.media && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-black bg-size-[auto_100%] bg-repeat-x opacity-80"
                  style={{ backgroundImage: `url(${mediaThumbnailUrl(segment.media)})` }}
                />
              )}
              <span className="relative self-start rounded bg-black/50 px-1 pt-0.5 text-[11px] font-medium text-white tabular-nums">
                {segment.media ? (mediaById.get(segment.media)?.name ?? "Video") : formatPrecise(shown.source_start)}
                {volume !== 1 ? ` · ${Math.round(volume * 100)}%` : ""}
              </span>
            </TimelineItem>
          );
        })}
        {/* The joins, for Transitions: a diamond between each two Segments, filled when it has one. */}
        {played.slice(0, -1).map((shown, i) => {
          const after = edits.segments[i]?.id;
          if (!after) return null;
          const transition = edits.transitions.find((t) => t.after === after);
          const selected = pick?.kind === "join" && pick.after === after;
          return (
            <button
              key={`join-${after}`}
              type="button"
              onClick={() => handlers.onJoin(after)}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(DRAG_TRANSITION)) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
              onDrop={(event) => {
                const kind = event.dataTransfer.getData(DRAG_TRANSITION) as TransitionKind;
                if (!kind) return;
                event.stopPropagation();
                handlers.onDropTransition(after, kind);
              }}
              aria-pressed={selected}
              aria-label={transition ? `Transition after Segment ${i + 1}: ${transition.kind}` : `Join after Segment ${i + 1}: add a transition`}
              title={transition ? `${transition.kind}, ${transition.secs.toFixed(2)} s` : "Add a transition"}
              className={cx(
                "absolute top-1/2 z-10 size-5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[4px] ring-2 ring-bg",
                "focus-visible:outline-2 focus-visible:outline-focus",
                transition ? "bg-accent" : "bg-surface-raised hover:bg-fill",
                selected && "ring-text",
              )}
              style={{ left: shown.end * pps }}
            />
          );
        })}
      </TrackRow>
      <TrackRow label="Captions" height="h-8">
        {plan?.captions.map((event, i) => (
          <button
            key={i}
            type="button"
            onClick={() => {
              // Just inside the line, which a frame's rounding of its start can miss.
              playback.seek(event.start + Math.min(CAPTION_SEEK_IN, (event.end - event.start) / 2));
              onSelect({ kind: "captions" });
            }}
            title={event.text}
            aria-pressed={pick?.kind === "captions"}
            className={cx(
              "absolute inset-y-1 overflow-hidden rounded bg-fill px-1 text-left text-[11px] leading-5 text-ellipsis whitespace-nowrap text-muted ring-1 ring-border hover:text-text",
              pick?.kind === "captions" && "text-text ring-text",
            )}
            style={{ left: event.start * pps, width: Math.max(2, (event.end - event.start) * pps - 1) }}
          >
            {event.text}
          </button>
        ))}
      </TrackRow>
      <TrackRow label="Hook">
        {plan?.hook && (
          <TimelineItem
            geometry={geometry}
            start={edits.hook_start}
            end={hookEnd}
            max={duration}
            minSecs={HOOK_MIN_SECS}
            maxSecs={HOOK_MAX_SECS}
            tone="waiting"
            selected={pick?.kind === "hook"}
            changed={changed.has("hook")}
            label={`Hook, from ${edits.hook_start.toFixed(1)} s for ${(hookEnd - edits.hook_start).toFixed(1)} s`}
            onSelect={() => onSelect({ kind: "hook" })}
            onChange={({ start, end }, group) => handlers.onEdits({ ...edits, hook_start: round(start), hook_secs: round(end - start) }, group)}
          >
            <span className="truncate font-medium">{plan.hook.lines.join(" ")}</span>
          </TimelineItem>
        )}
      </TrackRow>
      {musicLanes.map((lane, i) => (
        <TrackRow key={`music${i}`} label={i === 0 ? "Audio" : ""} drop={dropMedia("music")}>
          {lane.map((clip) => {
            const selected = isPicked(pick, "music", clip.id);
            const song = mediaById.get(clip.media);
            const length = song?.duration ?? clip.offset + clip.secs;
            return (
              <TimelineItem
                key={clip.id}
                geometry={geometry}
                start={clip.start}
                end={Math.min(clip.start + clip.secs, duration)}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                maxSecs={length - clip.offset}
                trimMin={clip.start - clip.offset}
                tone="audio"
                selected={selected}
                changed={changed.has(clip.id)}
                label={`Music ${song?.name ?? ""}, from ${clip.start.toFixed(1)} s for ${clip.secs.toFixed(1)} s`}
                pickKey={keyOf({ kind: "music", id: clip.id })}
                onSelect={choose({ kind: "music", id: clip.id })}
                onChange={({ start, end, edge }, group) =>
                  handlers.onMusic(
                    {
                      ...clip,
                      start: round(start),
                      secs: round(end - start),
                      // Trimming its start starts it later in the song.
                      offset: edge === "start" ? round(Math.max(0, clip.offset + start - clip.start)) : clip.offset,
                    },
                    group,
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <Music aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium">{song?.name ?? "Music"}</span>
                {clip.volume !== 1 && <span className="shrink-0 opacity-70 tabular-nums">{Math.round(clip.volume * 100)}%</span>}
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
    </>
  );
}
