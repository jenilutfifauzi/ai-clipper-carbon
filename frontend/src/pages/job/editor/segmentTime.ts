/**
 * One mapping between Timeline time and Source time per Segment
 * (docs/adr/0009-speed-keeps-the-range-and-reverse-is-a-derived-copy.md): a Segment's length on the
 * Timeline, and which time of the Source (or of its video) shows a time into it on the Timeline, and
 * back. A copy of the backend's (backend/app/segment_time.py); both are tested on the cases in
 * backend/tests/fixtures/segment_times.json, so that they can't drift (ADR 0001).
 *
 * A Segment plays its range at its Speed, forwards or in Reverse, or holds the frame at its start
 * for its hold (a Freeze frame): forwards, `source = start + offset × speed`; in Reverse,
 * `source = end − offset × speed`; held, `source = start`; `offset` being seconds into it on the
 * Timeline.
 */

/** How a Segment plays its range: at `speed` (1), forwards or in `reverse`, or its first frame held for `hold` seconds. */
export interface Pace {
  speed?: number;
  reverse?: boolean;
  hold?: number | null;
}

/** A Segment's range, from `start` to `end` on the Source's timeline (or seconds into its video), and how it plays it. */
export interface SegmentRange extends Pace {
  start: number;
  end: number;
}

/**
 * A Segment as played: its range from `source_start` to `source_end`, from `start` to `end` seconds
 * into the Clip. Without `source_end`, its range is as long as it plays.
 */
export interface PlayedRange extends Pace {
  start: number;
  end: number;
  source_start: number;
  source_end?: number;
}

const toMillionth = (seconds: number) => Math.round(seconds * 1e6) / 1e6;

/** How long `segment` plays on the Timeline: its hold, or its range's length divided by its Speed. */
export function segmentLength(segment: SegmentRange): number {
  if (segment.hold != null) return segment.hold;
  return toMillionth((segment.end - segment.start) / (segment.speed ?? 1));
}

/** The Source time `segment` shows `offset` seconds into it on the Timeline. */
export function sourceAt(segment: SegmentRange, offset: number): number {
  if (segment.hold != null) return segment.start;
  const speed = segment.speed ?? 1;
  return segment.reverse ? segment.end - offset * speed : segment.start + offset * speed;
}

/** How many seconds into `segment` on the Timeline it shows `source`, a time in its range (its start, for a held one). */
export function offsetAt(segment: SegmentRange, source: number): number {
  if (segment.hold != null) return 0;
  const speed = segment.speed ?? 1;
  return segment.reverse ? (segment.end - source) / speed : (source - segment.start) / speed;
}

/**
 * Media an item plays forwards from `from` at `speed`, as a range open at its end: what a Segment's
 * Filmstrip and Waveform draw along it, from where it is at the item's left edge.
 */
export const playingFrom = (from: number, speed?: number): SegmentRange => ({ start: from, end: Infinity, ...paceOf({ speed }) });

/** The range of a Segment as played, and how it plays it. */
export function rangeOf(played: PlayedRange): SegmentRange {
  const end = played.source_end ?? played.source_start + (played.end - played.start) * (played.speed ?? 1);
  return { start: played.source_start, end, ...paceOf(played) };
}

/** The Source time a Segment as played shows at `time` seconds into the Clip. */
export const playedSourceAt = (played: PlayedRange, time: number) => sourceAt(rangeOf(played), time - played.start);

/** When, in seconds into the Clip, a Segment as played shows `source`. */
export const playedTimeAt = (played: PlayedRange, source: number) => played.start + offsetAt(rangeOf(played), source);

/** A Segment as played, cut short at `time` seconds into the Clip: the range it shows until then. */
export function playedUntil<T extends PlayedRange>(played: T, time: number): T {
  if (played.hold != null) return { ...played, end: time, hold: time - played.start };
  const cut = playedSourceAt(played, time);
  return played.reverse ? { ...played, end: time, source_start: cut } : { ...played, end: time, source_end: cut };
}

/** How `segment` plays: only what it says, so that a Segment forwards at 1× copies as it was. */
export function paceOf({ speed, reverse, hold }: Pace): Pace {
  return { ...(speed !== undefined && { speed }), ...(reverse !== undefined && { reverse }), ...(hold !== undefined && { hold }) };
}

/** How long a Transition of `secs` overlaps the Segments either side of its join, `before` and `after` long on the Timeline: half the shorter at most. */
export const transitionOverlap = (secs: number, before: number, after: number) => Math.round(Math.min(secs, before / 2, after / 2) * 1000) / 1000;

/**
 * How long a Main Track of `segments` lasts: their Timeline lengths, less the overlaps of their
 * Transitions, `joins` giving the length of the one after each (null: none).
 */
export function trackLength(segments: SegmentRange[], joins: (number | null)[]): number {
  const lengths = segments.map(segmentLength);
  let total = lengths.reduce((sum, length) => sum + length, 0);
  for (let i = 0; i + 1 < lengths.length; i++) {
    const secs = joins[i];
    if (secs != null) total -= transitionOverlap(secs, lengths[i], lengths[i + 1]);
  }
  return Math.round(total * 1000) / 1000;
}
