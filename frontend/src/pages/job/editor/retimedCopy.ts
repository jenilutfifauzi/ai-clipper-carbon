import { useEffect, useState } from "react";
import { api, mediaProxyUrl, type AudioEvent, type OverlayEvent, type RetimedCopy, type RetimedRange, type SegmentPlan } from "../../../api";
import { eventSpan, PLAYABLE_SPEEDS, type follow } from "./follow";
import { paceOf } from "./segmentTime";

/**
 * The preview's Retimed copies (docs/adr/0009) of a Media Library video or of a Job's Source, which
 * the backend makes in the background when asked (app/retimed.py): a reversed item's range played backwards, and an item's range at a Speed a
 * browser won't play (outside 0.25–4×) retimed at it, its sound made as the render makes it. A
 * reversed copy plays forwards at the item's Speed; a retimed one at the preview rate only. Until it
 * is made, the item shows the frame the copy will show first, held, with the copy's progress, while
 * the Timeline time runs on.
 */

// How often a copy being made is asked after.
const POLL_MS = 500;
// How long a copy stays wanted before it is asked for.
export const SETTLE_MS = 300;
// A frame of a Media Library video (normalized to 30 fps).
const FRAME_SECS = 1 / 30;
// Copies made, by item and range, with what was asked: an item shown again, or one whose range a
// copy made covers (a split or a trim inward), plays from it at once.
const made = new Map<string, { ask: RetimedAsk; copy: RetimedCopy }>();
// A copy asked for, not heard of yet.
const ASKED: RetimedCopy = { progress: 0, url: null, at: null, error: null };

/** A range of an item's file, as it plays: at its Speed, forwards or in Reverse, its pitch following the Speed with `pitch`. */
interface PlayedItem {
  start: number;
  end: number;
  speed?: number;
  reverse?: boolean;
  pitch?: boolean;
}

/**
 * The preview copy an item playing `played` plays from: at a Speed outside PLAYABLE_SPEEDS, its
 * range retimed at it (and reversed if it is); else in Reverse, its range reversed (played at its
 * Speed); null for an item played from its own file. (The backend's twin: `copies_played` in
 * app/retimed.py.)
 */
export function previewCopyOf({ start, end, speed = 1, reverse = false, pitch = false }: PlayedItem): RetimedRange | null {
  if (speed < PLAYABLE_SPEEDS.min || speed > PLAYABLE_SPEEDS.max) return { start, end, reverse, speed, pitch };
  return reverse ? { start, end, reverse: true } : null;
}

/** The preview copy a Segment of the plan plays from (`previewCopyOf`), if any: of its range, unless it is a Freeze frame. */
export const segmentCopy = (segment: SegmentPlan): RetimedRange | null =>
  segment.hold != null ? null : previewCopyOf({ ...segment, start: segment.source_start, end: segment.source_end });

/** A plan's Overlay video or its sound, as it plays. */
type PlayedEvent = Pick<OverlayEvent | AudioEvent, "start" | "end" | "offset" | "speed" | "pitch" | "reverse">;

/** The preview copy a plan's Overlay video or its sound plays from (`previewCopyOf`), if any: of `(end − start) × speed` from its offset. */
export const eventCopy = ({ start, end, offset, speed = 1, pitch, reverse }: PlayedEvent) =>
  previewCopyOf({ start: offset, end: offset + (end - start) * speed, speed, pitch, reverse });

/** What a Retimed copy is of: a Media Library video, or a Job's Source. */
export type RetimedItem = { media: string } | { job: string };

/** A copy of a range of a Media Library video's, or of a Job's Source, to ask for. */
export type RetimedAsk = RetimedItem & { range: RetimedRange };

const itemOf = (ask: RetimedAsk) => ("media" in ask ? ask.media : `job:${ask.job}`);

const keyOf = (ask: RetimedAsk) => {
  const { range } = ask;
  return `${itemOf(ask)}:${range.start}:${range.end}:${range.reverse ? "reversed" : "forwards"}:${range.speed ?? 1}:${range.pitch ? "pitch" : ""}`;
};

