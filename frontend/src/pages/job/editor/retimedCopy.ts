import { useEffect, useState } from "react";
import { api, mediaProxyUrl, type RetimedCopy, type SegmentPlan } from "../../../api";
import type { follow } from "./follow";
import { paceOf } from "./segmentTime";

/**
 * A reversed Segment's preview: its range played backwards from a preview-size Retimed copy
 * (docs/adr/0009) of its video or of the Source, which the backend makes in the background when asked
 * (app/retimed.py). The copy plays forwards at the Segment's Speed; until it is made, the Segment
 * shows the frame the copy will show first, held, with the copy's progress, while the Timeline time
 * runs on.
 */

// How often a copy being made is asked after.
const POLL_MS = 500;
// A frame of a Media Library video (normalized to 30 fps).
const FRAME_SECS = 1 / 30;
// Copies made, by video and range: a Segment shown again plays from its copy at once.
const made = new Map<string, RetimedCopy>();
// A copy asked for, not heard of yet.
const ASKED: RetimedCopy = { progress: 0, url: null, at: null, error: null };

/** What a Retimed copy is of: a Media Library video, or a Job's Source. */
export type RetimedItem = { media: string } | { job: string };

/** The preview copy of `item`'s range from `start` to `end`, backwards, asked for and polled until it is made; null for no `item`. */
export function useRetimedCopy(item: RetimedItem | null, start: number, end: number): RetimedCopy | null {
  const media = item && "media" in item ? item.media : null;
  const job = item && "job" in item ? item.job : null;
  const key = media ? `${media}:${start}:${end}` : job ? `job:${job}:${start}:${end}` : null;
  const [copy, setCopy] = useState<{ key: string; copy: RetimedCopy } | null>(null);
  useEffect(() => {
    if (!key || made.has(key)) return;
    const abort = new AbortController();
    let timer: number | undefined;
    const range = { start, end, reverse: true };
    const ask = () =>
      (media ? api.retimedCopy(media, range, abort.signal) : api.sourceRetimedCopy(job!, range, abort.signal)).then(
        (answer) => {
          if (answer.url) made.set(key, answer);
          setCopy({ key, copy: answer });
          if (!answer.url && !answer.error) timer = window.setTimeout(ask, POLL_MS);
        },
        (reason: Error) => {
          if (!abort.signal.aborted) setCopy({ key, copy: { ...ASKED, error: reason.message } });
        },
      );
    void ask();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [media, job, key, start, end]);
  if (!key) return null;
  return made.get(key) ?? (copy?.key === key ? copy.copy : ASKED);
}

/** What a media Segment's video plays (its proxy, or its copy) and how it follows the playback (`follow`). */
export interface MediaPlay {
  src: string;
  span: Parameters<typeof follow>[2];
}

/**
 * How a media Segment, shown until `end`, plays: forwards, its proxy over its range at its Speed; in
 * Reverse, as `reversedPlay` says, held on its proxy.
 */
export function mediaPlay(segment: SegmentPlan, end: number, copy: RetimedCopy | null): MediaPlay {
  const proxy = mediaProxyUrl(segment.media!);
  if (!segment.reverse) {
    return { src: proxy, span: { start: segment.start, end, from: segment.source_start, pitch: segment.pitch, ...paceOf(segment) } };
  }
  return reversedPlay(segment, end, copy, proxy, FRAME_SECS);
}

/**
 * How a reversed Segment, shown until `end`, plays: its `copy` forwards from where it shows the range,
 * at its Speed; or, until the copy is made, `held` (its video's or the Source's proxy) paused at the
 * frame the copy shows first, the last before its range's end (a `frame` long).
 */
export function reversedPlay(segment: SegmentPlan, end: number, copy: RetimedCopy | null, held: string, frame: number): MediaPlay {
  if (copy?.url && copy.at != null) {
    return { src: copy.url, span: { start: segment.start, end, from: copy.at, pitch: segment.pitch, speed: segment.speed } };
  }
  const first = Math.max(segment.source_start, segment.source_end - frame);
  return { src: held, span: { start: segment.start, end, from: first, hold: end - segment.start } };
}
