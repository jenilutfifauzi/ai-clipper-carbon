import { useEffect, useRef, useSyncExternalStore } from "react";
import { api, type AudioEvent, type CandidateChange, type EffectedCopy, type RenderPlan, type SegmentPlan, type SoundKind } from "../../../api";
import { eventSound, segmentSound, type Heard, type Share } from "./loudness";
import { crossedBy } from "./transitionSound";

/**
 * The preview's Effected copies (GLOSSARY.md; docs/adr/0017): a sounding item with Audio Effects is
 * heard from a file the backend makes of it (app/effected.py), its sound before its volume through
 * the render's own chain, which the preview plays at 1× in the item's own time from a hidden audio
 * element (PreviewEffected.tsx), its volume, Keyframes, fades, duck and Transition share applied in
 * Web Audio as before. While the copy is made the item is heard from its own media, without its
 * effects, and the Inspector says "Preparing effects…" (`effectsPreparing`).
 *
 * A copy is asked for (`askWhenSettled`) once the plan's items have stayed as they are SETTLE_MS, by
 * what it is made from (`effectedAsks`' key): another volume, fade or place makes no new one. The
 * copies known, and which the plan shown wants, are kept here for the page, which the Inspector and
 * the preview both read.
 */

// How long the plan's asks stay the same before they are sent: a slider dragged asks only where it stops.
export const SETTLE_MS = 400;

/** An item whose sound can have a copy. */
export type EffectedRef = { kind: SoundKind; id: string };

/** A copy to ask for: of the item, by what it is made from (`key`). */
export type EffectedAsk = EffectedRef & { key: string };

// A copy as known: made (`url`, null for an item without one), being made, or failed (asked again
// with the next asks).
type Known = { url: string | null } | "making" | "failed";

const known = new Map<string, Known>();
// The plan's items that want a copy, by `refKey`, to the key of the one they want.
let wanted = new Map<string, string>();
// The items heard from their copy now (PreviewEffected's elements ready to play).
const heard = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

const refKey = ({ kind, id }: EffectedRef) => `${kind}:${id}`;