/**
 * What a copy made (of `copies`, by what was asked for it) gives for `ask`: one of the same item,
 * retimed alike, whose range covers `ask`'s (as the backend's `Retime.covers`), from where in it
 * `ask`'s range starts (from the end of its range in Reverse, at its Speed). So a split or a trim
 * inward asks for no copy. Undefined when none covers it.
 */
export function servedBy(ask: RetimedAsk, copies: Iterable<{ ask: RetimedAsk; copy: RetimedCopy }>): RetimedCopy | undefined {
  const wanted = ask.range;
  const speed = wanted.speed ?? 1;
  for (const { ask: other, copy } of copies) {
    const range = other.range;
    const alike = !!range.reverse === !!wanted.reverse && (range.speed ?? 1) === speed && !!range.pitch === !!wanted.pitch;
    if (itemOf(other) !== itemOf(ask) || !alike || copy.at == null) continue;
    if (range.start > wanted.start + 0.0005 || range.end < wanted.end - 0.0005) continue;
    const into = wanted.reverse ? range.end - wanted.end : wanted.start - range.start;
    return { ...copy, at: Math.round((copy.at + into / speed) * 1e6) / 1e6 };
  }
  return undefined;
}

// The copy made for `ask`, or one serving it (kept as its own, so that it is the same each time).
function known(ask: RetimedAsk): RetimedCopy | undefined {
  const key = keyOf(ask);
  const found = made.get(key)?.copy ?? servedBy(ask, made.values());
  if (found && !made.has(key)) made.set(key, { ask, copy: found });
  return found;
}

const asked = (ask: RetimedAsk, signal: AbortSignal) =>
  "media" in ask ? api.retimedCopy(ask.media, ask.range, signal) : api.sourceRetimedCopy(ask.job, ask.range, signal);

/**
 * Each of `asks` not made yet asked for once it has stayed wanted SETTLE_MS (so the Speed slider
 * dragged past 4× asks only for the Speed it stops at, not one copy per step), then polled until it
 * is made, every answer told to `heard` by its key. Returns what stops it all: an ask stopped before
 * it settles is never sent.
 */
export function askCopies(asks: readonly (RetimedAsk | null)[], heard: (key: string, copy: RetimedCopy) => void): () => void {
  const abort = new AbortController();
  const timers: ReturnType<typeof setTimeout>[] = [];
  const pending = new Map(asks.flatMap((ask) => (ask && !known(ask) ? [[keyOf(ask), ask] as const] : [])));
  for (const [key, item] of pending) {
    const ask = () =>
      asked(item, abort.signal).then(
        (answer) => {
          if (answer.url) made.set(key, { ask: item, copy: answer });
          if (abort.signal.aborted) return;
          heard(key, answer);
          if (!answer.url && !answer.error) timers.push(setTimeout(ask, POLL_MS));
        },
        (reason: Error) => {
          if (!abort.signal.aborted) heard(key, { ...ASKED, error: reason.message });
        },
      );
    timers.push(setTimeout(ask, SETTLE_MS));
  }
  return () => {
    abort.abort();
    timers.forEach((timer) => clearTimeout(timer));
  };
}

/** The preview copies `asks` name, each asked for once settled and polled until it is made (askCopies); null for a null ask. */
export function useRetimedCopies(asks: (RetimedAsk | null)[]): (RetimedCopy | null)[] {
  const keys = asks.map((ask) => (ask ? keyOf(ask) : null));
  const [heard, setHeard] = useState<ReadonlyMap<string, RetimedCopy>>(new Map());
  const wanted = keys.join("|");
  // `asks` is new on each render: `wanted` names what it asks for.
  useEffect(() => askCopies(asks, (key, answer) => setHeard((before) => new Map(before).set(key, answer))), [wanted]);
  return asks.map((ask, i) => (ask === null ? null : (known(ask) ?? heard.get(keys[i]!) ?? ASKED)));
}

