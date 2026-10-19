import { ChevronLeft, ChevronRight, Diamond } from "lucide-react";
import { createContext, useContext, useRef } from "react";
import type { Keyframe, KeyProperty } from "../../../api";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { valueAt } from "../editor/keyframes";
import { usePlayback, type Playback } from "../editor/playback";
import type { Outcome } from "./actions";
import type { AdvancedEdits } from "./edits";
import { keysAround, keyState } from "./keyActions";
import { heldKeyTime, keyedItem, keyTime, manualSceneAt, pickedKeyed, toggleItemKey, type KeyedRef, type KeyScene, type KeySpan } from "./keying";
import { onlyItem } from "./pick";

/**
 * What the ‹ ◆ › clusters of the inspector and the Keyframes pane edit in: the edits and the Pick,
 * the locked Tracks, the playback, and where a Keyframe edit goes, as one change (of `group`, for a
 * drag or a field's typing). Without it (outside the Advanced Edit) there are no clusters.
 *
 * `touched` is the property last touched (a cluster used, a row of the Keyframes pane clicked), which
 * the active row is made of (see activeKey): what K and the pane's own ‹ ◆ › act on. `onNotice`
 * tells the owner why an edit was refused (a 101st Keyframe).
 */
export interface Keying extends KeyScene {
  playback: Playback;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  touched?: KeyProperty | null;
  onTouch?: (property: KeyProperty) => void;
  onNotice?: (text: string) => void;
}

export const KeyingContext = createContext<Keying | null>(null);

/** A Keyframe edit's outcome in `keying`: its edits as one change (of `group`), or, refused, its notice told. */
export function applyKeyed(keying: Keying, outcome: Outcome | null, group?: string) {
  if (outcome?.notice) keying.onNotice?.(outcome.notice);
  else if (outcome) keying.onEdits(outcome.edits, group);
}

/** What a keyable field tells the owner with when its edit is refused (a 101st Keyframe). Nothing outside the Advanced Edit. */
export function useKeyNotice(): (text: string) => void {
  const keying = useContext(KeyingContext);
  return (text) => keying?.onNotice?.(text);
}

/**
 * The one item picked that can have Keyframes (`pickedKeyed`): for a Segment of the Source, its
 * Manual Scene under the playhead when its own override frames it, followed as the playhead moves.
 */
export function usePickedKeyed(scene: KeyScene, playback: Playback): KeyedRef | null {
  const only = onlyItem(scene.pick);
  const id = only?.kind === "segment" ? only.id : null;
  const index = usePlayback(playback, (time) => (id !== null && scene.plan ? manualSceneAt(scene.edits, scene.plan, id, time) : null));
  return pickedKeyed(scene.pick, index);
}

/** What a keyable field calls as it changes: its property touched (K's active row). Nothing outside the Advanced Edit. */
export function useTouch(): (property: KeyProperty) => void {
  const keying = useContext(KeyingContext);
  return (property) => {
    if (keying?.touched !== property) keying?.onTouch?.(property);
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
 */
export function KeyCluster(props: { item: KeyedRef; property: KeyProperty; label: string }) {
  const keying = useContext(KeyingContext);
  return keying ? <Cluster keying={keying} {...props} /> : null;
}

function Cluster({ keying, item, property, label }: { keying: Keying; item: KeyedRef; property: KeyProperty; label: string }) {
  const time = useKeyTime(keying.playback);
  const keyed = keyedItem(keying.edits, item, keying.track, keying.plan);
  const at = keyed && keyTime(keyed, time);
  const keys = keyed?.keys[property] ?? [];
  const live = at != null;
  const state = live ? keyState(keys, at) : keys.length ? "elsewhere" : "constant";
  const { before, after } = live ? keysAround(keys, at) : { before: null, after: null };
  const seek = (to: number | null) => {
    keying.onTouch?.(property);
    if (keyed && to !== null) keying.playback.seek(keyed.start + to);
  };
  const toggle = () => {
    keying.onTouch?.(property);
    applyKeyed(keying, toggleItemKey(keying, item, property, time));
  };
  // In a phone's sheet, as tall as its other buttons (44 px), and narrow enough for three beside "Rotation".
  const button = "grid size-7 place-items-center rounded-full hover:bg-fill disabled:pointer-events-none disabled:opacity-35 in-data-sheet:h-11 in-data-sheet:w-8";
  const chevron = cx(button, "text-muted hover:text-text");
  return (
    <div role="group" aria-label={`${label} Keyframes`} className="-my-1 flex shrink-0 items-center in-data-sheet:my-0">
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

/**
 * A keyable volume's slider (a Music Clip's, an Overlay video's or a Segment's sound, `item`
 * playing over `span`): its value at the playhead (at the item's nearer end outside it), from its
 * Keyframes `keys` or its constant `volume`, with its ‹ ◆ ›; off outside the item once it is keyed.
 * `onChange` gets the playhead in the item's own seconds there (null outside it), where a keyed
 * change is written.
 */
export function KeyedVolume({
  item,
  span,
  keys,
  volume,
  label,
  format,
  playback,
  onChange,
}: {
  item: KeyedRef;
  span: KeySpan | null;
  keys: readonly Keyframe[];
  volume: number;
  label: string;
  format: (volume: number) => string;
  playback: Playback;
  onChange: (volume: number, at: number | null) => void;
}) {
  const time = useKeyTime(playback);
  const at = span && keyTime(span, time);
  return (
    <Slider
      label={label}
      value={valueAt(keys, at ?? (span ? heldKeyTime(span, time) : 0), volume)}
      min={0}
      max={2}
      step={0.05}
      format={format}
      onChange={(value) => onChange(value, at)}
      after={<KeyCluster item={item} property="volume" label={label} />}
      disabled={!!keys.length && at === null}
    />
  );
}

/**
 * The Muted switch beside a sound's volume (a Segment's, a Music Clip's or a video Overlay's): what M
 * does to the Pick, for this one item. Muted, it keeps its volume, Keyframes and fades.
 */
export function MutedSwitch({ muted, onChange }: { muted: boolean; onChange: (muted: boolean) => void }) {
  return (
    <Switch checked={muted} onChange={onChange}>
      <span className="flex flex-1 items-center justify-between gap-2 text-sm font-medium">
        Muted
        <kbd aria-hidden className="raised min-w-6 rounded-md px-1.5 py-0.5 text-center font-sans text-xs text-muted in-data-sheet:hidden">
          M
        </kbd>
      </span>
    </Switch>
  );
}
