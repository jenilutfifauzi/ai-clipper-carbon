import { Copy, Layers, Trash2 } from "lucide-react";
import type { MediaItem, Overlay } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { Group } from "../editor/StyleFields";
import { newId } from "./TextLayers";

export const OVERLAY_MIN_SECS = 0.1;
// A new still shows this long, or to the Clip's end.
const STILL_SECS = 3;

/** An Overlay of `item` at the playhead (`at`): half the frame wide, in its upper middle; a video as long as it is (and fits). */
export function newOverlay(item: MediaItem, at: number, duration: number): Overlay {
  const length = item.duration ?? STILL_SECS;
  const start = Math.max(0, Math.min(at, duration - Math.min(length, duration)));
  return {
    id: newId(),
    media: item.id,
    start: round(start),
    secs: round(Math.min(length, duration - start)),
    offset: 0,
    x: 540,
    y: 760,
    size: 540,
    opacity: 1,
    volume: 0,
  };
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The selected Overlay's size, opacity, sound and time. */
export function OverlayFields({
  overlay,
  item,
  duration,
  onChange,
  onDuplicate,
  onDelete,
}: {
  overlay: Overlay;
  item: MediaItem | undefined;
  duration: number;
  onChange: (overlay: Overlay, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof Overlay>(field: K, value: Overlay[K]) => onChange({ ...overlay, [field]: value }, `overlay:${overlay.id}:${field}`);
  const video = item?.kind === "video";
  const length = item?.duration ?? Infinity;
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
      <p className="text-sm text-pretty text-muted">Drag it on the video to place it, and its corner to resize it.</p>
      <Group title="Look">
        <Slider label="Width" value={overlay.size} min={32} max={1080} format={(v) => `${v} px`} onChange={(size) => set("size", size)} />
        <Slider label="Opacity" value={overlay.opacity} min={0} max={1} step={0.05} format={percent} onChange={(opacity) => set("opacity", opacity)} />
        {video &&
          (item?.has_audio ? (
            <Slider label="Its sound" value={overlay.volume} min={0} max={2} step={0.05} format={(v) => (v ? percent(v) : "Muted")} onChange={(volume) => set("volume", volume)} />
          ) : (
            <p className="text-sm text-muted">This video has no sound.</p>
          ))}
      </Group>
      <Group title="Time">
        {video && (
          <Slider
            label="Starts in the video at"
            value={overlay.offset}
            min={0}
            max={Math.max(0, length - overlay.secs)}
            step={0.1}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(offset) => set("offset", offset)}
          />
        )}
        <Slider
          label="Comes on at"
          value={Math.min(overlay.start, duration - OVERLAY_MIN_SECS)}
          min={0}
          max={Math.max(OVERLAY_MIN_SECS, duration - OVERLAY_MIN_SECS)}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(start) => onChange({ ...overlay, start, secs: Math.min(overlay.secs, duration - start) }, `overlay:${overlay.id}:start`)}
        />
        <Slider
          label="Stays for"
          value={Math.min(overlay.secs, duration - overlay.start, length - overlay.offset)}
          min={OVERLAY_MIN_SECS}
          max={Math.max(OVERLAY_MIN_SECS, Math.min(duration - overlay.start, length - overlay.offset))}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(secs) => set("secs", secs)}
        />
      </Group>
    </div>
  );
}
