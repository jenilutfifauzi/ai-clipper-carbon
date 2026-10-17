import { Clapperboard, Copy, Film, Plus, Scissors, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ClipSegment, Framing, MediaItem, Transcript } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { formatPrecise } from "../../../format";
import { TranscriptPicker } from "../TranscriptPicker";
import { FITTED } from "../editor/manual";
import { IDENTITY, mediaSize } from "../editor/picture";
import type { Playback, PlayedSegment } from "../editor/playback";
import { rangeOf, segmentLength, sourceAt } from "../editor/segmentTime";
import { shownTransform, tooManyKeys, writtenTransform } from "./keyActions";
import { KeyedVolume, useKeyNotice, useKeyTime } from "./KeyCluster";
import { heldKeyTime, keyedGroup, keyTime, resetFraming, type KeySpan } from "./keying";
import { BackgroundFields, TransformFields } from "./TransformFields";

// The shortest Segment the editor makes; the backend snaps each to Words.
export const SEGMENT_MIN_SECS = 0.3;

/**
 * The Main Track's Segments after a drag of Segment `id` from `origin` (the Segments when the drag
 * began), given how the track was drawn then (`shown`: each Segment's span on the Timeline, cut short
 * where a Transition into the next starts) and planned (`planned`: each Segment's whole span and its
 * range of the Source or its video, snapped to Words). Moved, it takes the place its middle is
 * dragged to. Its start or end trimmed, its planned edge moves as far as the drawn one did (within
 * its file's `lengthOf`), and the Segments after it close up behind it.
 */
export function draggedSegments(
  origin: ClipSegment[],
  id: string,
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  lengthOf: (segment: ClipSegment) => number,
  shown: PlayedSegment[],
  planned: PlayedSegment[],
): ClipSegment[] {
  const index = origin.findIndex((segment) => segment.id === id);
  const segment = origin[index];
  const drawn = shown[index];
  const whole = planned[index];
  if (!drawn || !whole) return origin;
  if (change.edge === "move") {
    const middle = change.start + (drawn.end - drawn.start) / 2;
    const place = shown.filter((other, i) => i !== index && other.start + (other.end - other.start) / 2 < middle).length;
    const others = origin.filter((other) => other.id !== id);
    return [...others.slice(0, place), segment, ...others.slice(place)];
  }
  // Where the dragged edge now is, in its file.
  const range = rangeOf(whole);
  const next =
    change.edge === "start"
      ? { ...segment, start: round(Math.min(Math.max(sourceAt(range, change.start - drawn.start), 0), whole.source_end - SEGMENT_MIN_SECS)), end: whole.source_end }
      : {
          ...segment,
          start: whole.source_start,
          end: round(Math.max(Math.min(sourceAt(range, segmentLength(range) + change.end - drawn.end), lengthOf(segment)), whole.source_start + SEGMENT_MIN_SECS)),
        };
  return origin.map((other) => (other.id === id ? next : other));
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

// The longest video Segment: the longest video the Media Library takes (MAX_SECS in backend/app/media.py).
const VIDEO_MAX_SECS = 180;

/** A video from the Media Library as a Segment, from its start, as long as it is (and as fits), fitted over its blur. */
export function newMediaSegment(item: MediaItem, id: string): ClipSegment {
  return { id, start: 0, end: round(Math.min(item.duration ?? 1, VIDEO_MAX_SECS)), media: item.id, framing: FITTED, volume: 1 };
}

/**
 * The selected Segment: what it shows (of the episode, with how its Scene at the playhead is framed,
 * or of a video, with its Framing), its sound, and what can be done to it.
 */
export function SegmentFields({
  segment,
  item,
  index,
  count,
  sourceVolume,
  canSplit,
  onSplit,
  onDuplicate,
  onDelete,
  onSourceVolume,
  onVolume,
  onChange,
  onCropMode,
  scene,
  playback,
  span,
}: {
  segment: ClipSegment;
  // Its video, for a video's Segment.
  item: MediaItem | undefined;
  index: number;
  count: number;
  sourceVolume: number;
  canSplit: boolean;
  onSplit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSourceVolume: (volume: number) => void;
  // A video's Segment's volume.
  onVolume: (volume: number, group: string) => void;
  onChange: (segment: ClipSegment, group: string) => void;
  // A video's Segment's Crop mode on the stage, when it can be opened there.
  onCropMode?: () => void;
  // A Segment of the episode's: how its Scene at the playhead is framed.
  scene?: ReactNode;
  playback: Playback;
  // Where it plays on the Timeline (keying.ts' segmentSpan), which a video's Keyframes are set in.
  span: KeySpan | null;
}) {
  const Icon = segment.media ? Clapperboard : Film;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <Icon aria-hidden size={17} className="shrink-0 text-muted" />
          <span className="truncate">{segment.media ? (item?.name ?? "Video") : `Segment ${index + 1} of ${count}`}</span>
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onSplit} disabled={!canSplit} aria-label="Split at the playhead">
            <Scissors aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate Segment">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} disabled={count < 2} aria-label="Delete Segment">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      {segment.media ? (
        <>
          <Hint more="Drag its edges to trim it, or drag it to another place.">
            {formatPrecise(segment.start)} – {formatPrecise(segment.end)} of the video · {segmentLength(segment).toFixed(1)} s
          </Hint>
          {segment.framing && (
            <FramingFields segment={segment} framing={segment.framing} item={item} playback={playback} span={span} onChange={onChange} onCropMode={onCropMode} />
          )}
          {item?.has_audio === false ? (
            <p className="text-sm text-muted">This video has no sound.</p>
          ) : (
            <KeyedVolume
              item={{ kind: "segment", id: segment.id }}
              span={span}
              keys={segment.keys?.volume ?? []}
              volume={segment.volume ?? 1}
              label="Its sound"
              format={(v) => `${Math.round(v * 100)}%`}
              playback={playback}
              onChange={(volume) => onVolume(volume, `segment:${segment.id}:volume`)}
            />
          )}
        </>
      ) : (
        <>
          <Hint more="Drag its edges to trim it, or drag it to another place. Its ends snap to words.">
            {formatPrecise(segment.start)} – {formatPrecise(segment.end)} of the episode · {segmentLength(segment).toFixed(1)} s
          </Hint>
          <Slider
            label="This Segment's sound"
            value={segment.volume ?? 1}
            min={0}
            max={2}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(volume) => onChange({ ...segment, volume }, `segment:${segment.id}:volume`)}
          />
          <Slider
            label="The episode's sound, in every Segment"
            value={sourceVolume}
            min={0}
            max={2}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={onSourceVolume}
          />
          {scene}
        </>
      )}
    </div>
  );
}