/** The preview copy of `media`'s `range`, asked for and polled until it is made; null for no `media` or `range`. */
export function useRetimedCopy(media: string | null, range: RetimedRange | null): RetimedCopy | null {
  return useRetimedCopies([media && range ? { media, range } : null])[0];
}

/** What a copy being made, or that failed, says over its item (`what`: "video", or "Segment" for the Source's). */
export function copyProgress(range: RetimedRange, copy: RetimedCopy, what = "video"): string {
  const verb = (range.speed ?? 1) === 1 ? "reverse" : "retime";
  if (copy.error) return `Couldn't ${verb} this ${what}`;
  return `${verb === "reverse" ? "Reversing" : "Retiming"}… ${Math.round(copy.progress * 100)}%`;
}

/** What a media element plays (its proxy, or a copy) and how it follows the playback (`follow`). */
export interface MediaPlay {
  src: string;
  span: Parameters<typeof follow>[2];
}

/**
 * How an item shown from `start` to `end` on the Timeline, playing `played` of `media`, plays from
 * `range`'s `copy`: forwards from where the copy shows its range, at the item's Speed when the copy
 * is only reversed, at the preview rate when it is retimed; or, until it is made, `proxy` held at the
 * frame the copy shows first (in Reverse, the last before its range's end, a `frame` long).
 */
function fromCopy(
  start: number,
  end: number,
  played: PlayedItem,
  range: RetimedRange,
  copy: RetimedCopy | null,
  proxy: string,
  frame = FRAME_SECS,
): MediaPlay {
  if (copy?.url && copy.at != null) {
    const retimed = (range.speed ?? 1) !== 1;
    return { src: copy.url, span: { start, end, from: copy.at, ...(retimed ? {} : { pitch: played.pitch, speed: played.speed }) } };
  }
  const first = played.reverse ? Math.max(played.start, played.end - frame) : played.start;
  return { src: proxy, span: { start, end, from: first, hold: end - start } };
}

/**
 * How a media Segment, shown until `end`, plays: its proxy over its range at its Speed; or, when it
 * plays from a copy (`segmentCopy`), from its `copy` (`fromCopy`).
 */
export function mediaPlay(segment: SegmentPlan, end: number, copy: RetimedCopy | null): MediaPlay {
  const proxy = mediaProxyUrl(segment.media!);
  const range = segmentCopy(segment);
  if (!range) return { src: proxy, span: { start: segment.start, end, from: segment.source_start, pitch: segment.pitch, ...paceOf(segment) } };
  const played = { start: segment.source_start, end: segment.source_end, speed: segment.speed, reverse: segment.reverse, pitch: segment.pitch };
  return fromCopy(segment.start, end, played, range, copy, proxy);
}

/**
 * How a Segment of the Source that plays from a copy (`segmentCopy`, which is `range`), shown until
 * `end`, plays on its own videos: from its `copy` (`fromCopy`), or until it is made, the Source's
 * `src` held at the frame the copy shows first, a `frame` of the Source long.
 */
export function sourcePlay(segment: SegmentPlan, end: number, range: RetimedRange, copy: RetimedCopy | null, src: string, frame: number): MediaPlay {
  const played = { start: segment.source_start, end: segment.source_end, speed: segment.speed, reverse: segment.reverse, pitch: segment.pitch };
  return fromCopy(segment.start, end, played, range, copy, src, frame);
}

/**
 * How a plan's Overlay video (or its sound) plays: `file` (its proxy, or for its sound its item) from
 * its offset at its Speed; or, when it plays from a copy (`eventCopy`), from its `copy` (`fromCopy`).
 */
export function eventPlay(event: PlayedEvent, file: string, copy: RetimedCopy | null): MediaPlay {
  const { start, end, speed, pitch, reverse } = event;
  const range = eventCopy(event);
  if (!range) return { src: file, span: eventSpan(event) };
  return fromCopy(start, end, { start: range.start, end: range.end, speed, pitch, reverse }, range, copy, file);
}
