import { Clapperboard, Copy, Film, Link2, Plus, Scissors, Trash2, Unlink2, X } from "lucide-react";
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
import type { RetimedAsk } from "../editor/retimedCopy";
import { rangeOf, segmentLength, sourceAt, type SegmentRange } from "../editor/segmentTime";
import { FADE_MAX_SECS } from "./edits";
import { KeyedVolume, MutedSwitch } from "./KeyCluster";
import { resetFraming, type KeySpan } from "./keying";
import { HoldFields, SpeedFields } from "./SpeedFields";
import { BackgroundFields, TransformFields, useKeyedTransform } from "./TransformFields";

// The shortest Segment the editor makes; the backend snaps each to Words.
export const SEGMENT_MIN_SECS = 0.3;
// The shortest a video's Segment plays on the Timeline (MIN_MEDIA_SECS in backend/app/review.py).
export const MEDIA_MIN_SECS = 0.1;

/**
 * The Main Track's Segments after a drag of Segment `id` from `origin` (the Segments when the drag
 * began), given how the track was drawn then (`shown`: each Segment's span on the Timeline, cut short
 * where a Transition into the next starts) and planned (`planned`: each Segment's whole span and its
 * range of the Source or its video, snapped to Words). Moved, it takes the place its middle is
 * dragged to. Its start or end trimmed, its planned edge moves as far as the drawn one did, times its
 * Speed in its file (within its file's `lengthOf`, and for one of the Source within the `longest`
 * clip of it), at least SEGMENT_MIN_SECS on the Timeline; the Segments after it close up behind it.
 * In Reverse its left edge is its range's end, and its right edge its start (ADR 0009).
 */