/**
 * A video's Segment's Framing: its Transform and Crop, and its Background, each field one group of
 * the history. Its Transform is shown as it is at the playhead, and its X, Y, Scale, Rotation and
 * Opacity have their ‹ ◆ › (ADR 0008): a keyed one is set as a Keyframe there. Reset drops the
 * Transform's Keyframes.
 */
export function FramingFields({
  segment,
  framing,
  item,
  playback,
  span,
  onChange,
  onCropMode,
}: {
  segment: ClipSegment;
  framing: Framing;
  item: MediaItem | undefined;
  playback: Playback;
  // Where it plays on the Timeline (keying.ts' segmentSpan), which its Keyframes are set in.
  span: KeySpan | null;
  onChange: (segment: ClipSegment, group: string) => void;
  onCropMode?: () => void;
}) {
  const time = useKeyTime(playback);
  const keys = segment.keys ?? {};
  const at = span && keyTime(span, time);
  const shown = shownTransform(framing.transform, keys, at ?? (span ? heldKeyTime(span, time) : 0));
  const notify = useKeyNotice();
  const set = <K extends keyof Framing>(part: K, value: Framing[K], field: string) =>
    onChange({ ...segment, framing: { ...framing, [part]: value } }, `segment:${segment.id}:${part}.${field}`);
  return (
    <>
      <TransformFields
        transform={shown}
        crop={framing.crop}
        size={mediaSize(item)}
        defaults={IDENTITY}
        onChange={(next, field) => {
          const written = writtenTransform(framing.transform, keys, next, at, shown);
          if (written.full) return notify(tooManyKeys(written.full));
          onChange(
            { ...segment, keys: written.keys, framing: { ...framing, transform: written.transform } },
            keyedGroup(`segment:${segment.id}:transform.${field}`, written.keys !== keys, at),
          );
        }}
        onCrop={(crop, field, transform) =>
          onChange(transform ? resetFraming(segment, transform) : { ...segment, framing: { ...framing, crop } }, `segment:${segment.id}:crop.${field}`)
        }
        onCropMode={onCropMode}
        keyed={{ item: { kind: "segment", id: segment.id }, keys, inside: at !== null }}
      />
      <BackgroundFields background={framing.background} onChange={(background, field) => set("background", background, field)} />
    </>
  );
}

/**
 * "Add from the episode": the Transcript, on which a range is picked (a click on its first and last
 * Word, or a drag across them) and added to the Main Track as a new Segment.
 */
export function SourcePicker({ transcript, near, onAdd }: { transcript: Transcript; near: ClipSegment; onAdd: (range: { start: number; end: number }) => void }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ first: number; last: number | null } | null>(null);
  const words = transcript.words;
  const range =
    pending && pending.last !== null
      ? { start: words[Math.min(pending.first, pending.last)].start, end: words[Math.max(pending.first, pending.last)].end }
      : null;
  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden size={18} />
        Add from the episode
      </Button>
    );
  }
  return (
    <section aria-labelledby="source-picker-heading" className="flex flex-col gap-2 rounded-control bg-fill p-2">
      <div className="flex items-center justify-between gap-2">
        <h3 id="source-picker-heading" className="text-sm font-semibold">
          Add from the episode
        </h3>
        <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Close">
          <X aria-hidden size={16} />
        </Button>
      </div>
      <p className="text-xs text-pretty text-muted">Click the first and the last word of the moment, or drag across them.</p>
      <div className="max-h-72 overflow-y-auto">
        <TranscriptPicker
          words={words}
          segments={transcript.segments}
          start={near.start}
          end={near.end}
          pending={pending}
          onPick={(i) => setPending((old) => (old && old.last === null ? { first: old.first, last: i } : { first: i, last: null }))}
          onRange={setPending}
        />
      </div>
      <Button
        variant="primary"
        size="sm"
        disabled={!range}
        onClick={() => {
          if (!range) return;
          onAdd(range);
          setPending(null);
          setOpen(false);
        }}
      >
        {range ? `Add ${formatPrecise(range.start)} – ${formatPrecise(range.end)}` : "Pick a moment"}
      </Button>
    </section>
  );
}
