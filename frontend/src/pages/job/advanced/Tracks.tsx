import { Eye, EyeOff, Lock, LockOpen, Mic, Music, Square, Type, Volume2, VolumeX } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  jobFilmstripUrl,
  jobPeaksUrl,
  mediaFilmstripUrl,
  mediaPeaksUrl,
  mediaThumbnailUrl,
  type MediaItem,
  type MusicClip,
  type Overlay,
  type RenderPlan,
  type Retiming,
  type Shape,
  type ShapeKind,
  type SourceMetadata,
  type TextLayer,
  type TransitionKind,
} from "../../../api";
import { Button } from "../../../components/Button";
import { Switch } from "../../../components/Switch";
import { cx, formatPrecise } from "../../../format";
import { valueAt } from "../editor/keyframes";
import { setMagnetic, useMagnetic } from "../editor/magnetic";
import type { PlayedSegment, Playback } from "../editor/playback";
import { offsetAt, overlayTime, rangeOf } from "../editor/segmentTime";
import { gestureRetime } from "./actions";
import { ItemHandle, TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { DRAG_MEDIA, DRAG_SHAPE, DRAG_TEXT, DRAG_TRANSITION } from "./drag";
import { fadesWithin, ITEM_MIN_SECS, keptOffset, round, trackLanes, type AdvancedEdits } from "./edits";
import { filmstripLayer } from "./filmstrip";
import { ItemCanvas } from "./ItemCanvas";
import { MEDIA_MIN_SECS, SEGMENT_MIN_SECS } from "./MainTrack";
import type { MediaCache } from "./mediaCache";
import { clicked, isPicked, itemsOf, keyOf, picked, type ItemRef, type Pick } from "./pick";
import { useKeyTime } from "./KeyCluster";
import { keyTime } from "./keying";
import { HOOK_MIN_SECS } from "./ripple";
import { speedLabel } from "./speed";
import { gainAt, segmentHeard, sourceGain, sourceHeard, underSourceVolume, volumeDragged, volumeHeight, volumeLine, type Heard } from "./timelineView";
import { musicName } from "./Music";
import { TRACKS, type TrackControl, type TrackKind, type TrackState } from "./trackState";
import { waveformLayer } from "./waveform";

// The hook's longest time (hook_secs in backend/app/api.py).
const HOOK_MAX_SECS = 30;

// Where a Media Library item dropped on the timeline goes.
export type DropTrack = "segment" | "overlay" | "music";

export interface TrackHandlers {
  onSelect: (pick: Pick) => void;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onShape: (shape: Shape, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (id: string, moved: { start: number; end: number; edge: "move" | "start" | "end" }, group: string) => void;
  // The picked Text Layers, Shapes, Music Clips and Overlays moved `delta` seconds, together.
  onMove: (delta: number, group: string) => void;
  // A Music Clip's or media Segment's volume set by its Volume Line.
  onVolume: (item: { kind: "music" | "segment"; id: string }, volume: number, group: string) => void;
  // A Music Clip's or Segment's fade in or fade out set by its Fade Ramp's handle. `heard`: the
  // seconds of it heard, where the Clip's end cuts it short or a Transition after it carries it on.
  onFade: (id: string, fade: "fade_in" | "fade_out", secs: number, heard: number, group: string) => void;
  onJoin: (after: string) => void;
  onDropTransition: (after: string, kind: TransitionKind) => void;
  // A Media Library item (its id), a Text Preset (its id) or a Stickers tile (its Shape Kind) dropped at `time`.
  onDropMedia: (track: DropTrack, media: string, time: number) => void;
  onDropText: (preset: string, time: number) => void;
  onDropShape: (kind: ShapeKind, time: number) => void;
  // Deletes the picked items; `rippled` (Shift), closing their gaps.
  onDelete?: (rippled: boolean) => void;
}

// A Waveform's colour on a Music Clip (its lane's), and on a media or Source Segment, where it takes
// the bottom MEDIA_WAVE_BAND pixels of the frames.
const SONG_WAVE = "oklch(0.68 0.14 160 / 0.75)";
const MEDIA_WAVE = "rgb(255 255 255 / 0.8)";
const MEDIA_WAVE_BAND = 14;

// How far into a caption line a click on it seeks, so that the line shows.
const CAPTION_SEEK_IN = 0.05;

/**
 * The tracks, top to bottom: the Text Layers' lanes, the Shapes' lanes, the Overlays' lanes, the
 * Main Track (its Segments as played over their Scenes, and the joins between them), the caption
 * lines, the hook, and the Music Clips' lanes. Each track takes what is dropped on it from the
 * asset panel.
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
  mediaCache,
  source,
  handlers,
  changed,
  picking = false,
  tracks,
  onTrack,
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
  // The Filmstrips' and Peaks' chunks, as fetched and decoded.
  mediaCache: MediaCache;
  // The Job, and its Source's length and size, for the Source Segments' Filmstrips.
  source: { job: string; metadata: SourceMetadata };
  handlers: TrackHandlers;
  // The items just changed in another editor, by id ("hook" for the hook).
  changed: Set<string>;
  // In picking mode (a phone's), where a tap adds an item to the Pick or takes it out.
  picking?: boolean;
  // What is hidden, muted and locked; with `onTrack` (a desktop's), each Track's label has its buttons.
  tracks: TrackState;
  onTrack?: (control: TrackControl, kind: TrackKind) => void;
}) {
  const { pps } = geometry;
  const { onSelect, onDelete } = handlers;
  // A Shape, Music Clip or Overlay trimmed: its Keyframes re-anchored from where they were as the drag began.
  const [retime] = useState(gestureRetime);
  // An item clicked: picked alone, or added to the Pick or taken out of it (always, in picking mode).
  const choose = (item: ItemRef) => (toggle: boolean) => onSelect(clicked(pick, item, toggle || picking));
  // A picked item of several dragged or trimmed (or a Segment moved): picked alone.
  const alone = (item: ItemRef) => {
    if (itemsOf(pick).length > 1) onSelect(picked(item));
  };
  // A Text Layer, Shape, Music Clip or Overlay dragged or trimmed, from `now` (its start): moved with the
  // other picked ones when it is picked with others, else changed alone by `update`.
  const layerChanged = (item: ItemRef, now: number, { start, edge }: { start: number; edge: "move" | "start" | "end" }, group: string, update: () => void) => {
    if (edge === "move" && isPicked(pick, item.kind, item.id) && itemsOf(pick).length > 1) {
      handlers.onMove(round(start) - now, group);
      return;
    }
    alone(item);
    update();
  };
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
  const label = (kind: TrackKind) => <TrackLabel kind={kind} tracks={tracks} onTrack={onTrack} />;
  const dimmed = (kind: TrackKind) => tracks.hidden.includes(kind);
  const locked = (kind: TrackKind) => tracks.locked.includes(kind);
  const textLanes = lanes(edits.text_layers, true);
  const shapeLanes = lanes(edits.shapes, true);
  const overlayLanes = lanes(edits.overlays, true);
  const musicLanes = lanes(edits.music, false);
  return (
    <>
      {textLanes.map((lane, i) => (
        <TrackRow
          key={`text${textLanes.length - i}`}
          label={i === textLanes.length - 1 ? label("text") : ""}
          dimmed={dimmed("text")}
          locked={locked("text")}
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
                onChange={(range, group) =>
                  layerChanged({ kind: "text", id: layer.id }, layer.start, range, group, () =>
                    handlers.onText({ ...layer, start: round(range.start), secs: round(range.end - range.start) }, group),
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <Type aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium">{layer.text.split("\n").join(" ") || "Empty text"}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      {shapeLanes.map((lane, i) => (
        <TrackRow
          key={`shape${shapeLanes.length - i}`}
          label={i === shapeLanes.length - 1 ? label("shape") : ""}
          dimmed={dimmed("shape")}
          locked={locked("shape")}
          drop={{ types: [DRAG_SHAPE], onDrop: (data, clientX) => handlers.onDropShape(data.getData(DRAG_SHAPE) as ShapeKind, geometry.timeAt(clientX)) }}
        >
          {lane.map((shape) => {
            const selected = isPicked(pick, "shape", shape.id);
            return (
              <TimelineItem
                key={shape.id}
                geometry={geometry}
                start={shape.start}
                end={Math.min(shape.start + shape.secs, duration)}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                tone="shape"
                selected={selected}
                changed={changed.has(shape.id)}
                label={`Shape, ${shape.style.kind}, from ${shape.start.toFixed(1)} s for ${shape.secs.toFixed(1)} s`}
                pickKey={keyOf({ kind: "shape", id: shape.id })}
                onSelect={choose({ kind: "shape", id: shape.id })}
                onChange={({ start, end, edge }, group) =>
                  layerChanged({ kind: "shape", id: shape.id }, shape.start, { start, edge }, group, () =>
                    handlers.onShape(retime(shape, { ...shape, start: round(start), secs: round(end - start) }, edge, group), group),
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <Square aria-hidden size={12} className="shrink-0" />
                <span className="truncate font-medium capitalize">{shape.style.kind}</span>
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      {overlayLanes.map((lane, i) => (
        <TrackRow
          key={`overlay${overlayLanes.length - i}`}
          label={i === overlayLanes.length - 1 ? label("overlay") : ""}
          dimmed={dimmed("overlay")}
          locked={locked("overlay")}
          drop={dropMedia("overlay")}
        >
          {lane.map((overlay) => {
            const selected = isPicked(pick, "overlay", overlay.id);
            const item = mediaById.get(overlay.media);
            const length = item?.duration ?? Infinity;
            // A video at a Speed plays that many of its seconds in each of the Timeline's. In
            // Reverse its left edge shows the end of its part of the video, and its right edge the
            // start (its offset): trimmed, each reaches as far as the video goes that way, to where
            // it would show the video's start or end.
            const video = item?.duration != null;
            const until = overlay.start + overlay.secs;
            const time = overlayTime(overlay);
            const reach = {
              before: overlay.start + offsetAt(time, overlay.reverse ? length : 0),
              after: overlay.start + offsetAt(time, overlay.reverse ? 0 : length),
            };
            return (
              <TimelineItem
                key={overlay.id}
                geometry={geometry}
                start={overlay.start}
                end={Math.min(until, duration)}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                trimMin={video ? reach.before : undefined}
                trimMax={video ? reach.after : undefined}
                tone="overlay"
                selected={selected}
                changed={changed.has(overlay.id)}
                label={`Overlay ${item?.name ?? ""}, from ${overlay.start.toFixed(1)} s for ${overlay.secs.toFixed(1)} s${retimingName(overlay)}${overlay.muted ? ", Muted" : ""}`}
                pickKey={keyOf({ kind: "overlay", id: overlay.id })}
                onSelect={choose({ kind: "overlay", id: overlay.id })}
                onChange={({ start, end, edge }, group) =>
                  layerChanged({ kind: "overlay", id: overlay.id }, overlay.start, { start, edge }, group, () =>
                    handlers.onOverlay(
                      retime(
                        overlay,
                        {
                          ...overlay,
                          start: round(start),
                          secs: round(end - start),
                          // Trimmed, a video shows the part of it its edges now reach.
                          offset: edge !== "move" && video ? keptOffset(overlay, start - overlay.start, end - overlay.start) : overlay.offset,
                        },
                        edge,
                        group,
                      ),
                      group,
                    ),
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                <img src={mediaThumbnailUrl(overlay.media)} alt="" className="h-6 w-auto shrink-0 rounded-sm" />
                <span className="truncate font-medium">{item?.name ?? "Overlay"}</span>
                <RetimingBadge retiming={overlay} />
                {overlay.muted && <MutedBadge />}
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
      <TrackRow label={label("video")} height="h-14" dimmed={dimmed("video")} locked={locked("video")} drop={dropMedia("segment")}>
        {/* The Scenes' lane, under the Segments. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-1 left-0 rounded-md bg-surface-raised" style={{ width: duration * pps }} />
        {played.map((shown, i) => {
          const segment = edits.segments[i];
          if (!segment) return null;
          const selected = isPicked(pick, "segment", segment.id);
          const volume = segment.media ? 1 : sourceGain(edits, segment);
          // Heard on under the Transition into the next one, past what is drawn of it, as planned.
          const handsOver = edits.transitions.some((transition) => transition.after === segment.id);
          const whole = handsOver ? plan?.segments.find((other) => other.id === segment.id) : undefined;
          const tail = whole && Math.abs(whole.start - shown.start) < 1e-6 ? Math.max(0, whole.end - shown.end) : 0;
          // Its sound, by its volume Keyframes once it has some, through its fades.
          const heard = segmentHeard(segment, shown, tail);
          const keyed = !!segment.keys?.volume?.length;
          // A Freeze frame is silent: no Waveform, no Volume Line and no Fade Ramps.
          const held = segment.hold != null;
          // Muted, its Waveform is flat and dimmed, with no Volume Line nor Fade Ramps, and a crossed speaker.
          const muted = !held && !!segment.muted;
          return (
            <TimelineItem
              key={segment.id}
              geometry={geometry}
              start={shown.start}
              end={shown.end}
              min={-1e6}
              max={1e6}
              minSecs={held ? MEDIA_MIN_SECS : SEGMENT_MIN_SECS}
              tone="video"
              selected={selected}
              changed={changed.has(segment.id)}
              label={`Segment ${i + 1}, ${formatPrecise(shown.source_start)} to ${formatPrecise(shown.source_end)} of ${segment.media ? "its video" : "the episode"}${retimingName(segment)}${held ? `, held ${holdLabel(segment.hold!)}` : ""}${muted ? ", Muted" : ""}`}
              pickKey={keyOf({ kind: "segment", id: segment.id })}
              onSelect={choose({ kind: "segment", id: segment.id })}
              onChange={(moved, group) => {
                alone({ kind: "segment", id: segment.id });
                handlers.onSegment(segment.id, moved, group);
              }}
              onDelete={selected ? onDelete : undefined}
            >
              {segment.media ? (
                <MediaFilmstrip
                  geometry={geometry}
                  cache={mediaCache}
                  shown={shown}
                  media={segment.media}
                  item={mediaById.get(segment.media)}
                  heard={heard}
                  muted={muted}
                />
              ) : (
                <SourceFilmstrip
                  geometry={geometry}
                  cache={mediaCache}
                  shown={shown}
                  source={source}
                  heard={sourceHeard(edits, segment, shown, tail)}
                  muted={muted}
                />
              )}
              {!held && !muted && (!segment.media || mediaById.get(segment.media)?.has_audio !== false) && (
                <>
                  <VolumeLine
                    volume={segment.volume ?? 1}
                    keyed={keyed ? { heard, start: shown.start, playback } : undefined}
                    grab={selected && !locked("video")}
                    onVolume={(next, group) => handlers.onVolume({ kind: "segment", id: segment.id }, next, group)}
                  />
                  <FadeRamps
                    fades={heard}
                    pps={pps}
                    tail={tail}
                    band={MEDIA_WAVE_BAND}
                    grab={selected && !locked("video")}
                    onFade={(fade, secs, group) => handlers.onFade(segment.id, fade, secs, heard.secs + tail, group)}
                  />
                </>
              )}
              <span className="relative self-start rounded bg-black/50 px-1 pt-0.5 text-[11px] font-medium text-white tabular-nums">
                {segment.media ? (mediaById.get(segment.media)?.name ?? "Video") : formatPrecise(mediaAlong(shown).mediaStart)}
                {volume !== 1 && !keyed ? ` · ${Math.round(volume * 100)}%` : ""}
              </span>
              <RetimingBadge retiming={segment} />
              {held && <HoldBadge hold={segment.hold!} />}
              {muted && <MutedBadge />}
            </TimelineItem>
          );
        })}
        {/* The Scenes as planned, and their Layouts, over the Segments' frames. */}
        <div aria-hidden className="pointer-events-none absolute inset-y-1 left-0 overflow-hidden rounded-md" style={{ width: duration * pps }}>
          {plan?.scenes.map((scene, i) => (
            <span
              key={i}
              className="absolute inset-y-0 border-l border-border px-1.5 pt-5 text-[10px] font-medium capitalize first:border-l-0"
              style={{ left: scene.start * pps, width: (scene.end - scene.start) * pps }}
            >
              {(scene.end - scene.start) * pps > 48 && scene.layout !== "media" && (
                <span className="rounded bg-black/50 px-1 py-px text-white/90">{scene.layout === "passthrough" ? "As shot" : scene.layout}</span>
              )}
            </span>
          ))}
        </div>
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
      <TrackRow label={label("captions")} height="h-8" dimmed={dimmed("captions")} locked={locked("captions")}>
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
      <TrackRow label={label("hook")} dimmed={dimmed("hook")} locked={locked("hook")}>
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
        <TrackRow key={`music${i}`} label={i === 0 ? label("music") : ""} locked={locked("music")} drop={dropMedia("music")}>
          {lane.map((clip) => {
            const selected = isPicked(pick, "music", clip.id);
            // Of a song, or of the Source's sound (the episode's).
            const episode = clip.media === null;
            const song = clip.media ? mediaById.get(clip.media) : undefined;
            // Its song at its Speed, in Reverse from its end, as an Overlay's video: trimmed, each edge
            // reaches as far as the song (or the episode) goes that way (as far as it plays now, while
            // the library loads).
            const time = overlayTime(clip);
            const length = episode ? source.metadata.duration : (song?.duration ?? time.end);
            const reach = {
              before: clip.start + offsetAt(time, clip.reverse ? length : 0),
              after: clip.start + offsetAt(time, clip.reverse ? 0 : length),
            };
            const end = Math.min(clip.start + clip.secs, duration);
            // Its fades over what is heard of it, as the planner has them.
            const fades = fadesWithin(clip, end - clip.start);
            const heard: Heard = { volume: clip.volume, secs: end - clip.start, ...fades, keys: clip.keys.volume };
            const muted = !!clip.muted;
            const name = musicName(clip, song);
            return (
              <TimelineItem
                key={clip.id}
                geometry={geometry}
                start={clip.start}
                end={end}
                max={duration}
                minSecs={ITEM_MIN_SECS}
                trimMin={reach.before}
                trimMax={reach.after}
                tone="audio"
                selected={selected}
                changed={changed.has(clip.id)}
                label={`${episode ? name : `Music ${song?.name ?? ""}`}, from ${clip.start.toFixed(1)} s for ${clip.secs.toFixed(1)} s${retimingName(clip)}${muted ? ", Muted" : ""}`}
                pickKey={keyOf({ kind: "music", id: clip.id })}
                onSelect={choose({ kind: "music", id: clip.id })}
                onChange={({ start, end, edge }, group) =>
                  layerChanged({ kind: "music", id: clip.id }, clip.start, { start, edge }, group, () =>
                    handlers.onMusic(
                      retime(
                        clip,
                        {
                          ...clip,
                          start: round(start),
                          secs: round(end - start),
                          // Trimmed, it plays the part of its song its edges now reach.
                          offset: edge !== "move" ? keptOffset(clip, start - clip.start, end - clip.start) : clip.offset,
                        },
                        edge,
                        group,
                      ),
                      group,
                    ),
                  )
                }
                onDelete={selected ? onDelete : undefined}
              >
                {episode ? (
                  // The Source's Peaks, at the Clip's own sound too, as its Segments' are.
                  <SongWaveform
                    geometry={geometry}
                    cache={mediaCache}
                    clip={clip}
                    heard={underSourceVolume(heard, edits)}
                    length={length}
                    peaks={(start) => jobPeaksUrl(source.job, start)}
                    muted={muted}
                  />
                ) : (
                  song?.has_audio &&
                  !!song.duration && (
                    <SongWaveform
                      geometry={geometry}
                      cache={mediaCache}
                      clip={clip}
                      heard={heard}
                      length={song.duration}
                      peaks={(start) => mediaPeaksUrl(song.id, start)}
                      muted={muted}
                    />
                  )
                )}
                {!muted && (
                  <>
                    <VolumeLine
                      volume={clip.volume}
                      keyed={clip.keys.volume?.length ? { heard, start: clip.start, playback } : undefined}
                      grab={selected && !locked("music")}
                      onVolume={(next, group) => handlers.onVolume({ kind: "music", id: clip.id }, next, group)}
                    />
                    <FadeRamps
                      fades={fades}
                      pps={pps}
                      grab={selected && !locked("music")}
                      onFade={(fade, secs, group) => handlers.onFade(clip.id, fade, secs, end - clip.start, group)}
                    />
                  </>
                )}
                {episode ? <Mic aria-hidden size={12} className="relative shrink-0" /> : <Music aria-hidden size={12} className="relative shrink-0" />}
                <span className="relative truncate font-medium">{name}</span>
                {clip.volume !== 1 && !clip.keys.volume?.length && (
                  <span className="relative shrink-0 opacity-70 tabular-nums">{Math.round(clip.volume * 100)}%</span>
                )}
                <RetimingBadge retiming={clip} />
                {muted && <MutedBadge />}
              </TimelineItem>
            );
          })}
        </TrackRow>
      ))}
    </>
  );
}