export function draggedSegments(
  origin: ClipSegment[],
  id: string,
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  lengthOf: (segment: ClipSegment) => number,
  shown: PlayedSegment[],
  planned: PlayedSegment[],
  longest = Infinity,
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
  // A Freeze frame's edges change its hold.
  if (segment.hold != null) return origin.map((other) => (other.id === id ? { ...segment, hold: draggedHold(change, drawn, range, shown, longest) } : other));
  // The least and the most of its file it can show.
  const least = SEGMENT_MIN_SECS * (range.speed ?? 1);
  const most = segment.media ? Infinity : longest;
  // What its file shows at the dragged edge now; in Reverse, its left edge shows its range's end and
  // its right edge its start.
  const there = sourceAt(range, change.edge === "start" ? change.start - drawn.start : segmentLength(range) + change.end - drawn.end);
  const next =
    (change.edge === "start") !== !!segment.reverse
      ? { ...segment, start: round(Math.min(Math.max(there, 0, range.end - most), range.end - least)), end: range.end }
      : { ...segment, start: range.start, end: round(Math.max(Math.min(there, lengthOf(segment), range.start + most), range.start + least)) };
  return origin.map((other) => (other.id === id ? next : other));
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

// A Freeze frame's hold once either edge is dragged (the frame stays): longer by as much as the edge
// went out, at least MEDIA_MIN_SECS, and no longer than keeps the Main Track (as `shown`) within the
// `longest` clip.
function draggedHold(
  change: { start: number; end: number; edge: "move" | "start" | "end" },
  drawn: PlayedSegment,
  held: SegmentRange,
  shown: PlayedSegment[],
  longest: number,
): number {
  const was = segmentLength(held);
  const by = change.edge === "start" ? drawn.start - change.start : change.end - drawn.end;
  const most = longest - ((shown.at(-1)?.end ?? was) - was);
  return round(Math.max(Math.min(was + by, most), MEDIA_MIN_SECS));
}

// The longest video Segment: the longest video the Media Library takes (MAX_SECS in backend/app/media.py).
const VIDEO_MAX_SECS = 180;

/**
 * The longest clip of a Job whose range goes up to `maxSecs`: on the Timeline, and a Segment's range
 * of the Source (MAX_CLIP_SECS and `longest` in backend/app/review.py).
 */
export const longestClip = (maxSecs: number) => Math.max(180, maxSecs);

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
  onFade,
  onSpeed,
  onReverse,
  onHold,
  onChange,
  onCropMode,
  onDetach,
  onReattach,
  scene,
  captions,
  playback,
  span,
  copy,
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
  // Its own volume (a keyed one's as a Keyframe at the playhead).
  onVolume: (volume: number, group: string) => void;
  // A fade set (actions.ts' setFade), as its Fade Ramp's handle sets it.
  onFade: (fade: "fade_in" | "fade_out", secs: number, group: string) => void;
  // Its Speed set (actions.ts' setSpeed), a change of `group`.
  onSpeed: (speed: number, group: string) => void;
  // Its Reverse turned on or off (actions.ts' setReverse).
  onReverse: (reverse: boolean) => void;
  // A Freeze frame's hold set (actions.ts' setHold).
  onHold: (hold: number) => void;
  onChange: (segment: ClipSegment, group: string) => void;
  // A video's Segment's Crop mode on the stage, when it can be opened there.
  onCropMode?: () => void;
  // Its sound Detached onto a Music Clip, or the Music Clips Detached from it deleted (GLOSSARY.md,
  // Detach), each where it is offered.
  onDetach?: () => void;
  onReattach?: () => void;
  // A Segment of the episode's: how its Scene at the playhead is framed.
  scene?: ReactNode;
  // A video's Segment's captions: its Captions switch, its video's language and its Words status.
  captions?: ReactNode;
  playback: Playback;
  // Where it plays on the Timeline (keying.ts' segmentSpan), which its Keyframes are set in.
  span: KeySpan | null;
  // The Retimed copy the preview plays it from, if any.
  copy: RetimedAsk | null;
}) {
  const Icon = segment.media ? Clapperboard : Film;
  // A Freeze frame holds one frame, silent: its Duration instead of a Speed, and no sound.
  const held = segment.hold != null;
  const range = (of: string) =>
    held
      ? `Holds ${formatPrecise(segment.start)} of ${of} · ${segmentLength(segment).toFixed(1)} s`
      : segment.reverse
        ? `${formatPrecise(segment.end)} back to ${formatPrecise(segment.start)} of ${of} · ${segmentLength(segment).toFixed(1)} s`
        : `${formatPrecise(segment.start)} – ${formatPrecise(segment.end)} of ${of} · ${segmentLength(segment).toFixed(1)} s`;
  const speed = held ? (
    <HoldFields hold={segment.hold!} onHold={onHold} />
  ) : (
    <SpeedFields
      speed={segment.speed ?? 1}
      pitch={segment.pitch ?? false}
      reverse={segment.reverse ?? false}
      heard={!segment.media || item?.has_audio !== false}
      group={`segment:${segment.id}:speed`}
      copy={copy}
      onSpeed={onSpeed}
      onPitch={(pitch) => onChange({ ...segment, pitch }, `segment:${segment.id}:pitch`)}
      onReverse={onReverse}
    />
  );
  const muteSwitch = (
    <>
      <MutedSwitch muted={segment.muted ?? false} onChange={(muted) => onChange({ ...segment, muted }, `segment:${segment.id}:muted`)} />
      <DetachButton onDetach={onDetach} onReattach={onReattach} />
    </>
  );
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
          <Hint more="Drag its edges to trim it, or drag it to another place.">{range("the video")}</Hint>
          {speed}
          {segment.framing && (
            <FramingFields segment={segment} framing={segment.framing} item={item} playback={playback} span={span} onChange={onChange} onCropMode={onCropMode} />
          )}
          {held ? null : item?.has_audio === false ? (
            <p className="text-sm text-muted">This video has no sound.</p>
          ) : (
            <>
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
              {muteSwitch}
            </>
          )}
          {!held && item?.has_audio !== false && <FadeFields segment={segment} onFade={onFade} />}
          {!held && !segment.reverse && item?.has_audio !== false && captions}
        </>
      ) : (
        <>
          <Hint
            more={
              held
                ? "Drag its edges to hold it longer or shorter, or drag it to another place."
                : "Drag its edges to trim it, or drag it to another place. Its ends snap to words."
            }
          >
            {range("the episode")}
          </Hint>
          {speed}
          {!held && (
            <>
              <KeyedVolume
                item={{ kind: "segment", id: segment.id }}
                span={span}
                keys={segment.keys?.volume ?? []}
                volume={segment.volume ?? 1}
                label="This Segment's sound"
                format={(v) => `${Math.round(v * 100)}%`}
                playback={playback}
                onChange={(volume) => onVolume(volume, `segment:${segment.id}:volume`)}
              />
              {muteSwitch}
              <FadeFields segment={segment} onFade={onFade} />
              <Slider
                label="The episode's sound, in every Segment"
                value={sourceVolume}
                min={0}
                max={2}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={onSourceVolume}
              />
            </>
          )}
          {scene}
        </>
      )}
    </div>
  );
}

