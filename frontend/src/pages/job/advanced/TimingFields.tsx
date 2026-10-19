import { useState } from "react";
import type { Retiming } from "../../../api";
import { Slider } from "../../../components/Slider";
import { offsetAt, overlayTime } from "../editor/segmentTime";
import { Group } from "../editor/StyleFields";
import { gestureRetime, type TimedEdge } from "./actions";
import { ITEM_MIN_SECS, keptOffset } from "./edits";

/**
 * When an item of the timeline shows (or is heard): where it starts in the Clip, how long it stays
 * (kept in the Clip and, for a song or a video, in its file, which a video at a Speed plays that many
 * seconds of in each of the Clip's), and with `length` (its file's), where in its file it starts. A
 * video in Reverse stays longer or shorter at its end as its right edge's trim does: its part of the
 * video reaches further back or less far (its offset), its end in the video staying.
 * Each field's changes are one `group` of the history.
 */
export function TimingFields<T extends { id: string; start: number; secs: number; offset?: number } & Omit<Retiming, "hold">>({
  item,
  duration,
  length,
  labels,
  offsetFormat = (v) => `${v.toFixed(1)} s`,
  onChange,
}: {
  item: T;
  // The Clip's.
  duration: number;
  // Of its song or video; undefined for an item without a file's time (a Text Layer, an image).
  length?: number;
  labels: { start: string; secs: string; offset?: string };
  // How where in its file it starts reads (seconds, by default).
  offsetFormat?: (value: number) => string;
  onChange: (item: T, group: string) => void;
}) {
  // Moved or trimmed, its Keyframes (if it has any) re-anchored from where they were as the slider's drag began.
  const [retime] = useState(gestureRetime);
  const changed = (next: T, edge: TimedEdge, group: string) => onChange(retime(item, next, edge, group), group);
  const offset = item.offset ?? 0;
  // The part of its file it plays; it can last until that reaches the file's start (in Reverse) or end.
  const time = overlayTime({ ...item, offset });
  const reach = length === undefined ? Infinity : offsetAt(time, item.reverse ? 0 : length);
  const room = Math.min(duration - item.start, reach);
  const seconds = (v: number) => `${v.toFixed(2)} s`;
  return (
    <Group title="Time">
      {length !== undefined && labels.offset && (
        <Slider
          label={labels.offset}
          value={offset}
          min={0}
          max={Math.max(0, length - (time.end - time.start))}
          step={0.1}
          format={offsetFormat}
          onChange={(value) => onChange({ ...item, offset: value }, `${item.id}:offset`)}
        />
      )}
      <Slider
        label={labels.start}
        value={Math.min(item.start, duration - ITEM_MIN_SECS)}
        min={0}
        max={Math.max(ITEM_MIN_SECS, duration - ITEM_MIN_SECS)}
        step={0.05}
        format={seconds}
        onChange={(start) => changed({ ...item, start, secs: Math.min(item.secs, duration - start) }, "move", `${item.id}:start`)}
      />
      <Slider
        label={labels.secs}
        value={Math.min(item.secs, room)}
        min={ITEM_MIN_SECS}
        max={Math.max(ITEM_MIN_SECS, room)}
        step={0.05}
        format={seconds}
        onChange={(secs) =>
          changed({ ...item, secs, ...(item.reverse && length !== undefined && { offset: keptOffset({ ...item, offset }, 0, secs) }) }, "end", `${item.id}:secs`)
        }
      />
    </Group>
  );
}