/** A Segment's, Overlay's or Music Clip's Speed and Reverse, as its accessible name says them: ", at 2×", ", reversed at 2×", or nothing at 1× forwards. */
function retimingName({ speed = 1, reverse }: Retiming): string {
  const atSpeed = speed !== 1 ? ` at ${speedLabel(speed)}` : "";
  return reverse ? `, reversed${atSpeed}` : atSpeed && `,${atSpeed}`;
}

/** A Segment's, Overlay's or Music Clip's badge on the Timeline at a Speed or in Reverse: "2×", "◀", "◀ 2×"; none at 1× forwards. */
function RetimingBadge({ retiming: { speed = 1, reverse } }: { retiming: Retiming }) {
  if (speed === 1 && !reverse) return null;
  return (
    <span aria-hidden className="relative shrink-0 self-start rounded bg-black/70 px-1 pt-0.5 text-[11px] font-semibold text-white tabular-nums">
      {[reverse && "◀", speed !== 1 && speedLabel(speed)].filter(Boolean).join(" ")}
    </span>
  );
}

/** A Muted item's crossed speaker on the Timeline. */
function MutedBadge() {
  return (
    <span aria-hidden className="relative shrink-0 self-start rounded bg-black/70 p-0.5 text-white">
      <VolumeX size={12} />
    </span>
  );
}

