// What Word Edits, Cue Edits and Cues are keyed by: a time on a timeline, the Source's, or with
// `media` that Media Library item's (docs/adr/0020-media-words-and-cue-edits.md); the time to
// the millisecond, as the backend keeps them (review.py's _merged and _keyed).

/** A time `at` on a timeline: the Source's, or with `media` that Media Library item's. */
export interface TimelineKey {
  at: number;
  media?: string | null;
}

/** The timeline of a key (or of a Segment): its Media Library item's id, or null for the Source's. */
export const timelineOf = (key: { media?: string | null }) => key.media ?? null;

/** Whether `a` and `b` (keys, or Segments) are on one timeline. */
export const sameTimeline = (a: { media?: string | null }, b: { media?: string | null }) => timelineOf(a) === timelineOf(b);

const millis = (at: number) => Math.round(at * 1000);

/** Whether `a` and `b` (Word Edits, Cue Edits, Cues' keys) are keyed alike: one time of one timeline. */
export const sameKey = (a: TimelineKey, b: TimelineKey) => millis(a.at) === millis(b.at) && sameTimeline(a, b);

/** A key as text, "<media>@<at>" (no media: the Source's): one text for keys alike (sameKey). */
export const keyText = (key: TimelineKey) => `${key.media ?? ""}@${(millis(key.at) / 1000).toFixed(3)}`;

/** The order keyed items are kept in, as the backend saves them: the Source's first, then each item's, each in time order. */
export function byKey(a: TimelineKey, b: TimelineKey): number {
  const [x, y] = [timelineOf(a) ?? "", timelineOf(b) ?? ""];
  return x < y ? -1 : x > y ? 1 : a.at - b.at;
}

/** Whether `segment` shows the time `key` names: on its timeline, within its range. */
export const segmentHolds = (segment: { start: number; end: number; media?: string | null }, key: TimelineKey) =>
  sameTimeline(segment, key) && segment.start <= key.at && key.at <= segment.end;
