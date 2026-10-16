import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { createContext, useContext, useRef } from "react";
import type { KeyProperty } from "../../../api";
import { cx } from "../../../format";
import { keysAround, keyState } from "../editor/keyframes";
import { usePlayback, type Playback } from "../editor/playback";
import type { AdvancedEdits } from "./edits";
import { keyedItem, keyTime, toggleItemKey, type KeyedRef, type KeyScene, type TouchedRow } from "./keying";

/**
 * What the ‹ ◆ › clusters of the inspector edit in: the edits and the Pick, the locked Tracks, the
 * playback, and where a Keyframe edit goes, as one change. Without it (outside the Advanced Edit)
 * there are no clusters. It keeps the property last touched too (`touched`, set by `onTouch`): K's
 * active row (`activeRow`).
 */
export interface Keying extends KeyScene {
  playback: Playback;
  onEdits: (edits: AdvancedEdits) => void;
  touched: TouchedRow | null;
  onTouch: (row: TouchedRow) => void;
}

export const KeyingContext = createContext<Keying | null>(null);

/** What a keyable field calls as it changes: its property of `item` touched, K's active row. Nothing outside the Advanced Edit. */
export function useTouch(): (item: KeyedRef, property: KeyProperty) => void {
  const keying = useContext(KeyingContext);
  return (item, property) => {
    const touched = keying?.touched;
    if (keying && !(touched?.property === property && touched.item.kind === item.kind && touched.item.id === item.id)) keying.onTouch({ item, property });
  };
}

/**
 * The time Keyframes are shown and set at: the playhead's while paused, and the last one paused at
 * while playing, as the stage's Grips are (ClipPreview), so that a frame doesn't draw the inspector again.
 */
export function useKeyTime(playback: Playback): number {
  const paused = useRef(playback.time);
  const time = usePlayback(playback, (now, p) => (p.playing ? null : now));
  if (time !== null) paused.current = time;
  return paused.current;
}

/**
 * The Keyframe cluster of `property` of item `item` (its field's `label`): ‹ moves the playhead to the
 * property's Keyframe before it, › to the one after, and the diamond adds a Keyframe at the playhead
 * with the value shown there, or removes the one there. The diamond is filled on a Keyframe,
 * outlined between them, and grey on a constant property. Off with the playhead outside the item.
 * Pressing any of them touches the property (K's active row).
 */
export function KeyCluster(props: { item: KeyedRef; property: KeyProperty; label: string }) {
  const keying = useContext(KeyingContext);
  return keying ? <Cluster keying={keying} {...props} /> : null;
}

function Cluster({ keying, item, property, label }: { keying: Keying; item: KeyedRef; property: KeyProperty; label: string }) {
  const time = useKeyTime(keying.playback);
  const touch = useTouch();
  const keyed = keyedItem(keying.edits, item);
  const at = keyed && keyTime(keyed, time);
  const keys = keyed?.keys[property] ?? [];
  const live = at != null;
  const state = live ? keyState(keys, at) : keys.length ? "elsewhere" : "constant";
  const { before, after } = live ? keysAround(keys, at) : { before: null, after: null };
  const seek = (to: number | null) => keyed && to !== null && keying.playback.seek(keyed.start + to);
  const toggle = () => {
    const outcome = toggleItemKey(keying, item, property, time);
    if (outcome) keying.onEdits(outcome.edits);
  };
  const button = "grid size-7 place-items-center rounded-full hover:bg-fill disabled:pointer-events-none disabled:opacity-35";
  const chevron = cx(button, "text-muted hover:text-text");
  return (
    <div role="group" aria-label={`${label} Keyframes`} className="-my-1 flex shrink-0 items-center" onClickCapture={() => touch(item, property)}>
      <button type="button" className={chevron} disabled={before === null} onClick={() => seek(before)} aria-label={`${label}: previous Keyframe`} title="Previous Keyframe">
        <ChevronLeft aria-hidden size={14} />
      </button>
      <button
        type="button"
        className={cx(button, state === "constant" ? "text-muted hover:text-text" : "text-accent-text")}
        disabled={!live}
        aria-pressed={state === "here"}
        onClick={toggle}
        aria-label={state === "here" ? `${label}: remove the Keyframe here` : `${label}: add a Keyframe here`}
        title={!live ? "Put the playhead on it to key it" : state === "here" ? "Remove the Keyframe here" : "Add a Keyframe here"}
      >
        <Diamond aria-hidden size={13} strokeWidth={2.25} fill={state === "here" ? "currentColor" : "none"} />
      </button>
      <button type="button" className={chevron} disabled={after === null} onClick={() => seek(after)} aria-label={`${label}: next Keyframe`} title="Next Keyframe">
        <ChevronRight aria-hidden size={14} />
      </button>
    </div>
  );
}