/** A Freeze frame's hold, as its badge and name say it: "1 s", "2.5 s". */
const holdLabel = (hold: number) => `${Math.round(hold * 100) / 100} s`;

/** A Freeze frame's hold on the Timeline: "❚❚ 1 s". */
function HoldBadge({ hold }: { hold: number }) {
  return (
    <span aria-hidden className="relative shrink-0 self-start rounded bg-black/70 px-1 pt-0.5 text-[11px] font-semibold text-white tabular-nums">
      ❚❚ {holdLabel(hold)}
    </span>
  );
}

// How a Segment's Filmstrip and Waveform run along it: from what it shows at its left edge (its
// range's end, in Reverse) at its Speed, backwards in Reverse, or, for a Freeze frame, its one frame
// repeated.
const mediaAlong = (shown: PlayedSegment) => ({
  mediaStart: shown.reverse ? rangeOf(shown).end : shown.source_start,
  speed: shown.hold != null ? 0 : shown.speed,
  reverse: shown.reverse,
});

/**
 * A media Segment's picture: its video's frames along it (its Filmstrip), over the video's still,
 * tiled, which shows until they arrive. A video with sound has its Waveform along the bottom, as it
 * is `heard` (at its volume or by its volume Keyframes); flat and dimmed when `muted`.
 */
