import { Eye, EyeOff, Lock, LockOpen, Music, Type, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
import { mediaFilmstripUrl, mediaThumbnailUrl, type MediaItem, type MusicClip, type Overlay, type RenderPlan, type TextLayer, type TransitionKind } from "../../../api";
import { Button } from "../../../components/Button";
import { Switch } from "../../../components/Switch";
import { cx, formatPrecise } from "../../../format";
import { setMagnetic, useMagnetic } from "../editor/magnetic";
import type { PlayedSegment, Playback } from "../editor/playback";
import { TimelineItem, TrackRow, type TimeGeometry } from "./AdvancedTimeline";
import { DRAG_MEDIA, DRAG_TEXT, DRAG_TRANSITION } from "./drag";
import { ITEM_MIN_SECS, round, trackLanes, type AdvancedEdits } from "./edits";
import { filmstripLayer } from "./filmstrip";
import { ItemCanvas } from "./ItemCanvas";
import { SEGMENT_MIN_SECS } from "./MainTrack";
import type { MediaCache } from "./mediaCache";
import { clicked, isPicked, itemsOf, keyOf, picked, type ItemRef, type Pick } from "./pick";
import { HOOK_MIN_SECS } from "./ripple";
import { TRACKS, type TrackControl, type TrackKind, type TrackState } from "./trackState";

// The hook's longest time (hook_secs in backend/app/api.py).
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
  // The picked Text Layers, Music Clips and Overlays moved `delta` seconds, together.
  onMove: (delta: number, group: string) => void;
  onJoin: (after: string) => void;
  onDropTransition: (after: string, kind: TransitionKind) => void;
  // A Media Library item (its id) or a Text Layer's look (its name) dropped at `time`.
  onDropMedia: (track: DropTrack, media: string, time: number) => void;
  onDropText: (look: string, time: number) => void;
  // Deletes the picked items; `rippled` (Shift), closing their gaps.
  onDelete?: (rippled: boolean) => void;
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
  mediaCache,
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
  // The Filmstrips' chunks, as fetched and decoded.
  mediaCache: MediaCache;
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
  // An item clicked: picked alone, or added to the Pick or taken out of it (always, in picking mode).
  const choose = (item: ItemRef) => (toggle: boolean) => onSelect(clicked(pick, item, toggle || picking));
  // A picked item of several dragged or trimmed (or a Segment moved): picked alone.
  const alone = (item: ItemRef) => {
    if (itemsOf(pick).length > 1) onSelect(picked(item));
  };
  // A Text Layer, Music Clip or Overlay dragged or trimmed, from `now` (its start): moved with the
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
                  layerChanged({ kind: "overlay", id: overlay.id }, overlay.start, { start, edge }, group, () =>
                    handlers.onOverlay(
                      {
                        ...overlay,
                        start: round(start),
                        secs: round(end - start),
                        // Trimming a video's start starts it later in the video.
                        offset: edge === "start" && item?.duration != null ? round(Math.max(0, overlay.offset + start - overlay.start)) : overlay.offset,
                      },
                      group,
                    ),
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
      <TrackRow label={label("video")} height="h-14" dimmed={dimmed("video")} locked={locked("video")} drop={dropMedia("segment")}>
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
              onChange={(moved, group) => {
                alone({ kind: "segment", id: segment.id });
                handlers.onSegment(segment.id, moved, group);
              }}
              onDelete={selected ? onDelete : undefined}
            >
              {segment.media && <MediaFilmstrip geometry={geometry} cache={mediaCache} shown={shown} media={segment.media} item={mediaById.get(segment.media)} />}
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
                  layerChanged({ kind: "music", id: clip.id }, clip.start, { start, edge }, group, () =>
                    handlers.onMusic(
                      {
                        ...clip,
                        start: round(start),
                        secs: round(end - start),
                        // Trimming its start starts it later in the song.
                        offset: edge === "start" ? round(Math.max(0, clip.offset + start - clip.start)) : clip.offset,
                      },
                      group,
                    ),
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

/**
 * A media Segment's picture: its video's frames along it (its Filmstrip), over the video's still,
 * tiled, which shows until they arrive.
 */
function MediaFilmstrip({
  geometry,
  cache,
  shown,
  media,
  item,
}: {
  geometry: TimeGeometry;
  cache: MediaCache;
  shown: PlayedSegment;
  media: string;
  item?: MediaItem;
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
              mediaStart: shown.source_start,
              media: { duration: item.duration, width: item.width, height: item.height },
            }),
          ]}
        />
      )}
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