/**
 * Detach audio, or Reattach audio once its sound is Detached (GLOSSARY.md, Detach): whichever is
 * offered, if either is.
 */
function DetachButton({ onDetach, onReattach }: { onDetach?: () => void; onReattach?: () => void }) {
  if (onReattach) {
    return (
      <Button size="sm" className="self-start in-data-sheet:min-h-11" onClick={onReattach} title="Delete the Music Clips its sound was Detached onto, and unmute it">
        <Link2 aria-hidden size={16} />
        Reattach audio
      </Button>
    );
  }
  if (!onDetach) return null;
  return (
    <Button size="sm" className="self-start in-data-sheet:min-h-11" onClick={onDetach} title="Move its sound onto a Music Clip that slides on its own (a J-cut or an L-cut), and Mute it">
      <Unlink2 aria-hidden size={16} />
      Detach audio
    </Button>
  );
}

/**
 * A Segment's fades, as a Music Clip's: each as long as 10 s, or as what the other leaves of it on the
 * Timeline (the plan fits them to it as heard, a Transition's overlap included).
 */
function FadeFields({ segment, onFade }: { segment: ClipSegment; onFade: (fade: "fade_in" | "fade_out", secs: number, group: string) => void }) {
  const length = segmentLength(segment);
  const most = (other: number) => Math.max(0, Math.min(FADE_MAX_SECS, length - other));
  const [fadeIn, fadeOut] = [segment.fade_in ?? 0, segment.fade_out ?? 0];
  const fade = (field: "fade_in" | "fade_out") => (secs: number) => onFade(field, secs, `segment:${segment.id}:${field}`);
  return (
    <>
      <Slider
        label="Fade in"
        value={Math.min(fadeIn, most(fadeOut))}
        min={0}
        max={most(fadeOut)}
        step={0.1}
        format={(v) => `${v.toFixed(1)} s`}
        onChange={fade("fade_in")}
      />
      <Slider
        label="Fade out"
        value={Math.min(fadeOut, most(fadeIn))}
        min={0}
        max={most(fadeIn)}
        step={0.1}
        format={(v) => `${v.toFixed(1)} s`}
        onChange={fade("fade_out")}
      />
    </>
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
  const fields = useKeyedTransform({
    item: { kind: "segment", id: segment.id },
    span,
    transform: framing.transform,
    keys: segment.keys ?? {},
    playback,
    group: `segment:${segment.id}:transform`,
    onWritten: (written, group) => onChange({ ...segment, keys: written.keys, framing: { ...framing, transform: written.transform } }, group),
  });
  const set = <K extends keyof Framing>(part: K, value: Framing[K], field: string) =>
    onChange({ ...segment, framing: { ...framing, [part]: value } }, `segment:${segment.id}:${part}.${field}`);
  return (
    <>
      <TransformFields
        {...fields}
        crop={framing.crop}
        size={mediaSize(item)}
        defaults={IDENTITY}
        onCrop={(crop, field, transform) =>
          onChange(transform ? resetFraming(segment, transform) : { ...segment, framing: { ...framing, crop } }, `segment:${segment.id}:crop.${field}`)
        }
        onCropMode={onCropMode}
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