function MediaFilmstrip({
  geometry,
  cache,
  shown,
  media,
  item,
  heard,
  muted,
}: {
  geometry: TimeGeometry;
  cache: MediaCache;
  shown: PlayedSegment;
  media: string;
  item?: MediaItem;
  heard: Heard;
  muted: boolean;
}) {
  const { pps } = geometry;
  return (
    <span
      aria-hidden
      className="absolute inset-0 bg-black bg-size-[auto_100%] bg-repeat-x opacity-80"
      style={{ backgroundImage: `url(${mediaThumbnailUrl(media)})` }}
    >
      {item?.kind === "video" && item.duration && item.width && item.height && (
        <ItemCanvas
          view={geometry.view}
          cache={cache}
          left={shown.start * pps}
          width={(shown.end - shown.start) * pps}
          pps={pps}
          layers={[
            filmstripLayer({
              cache,
              url: (start) => mediaFilmstripUrl(media, start),
              ...mediaAlong(shown),
              media: { duration: item.duration, width: item.width, height: item.height },
            }),
            ...(item.has_audio && shown.hold == null
              ? [
                  waveformLayer({
                    cache,
                    url: (start) => mediaPeaksUrl(media, start),
                    ...mediaAlong(shown),
                    duration: item.duration,
                    gain: (time) => gainAt(time, heard),
                    color: MEDIA_WAVE,
                    band: MEDIA_WAVE_BAND,
                    muted,
                  }),
                ]
              : []),
          ]}
        />
      )}
    </span>
  );
}

