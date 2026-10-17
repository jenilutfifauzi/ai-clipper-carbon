import { Copy, Layers, Trash2 } from "lucide-react";
import type { MediaItem, Overlay } from "../../../api";
import { Button } from "../../../components/Button";
import { NO_CROP } from "../editor/cropGestures";
import { mediaSize, overlayPlacement } from "../editor/picture";
import type { Playback } from "../editor/playback";
import { Group } from "../editor/StyleFields";
import { DecorationFields } from "./DecorationFields";
import { newId, round } from "./edits";
import { shownTransform, tooManyKeys, writeKey, writtenTransform } from "./keyActions";
import { KeyedVolume, useKeyNotice, useKeyTime, useTouch } from "./KeyCluster";
import { heldKeyTime, keyedGroup, keyTime, resetOverlay } from "./keying";
import { SpeedFields } from "./SpeedFields";
import { TimingFields } from "./TimingFields";
import { TransformFields } from "./TransformFields";

// A new still shows this long, or to the Clip's end.
const STILL_SECS = 3;

/**
 * An Overlay of `item` at `at` (the playhead, or where it was dropped): placed as `overlayPlacement`
 * says (half the frame wide, in its upper middle); a video as long as it is (and fits).
 */
export function newOverlay(item: MediaItem, at: number, duration: number): Overlay {
  const length = item.duration ?? STILL_SECS;
  const start = Math.max(0, Math.min(at, duration - Math.min(length, duration)));
  return {
    id: newId(),
    media: item.id,
    start: round(start),
    secs: round(Math.min(length, duration - start)),
    offset: 0,
    transform: overlayPlacement(mediaSize(item)),
    crop: NO_CROP,
    volume: 0,
    radius: 0,
    border: null,
    shadow: null,
    keys: {},
  };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * An Overlay's Transform and Crop in the inspector and the phone's Transform sheet, keyed (ADR 0008):
 * its fields show it at the playhead, and a change to a keyed field writes a Keyframe there
 * (writtenTransform). Reset also drops the Transform's Keyframes. Each change is one `group` of the
 * history, named after its field.
 */
export function OverlayTransform({
  overlay,
  item,
  playback,
  onChange,
  onCropMode,
}: {
  overlay: Overlay;
  item: MediaItem | undefined;
  playback: Playback;
  onChange: (overlay: Overlay, group: string) => void;
  onCropMode?: () => void;
}) {
  const time = useKeyTime(playback);
  const at = keyTime(overlay, time);
  const shown = shownTransform(overlay.transform, overlay.keys, at ?? heldKeyTime(overlay, time));
  const size = mediaSize(item);
  const defaults = overlayPlacement(size);
  const notify = useKeyNotice();
  return (
    <TransformFields
      transform={shown}
      crop={overlay.crop}
      size={size}
      defaults={defaults}
      onChange={(next, field) => {
        const written = writtenTransform(overlay.transform, overlay.keys, next, at, shown);
        if (written.full) return notify(tooManyKeys(written.full));
        onChange({ ...overlay, ...written }, keyedGroup(`overlay:${overlay.id}:transform.${field}`, written.keys !== overlay.keys, at));
      }}
      onCrop={(crop, field, transform) =>
        onChange(transform ? resetOverlay(overlay, transform) : { ...overlay, crop }, `overlay:${overlay.id}:crop.${field}`)
      }
      onCropMode={onCropMode}
      keyed={{ item: { kind: "overlay", id: overlay.id }, keys: overlay.keys, inside: at !== null }}
    />
  );
}

/** The selected Overlay's Transform, corners, border and shadow, sound, a video's Speed, and time. */
export function OverlayFields({
  overlay,
  item,
  duration,
  playback,
  onChange,
  onSpeed,
  onDuplicate,
  onDelete,
  onCropMode,
}: {
  overlay: Overlay;
  item: MediaItem | undefined;
  duration: number;
  playback: Playback;
  onChange: (overlay: Overlay, group: string) => void;
  // A video's Speed set (actions.ts' setSpeed), a change of `group`.
  onSpeed: (speed: number, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  // Crop mode on the stage, when it can be opened there.
  onCropMode?: () => void;
}) {
  const video = item?.kind === "video";
  const length = item?.duration ?? Infinity;
  // Its sound at the playhead, and set there once it is keyed.
  const touch = useTouch();
  const notify = useKeyNotice();
  const setVolume = (value: number, at: number | null) => {
    touch("volume");
    const { keys, constant, full } = writeKey(overlay.keys, "volume", at ?? 0, value, overlay.volume);
    if (full) return notify(tooManyKeys(full));
    onChange({ ...overlay, keys, volume: constant }, keyedGroup(`overlay:${overlay.id}:volume`, keys !== overlay.keys, at));
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <Layers aria-hidden size={17} className="shrink-0 text-muted" />
          <span className="truncate">{item?.name ?? "Overlay"}</span>
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate overlay">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete overlay">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <p className="text-sm text-pretty text-muted">
        Drag it on the video to place it: its corners scale it, its edges stretch it and the handle above turns it. Double-click it to crop it.
      </p>
      <OverlayTransform overlay={overlay} item={item} playback={playback} onChange={onChange} onCropMode={onCropMode} />
      <DecorationFields overlay={overlay} onChange={onChange} />
      {video && (
        <Group title="Sound">
          {item?.has_audio ? (
            <KeyedVolume
              item={{ kind: "overlay", id: overlay.id }}
              span={overlay}
              keys={overlay.keys.volume ?? []}
              volume={overlay.volume}
              label="Its sound"
              format={(v) => (v ? percent(v) : "Muted")}
              playback={playback}
              onChange={setVolume}
            />
          ) : (
            <p className="text-sm text-muted">This video has no sound.</p>
          )}
        </Group>
      )}
      {video && (
        <SpeedFields
          speed={overlay.speed ?? 1}
          pitch={overlay.pitch ?? false}
          heard={!!item?.has_audio}
          group={`overlay:${overlay.id}:speed`}
          onSpeed={onSpeed}
          onPitch={(pitch) => onChange({ ...overlay, pitch }, `overlay:${overlay.id}:pitch`)}
        />
      )}
      <TimingFields
        item={overlay}
        duration={duration}
        length={video ? length : undefined}
        labels={{ start: "Comes on at", secs: "Stays for", offset: "Starts in the video at" }}
        onChange={onChange}
      />
    </div>
  );
}