function changed() {
  version += 1;
  listeners.forEach((listener) => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** The kind of a plan's sound: an Overlay video's, or a Music Clip's. */
const eventKind = (plan: RenderPlan, event: AudioEvent): SoundKind => (plan.overlays.some((overlay) => overlay.id === event.id) ? "overlay" : "music");

/**
 * The copies `plan`'s items want: each Segment (not a Freeze frame, nor a silent video's), Music
 * Clip and Overlay video's sound with enabled Audio Effects that isn't Muted, keyed as the backend
 * keys it (`copy_key` in app/effected.py): by its media, range, Speed, pitch, Reverse, length and stack.
 */
export function effectedAsks(plan: RenderPlan | null): EffectedAsk[] {
  if (!plan) return [];
  const effects = (item: { audio_effects?: SegmentPlan["audio_effects"] }) => (item.audio_effects ?? []).filter((effect) => effect.enabled !== false);
  const segments = plan.segments
    .filter((segment) => effects(segment).length && segment.hold == null && !segment.silent && !segment.muted)
    .map((segment) => ({
      kind: "segment" as const,
      id: segment.id,
      key: JSON.stringify([
        segment.media ?? null,
        segment.source_start,
        segment.source_end,
        segment.speed ?? 1,
        !!segment.pitch,
        !!segment.reverse,
        round(segment.end - segment.start),
        stackOf(effects(segment)),
      ]),
    }));
  const sounds = plan.audio
    .filter((event) => effects(event).length && !event.muted)
    .map((event) => ({
      kind: eventKind(plan, event),
      id: event.id,
      key: JSON.stringify([event.media, event.offset, event.speed ?? 1, !!event.pitch, !!event.reverse, round(event.end - event.start), stackOf(effects(event))]),
    }));
  return [...segments, ...sounds];
}

const round = (secs: number) => Math.round(secs * 1e6) / 1e6;
const stackOf = (stack: NonNullable<SegmentPlan["audio_effects"]>) =>
  stack.map((effect) => [effect.id, Object.entries(effect.params ?? {}).sort(([a], [b]) => a.localeCompare(b))]);

/**
 * Wants `asks` (all the plan's: the others are wanted no more), and once they have stayed so for
 * SETTLE_MS, asks `request` for each copy not known (or failed before), once per key however many
 * items want it. Returns what stops it before it is sent.
 */
export function askWhenSettled(asks: readonly EffectedAsk[], request: (ask: EffectedAsk) => Promise<EffectedCopy>): () => void {
  wanted = new Map(asks.map((ask) => [refKey(ask), ask.key]));
  changed();
  const timer = setTimeout(() => {
    const asking = new Map(asks.filter((ask) => !known.has(ask.key) || known.get(ask.key) === "failed").map((ask) => [ask.key, ask]));
    for (const [key, ask] of asking) {
      known.set(key, "making");
      request(ask).then(
        (copy) => known.set(key, { url: copy.url ?? null }),
        () => known.set(key, "failed"),
      ).finally(changed);
    }
    if (asking.size) changed();
  }, SETTLE_MS);
  return () => clearTimeout(timer);
}

/** The url of the item's copy, once it is made for what the plan has it as now; null until then, or without one. */
export function urlOf(item: EffectedRef): string | null {
  const key = wanted.get(refKey(item));
  const copy = key === undefined ? undefined : known.get(key);
  return typeof copy === "object" ? copy.url : null;
}

/** Whether any of `items` wants a copy not made yet: "Preparing effects…" (the Inspector's). */
export function effectsPreparing(items: readonly EffectedRef[]): boolean {
  return items.some((item) => {
    const key = wanted.get(refKey(item));
    if (key === undefined) return false;
    const copy = known.get(key);
    return copy === undefined || copy === "making";
  });
}

/** Forgets the copy at `url` (it has gone: swept after a save), so that it is asked for again. */
export function lostCopy(url: string) {
  for (const [key, copy] of known) if (typeof copy === "object" && copy.url === url) known.delete(key);
  changed();
}

/** Forgets every copy (the tests'). */
export function forgetEffectedCopies() {
  known.clear();
  wanted = new Map();
  heard.clear();
  changed();
}

/** Whether `item` is heard from its copy now: its own media is silent while it is, and playing. */
export const heardFromCopy = (item: EffectedRef) => heard.has(refKey(item));

/** Sets whether `item` is heard from its copy (PreviewEffected.tsx, once its element can play). */
export function setHeardFromCopy(item: EffectedRef, on: boolean) {
  if (on) heard.add(refKey(item));
  else heard.delete(refKey(item));
}

/** Re-renders on every change to the copies known or wanted; gives a number that changes with them. */
export const useEffectedVersion = () => useSyncExternalStore(subscribe, () => version);

/**
 * Asks for the copies of `plan`'s items (`effectedAsks`, `askWhenSettled`) as the Candidate's
 * `draft` has them: the draft the plan was made of, so that the backend makes what the plan plays.
 * The Advanced Edit's and the Candidate editor's; the preview and the Inspector read what comes.
 */
export function useEffectedCopies(jobId: string, candidateId: string, draft: CandidateChange | null, plan: RenderPlan | null) {
  const latest = useRef(draft);
  latest.current = draft;
  const asks = effectedAsks(plan);
  const keys = asks.map((ask) => `${refKey(ask)}=${ask.key}`).join("|");
  // Changes when a copy has gone and is asked for again.
  const lost = useSyncExternalStore(subscribe, () => asks.filter((ask) => !known.has(ask.key)).length);
  useEffect(
    () => askWhenSettled(asks, (ask) => api.effectedCopy(jobId, candidateId, ask.kind, ask.id, latest.current)),
    // `asks` is new on each render: `keys` names what it asks for.
    [jobId, candidateId, keys, lost === 0],
  );
}

/** A copy heard: where it plays (`follow`'s span, at 1×) and how loud, as its item's own sound is. */
export interface CopySound {
  item: EffectedRef;
  url: string;
  span: { start: number; end: number; from: number };
  sound: Heard;
  crossed: Share;
}

/**
 * How each of `ready` (items of `plan` with their copies) is heard: from the copy's start at the
 * item's start, at 1×, over the item's whole span (a Segment's over a Transition's overlap either
 * side); as loud as its own sound: a Segment's volume or Keyframes (a Source one's times the Clip's
 * own), its fades, taken away by the Transition after it and brought in by the one before
 * (`segmentSound`, `crossedBy`); a Music Clip's or an Overlay's as heard (`eventSound`), ducked.
 */
export function copySounds(plan: RenderPlan, ready: readonly (EffectedRef & { url: string })[]): CopySound[] {
  return ready.flatMap((item): CopySound[] => {
    const { url } = item;
    if (item.kind === "segment") {
      const segment = plan.segments.find((other) => other.id === item.id);
      if (!segment) return [];
      const into = plan.transitions.find((transition) => Math.abs(transition.start - segment.start) < 0.01);
      const out = plan.transitions.find((transition) => transition.start > segment.start && Math.abs(transition.end - segment.end) < 0.01);
      const span = { start: segment.start, end: segment.end, from: 0 };
      return [{ item, url, span, sound: segmentSound(segment, plan.source_volume, out), crossed: crossedBy(into) }];
    }
    const event = plan.audio.find((other) => other.id === item.id && eventKind(plan, other) === item.kind);
    if (!event) return [];
    const span = { start: event.start, end: event.end, from: 0 };
    return [{ item, url, span, sound: eventSound(event, plan.source_volume, plan.ducking), crossed: () => 1 }];
  });
}

/** Whether `item`'s own media is silent now: while playing, it is heard from its copy (`heardFromCopy`). */
export const silencedForCopy = (item: EffectedRef, playback: { playing: boolean }) => playback.playing && heardFromCopy(item);