/**
 * A Source Segment's picture: the Source's frames along it (its Filmstrip), over the plain lane until
 * they arrive, and the speech's Waveform along its bottom as it is `heard` (its volume or volume
 * Keyframes, under the Clip's own sound); flat and dimmed when `muted`.
 */
function SourceFilmstrip({
  geometry,
  cache,
  shown,
  source,
  heard,
  muted,
}: {
  geometry: TimeGeometry;
  cache: MediaCache;
  shown: PlayedSegment;
  source: { job: string; metadata: SourceMetadata };
  heard: Heard;
  muted: boolean;
}) {
  const { pps } = geometry;
  return (
    <ItemCanvas
      view={geometry.view}
      cache={cache}
      left={shown.start * pps}
      width={(shown.end - shown.start) * pps}
      pps={pps}
      layers={[
        filmstripLayer({
          cache,
          url: (start) => jobFilmstripUrl(source.job, start),
          ...mediaAlong(shown),
          media: source.metadata,
        }),
        ...(shown.hold != null
          ? []
          : [
              waveformLayer({
                cache,
                url: (start) => jobPeaksUrl(source.job, start),
                ...mediaAlong(shown),
                duration: source.metadata.duration,
                gain: (time) => gainAt(time, heard),
                color: MEDIA_WAVE,
                band: MEDIA_WAVE_BAND,
                muted,
              }),
            ]),
      ]}
    />
  );
}

/**
 * A Music Clip's Waveform: the part of its song it plays, across its body, at its Speed (from the
 * part's end, backwards, in Reverse), as `heard` over the secs it is heard for, at its volume or by
 * its volume Keyframes, through its fades (as the planner has them over those); flat and dimmed when
 * `muted`. `length` is the song's, whose Peaks are at `peaks` (a Media Library item's, or the
 * Source's for its sound).
 */
function SongWaveform({
  geometry,
  cache,
  clip,
  heard,
  length,
  peaks,
  muted,
}: {
  geometry: TimeGeometry;
  cache: MediaCache;
  clip: MusicClip;
  heard: Heard;
  length: number;
  peaks: (start: number) => string;
  muted: boolean;
}) {
  const { pps } = geometry;
  const { secs } = heard;
  return (
    <ItemCanvas
      view={geometry.view}
      cache={cache}
      left={clip.start * pps}
      width={secs * pps}
      pps={pps}
      layers={[
        waveformLayer({
          cache,
          url: peaks,
          mediaStart: clip.reverse ? overlayTime(clip, length).end : clip.offset,
          speed: clip.speed,
          reverse: clip.reverse,
          duration: length,
          gain: (time) => gainAt(time, heard),
          color: SONG_WAVE,
          muted,
        }),
      ]}
    />
  );
}

// The Volume Line's hit area, at least this many pixels tall, kept inside its item.
const VOLUME_HIT_PX = 24;

/**
 * A Music Clip's or Segment's Volume Line: a line at its `volume`, 100% at two thirds of its
 * height. On a picked item of an unlocked Track (`grab`), it drags up and down to set the volume, with
 * a % label while it does; elsewhere on the item, a drag moves or trims it as ever. With volume
 * Keyframes (`keyed`), it is their line (KeyedVolumeLine).
 */
function VolumeLine({
  volume,
  keyed,
  grab,
  onVolume,
}: {
  volume: number;
  // How it is heard, by its volume Keyframes, from `start` (Timeline time), with the playhead on `playback`.
  keyed?: { heard: Heard; start: number; playback: Playback };
  grab: boolean;
  onVolume: (volume: number, group: string) => void;
}) {
  if (keyed) return <KeyedVolumeLine {...keyed} grab={grab} onVolume={onVolume} />;
  const top = `${(1 - volumeHeight(volume)) * 100}%`;
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span
        className={cx("absolute inset-x-0 -translate-y-1/2 bg-[oklch(0.88_0.16_90)] shadow-[0_0_0_0.5px_rgb(0_0_0/0.5)]", grab ? "h-0.5" : "h-px")}
        style={{ top }}
      />
      {grab && (
        <ItemHandle
          className="absolute inset-x-0 cursor-ns-resize"
          style={{ height: VOLUME_HIT_PX, top: `clamp(0px, calc(${top} - ${VOLUME_HIT_PX / 2}px), calc(100% - ${VOLUME_HIT_PX}px))` }}
          label={`${Math.round(volume * 100)}%`}
          onGrab={(handle) => {
            // From where it was when grabbed, by how far it is dragged.
            const from = volume;
            const height = handle.parentElement!.getBoundingClientRect().height;
            return ({ dy }, group) => onVolume(volumeDragged(from, dy, height), group);
          }}
        />
      )}
    </span>
  );
}

/**
 * The Volume Line of an item with volume Keyframes: their line through its fades (`volumeLine`) over
 * the secs it is `heard`. On a picked item of an unlocked Track (`grab`) with the playhead on it, a
 * knob on the line at the playhead drags up and down to write a volume Keyframe there (`onVolume`
 * auto-keys), with a % label while it does; with the playhead outside the item it doesn't drag.
 */
function KeyedVolumeLine({
  heard,
  start,
  playback,
  grab,
  onVolume,
}: {
  heard: Heard;
  start: number;
  playback: Playback;
  grab: boolean;
  onVolume: (volume: number, group: string) => void;
}) {
  const { secs } = heard;
  const at = keyTime({ start, secs }, useKeyTime(playback));
  const points = volumeLine(heard)
    .map(({ time, height }) => `${time / secs},${1 - height}`)
    .join(" ");
  // The volume its Keyframes give at the playhead, which the knob drags from.
  const volume = at === null ? null : valueAt(heard.keys ?? [], at, heard.volume);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <svg className="absolute inset-0 size-full" viewBox="0 0 1 1" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke="oklch(0.88 0.16 90)" strokeWidth={grab ? 2 : 1} vectorEffect="non-scaling-stroke" />
      </svg>
      {grab && at !== null && volume !== null && (
        <ItemHandle
          className="absolute grid size-6 -translate-1/2 cursor-ns-resize place-items-center"
          style={{ left: `${(at / secs) * 100}%`, top: `${(1 - volumeHeight(gainAt(at, heard))) * 100}%` }}
          label={`${Math.round(volume * 100)}%`}
          onGrab={(handle) => {
            // From where it was when grabbed, by how far it is dragged.
            const height = handle.parentElement!.getBoundingClientRect().height;
            return ({ dy }, group) => onVolume(volumeDragged(volume, dy, height), group);
          }}
        >
          <span className="size-2.5 rounded-full bg-[oklch(0.88_0.16_90)] shadow-[0_0_0_1px_rgb(0_0_0/0.5)]" />
        </ItemHandle>
      )}
    </span>
  );
}

// A Fade Ramp's handle: a hit area this many pixels square, kept clear of the item's trim edges.
const FADE_HIT_PX = 24;
const TRIM_EDGE_PX = 12;

/**
 * A Music Clip's or Segment's Fade Ramps: its fade in and fade out (`fades`, as heard), at `pps`
 * pixels a second, as slopes at its ends that shade what they quieten; a Segment's over the sound
 * `band` of its Filmstrip, its fade out ending `tail` seconds past its drawn end (under the Transition
 * into the next). On a picked item of an unlocked Track (`grab`), a handle at the top of each slope
 * drags that fade's length, with its seconds while it does; elsewhere on the item, a drag moves or
 * trims it as ever.
 */
function FadeRamps({
  fades,
  pps,
  tail = 0,
  band,
  grab,
  onFade,
}: {
  fades: { fade_in: number; fade_out: number };
  pps: number;
  tail?: number;
  // Its height in pixels, along the item's bottom; all of the item's without it.
  band?: number;
  grab: boolean;
  onFade: (fade: "fade_in" | "fade_out", secs: number, group: string) => void;
}) {
  const ramp = (fade: "fade_in" | "fade_out") => {
    const width = fades[fade] * pps;
    // From the item's start for the fade in, from where it is last heard for the fade out.
    const side = fade === "fade_in" ? "left" : "right";
    const past = side === "right" ? tail * pps : 0;
    return [
      width > 0 && (
        <svg key={`${fade}:ramp`} className="absolute inset-y-0 h-full" style={{ width, [side]: -past }} viewBox="0 0 1 1" preserveAspectRatio="none">
          <path d={side === "left" ? "M0 0 H1 L0 1 Z" : "M0 0 H1 V1 Z"} fill="rgb(0 0 0 / 0.35)" />
          <path d={side === "left" ? "M0 1 L1 0" : "M0 0 L1 1"} stroke="oklch(0.88 0.16 90)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
      ),
      grab && (
        <ItemHandle
          key={`${fade}:handle`}
          className="absolute cursor-ew-resize"
          style={{
            width: FADE_HIT_PX,
            height: FADE_HIT_PX,
            // Across the top of a band; at the top of the item without one.
            top: band ? -FADE_HIT_PX / 2 : 0,
            [side]: `clamp(${TRIM_EDGE_PX}px, ${width - past - FADE_HIT_PX / 2}px, calc(100% - ${TRIM_EDGE_PX + FADE_HIT_PX}px))`,
          }}
          label={`${fades[fade].toFixed(1)} s`}
          labelBefore={side === "right"}
          onGrab={() => {
            // From where it was when grabbed, by the seconds dragged: inward lengthens it.
            const from = fades[fade];
            return ({ dx }, group) => onFade(fade, from + (side === "left" ? dx : -dx) / pps, group);
          }}
        >
          <span
            className={cx(
              "absolute left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-[oklch(0.88_0.16_90)] shadow-[0_0_0_1px_rgb(0_0_0/0.5)]",
              band ? "top-1/2 -translate-y-1/2" : "top-0.5",
            )}
          />
        </ItemHandle>
      ),
    ];
  };
  return (
    <span aria-hidden className={cx("pointer-events-none absolute inset-x-0 bottom-0", !band && "top-0")} style={band ? { height: band } : undefined}>
      {ramp("fade_in")}
      {ramp("fade_out")}
    </span>
  );
}

/**
 * A Track's label: its name, and on a desktop (`onTrack`) its buttons to hide and mute it in the
 * preview, which leave the rendered Clip as it is, and to lock it against edits by hand.
 */
function TrackLabel({ kind, tracks, onTrack }: { kind: TrackKind; tracks: TrackState; onTrack?: (control: TrackControl, kind: TrackKind) => void }) {
  const { label, hide, mute } = TRACKS[kind];
  if (!onTrack) return label;
  const hidden = tracks.hidden.includes(kind);
  const muted = tracks.muted.includes(kind);
  const locked = tracks.locked.includes(kind);
  return (
    <span className="flex w-full items-center justify-between gap-1">
      <span className="truncate">{label}</span>
      <span className="flex shrink-0">
        {hide && (
          <TrackButton
            on={hidden}
            onClick={() => onTrack("hidden", kind)}
            label={`Hide the ${label} Track`}
            title={hidden ? "Hidden in the preview: the clip still shows it" : "Hide in the preview (the clip still shows it)"}
          >
            {hidden ? <EyeOff aria-hidden size={14} /> : <Eye aria-hidden size={14} />}
          </TrackButton>
        )}
        {mute && (
          <TrackButton
            on={muted}
            onClick={() => onTrack("muted", kind)}
            label={`Mute the ${label} Track`}
            title={muted ? "Muted in the preview: the clip is still heard with it" : "Mute in the preview (the clip is still heard with it)"}
          >
            {muted ? <VolumeX aria-hidden size={14} /> : <Volume2 aria-hidden size={14} />}
          </TrackButton>
        )}
        <TrackButton
          on={locked}
          onClick={() => onTrack("locked", kind)}
          label={`Lock the ${label} Track`}
          title={locked ? "Locked: its items can't be picked, moved or changed here" : "Lock against edits here"}
        >
          {locked ? <Lock aria-hidden size={14} /> : <LockOpen aria-hidden size={14} />}
        </TrackButton>
      </span>
    </span>
  );
}

// A Track's toggle in its label: lit while on.
export function TrackButton({
  on,
  onClick,
  label,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={title}
      className={cx(
        "grid size-6 place-items-center rounded-md hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus",
        on ? "text-accent-text" : "text-muted",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A phone's Tracks sheet: each Track with its buttons to hide, mute and lock it, as a desktop's
 * labels have them, and the Magnetic timeline's switch.
 */
export function TracksPanel({ tracks, onTrack }: { tracks: TrackState; onTrack: (control: TrackControl, kind: TrackKind) => void }) {
  const magnetic = useMagnetic();
  return (
    <div className="flex flex-col gap-2 px-4 pb-4">
      <Switch checked={magnetic} onChange={setMagnetic}>
        <span className="flex flex-col">
          <span className="font-medium">Magnetic timeline</span>
          <span className="text-sm text-muted">Deleting, trimming or inserting Segments moves the layers with them.</span>
        </span>
      </Switch>
      <ul className="flex flex-col">
        {(Object.keys(TRACKS) as TrackKind[]).map((kind) => {
          const { label, hide, mute } = TRACKS[kind];
          const toggle = (control: TrackControl, name: string, on: ReactNode, off: ReactNode) => {
            const pressed = tracks[control].includes(kind);
            return (
              <Button
                variant="ghost"
                size="icon"
                className="aria-pressed:text-accent-text"
                onClick={() => onTrack(control, kind)}
                aria-pressed={pressed}
                aria-label={`${name} the ${label} Track`}
              >
                {pressed ? on : off}
              </Button>
            );
          };
          return (
            <li key={kind} className="flex min-h-11 items-center justify-between gap-2 border-b border-border last:border-b-0">
              <span className="font-medium">{label}</span>
              <span className="flex">
                {hide && toggle("hidden", "Hide", <EyeOff aria-hidden size={18} />, <Eye aria-hidden size={18} />)}
                {mute && toggle("muted", "Mute", <VolumeX aria-hidden size={18} />, <Volume2 aria-hidden size={18} />)}
                {toggle("locked", "Lock", <Lock aria-hidden size={18} />, <LockOpen aria-hidden size={18} />)}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">Hiding and muting change the preview only: the clip renders everything.</p>
    </div>
  );
}

