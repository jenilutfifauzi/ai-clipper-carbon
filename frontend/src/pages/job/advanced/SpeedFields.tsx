import { useId, useState } from "react";
import type { ClipSegment, MediaItem, MusicClip, Overlay } from "../../../api";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { copyProgress, useRetimedCopies, type RetimedAsk } from "../editor/retimedCopy";
import { Group } from "../editor/StyleFields";
import type { SpeedRef } from "./actions";
import type { AdvancedEdits } from "./edits";
import { octaveOf, SPEED_CHIPS, SPEED_OCTAVES, SPEED_RANGE, speedAtOctave, speedLabel, speedOf } from "./speed";

/**
 * A Segment's, a video Overlay's or a Music Clip's Speed section (docs/adr/0009, 0016): chips of the
 * common Speeds, a slider over its octaves (0.0625–16×) and the Speed typed in, each a change of
 * `group`; for an item with sound (`heard`), the switch "Change pitch with speed"; and the switch
 * Reverse (R), with the progress of the Retimed copy the preview plays it from (`copy`), while it is
 * made.
 */
export function SpeedFields({
  speed,
  pitch,
  reverse,
  heard,
  group,
  copy,
  what,
  onSpeed,
  onPitch,
  onReverse,
}: {
  speed: number;
  pitch: boolean;
  reverse: boolean;
  heard: boolean;
  group: string;
  // The preview's copy of the item, as its plan plays it (retimedCopy.ts); null when it plays its own file.
  copy: RetimedAsk | null;
  // What the copy is of, as its failure names it: a "video" or a "Segment" by default, by `copy`.
  what?: string;
  onSpeed: (speed: number, group: string) => void;
  onPitch: (pitch: boolean) => void;
  onReverse: (reverse: boolean) => void;
}) {
  const [made] = useRetimedCopies([copy]);
  const set = (value: number) => {
    if (value !== speed) onSpeed(value, group);
  };
  return (
    <Group title="Speed">
      <div role="group" aria-label="Common speeds" className="grid grid-cols-6 gap-0.5 rounded-[10px] bg-fill p-0.5">
        {SPEED_CHIPS.map((chip) => (
          <button
            key={chip}
            type="button"
            aria-pressed={speed === chip}
            onClick={() => set(chip)}
            className={cx(
              "min-h-8 rounded-lg text-sm font-medium tabular-nums in-data-sheet:min-h-11",
              "focus-visible:outline-2 focus-visible:outline-focus",
              speed === chip ? "raised text-text" : "text-muted hover:text-text",
            )}
          >
            {speedLabel(chip)}
          </button>
        ))}
      </div>
      <Slider
        label="Any speed"
        value={octaveOf(speed)}
        min={SPEED_OCTAVES[0]}
        max={SPEED_OCTAVES[1]}
        step={0.01}
        format={(octave) => speedLabel(2 ** octave)}
        onChange={(octave) => set(speedAtOctave(octave))}
      />
      <SpeedNumber speed={speed} onChange={set} />
      {heard && (
        <Switch checked={pitch} onChange={onPitch}>
          <span className="text-sm font-medium">Change pitch with speed</span>
        </Switch>
      )}
      <Switch checked={reverse} onChange={onReverse}>
        <span className="flex flex-1 items-center justify-between gap-2 text-sm font-medium">
          Reverse
          <kbd aria-hidden className="raised min-w-6 rounded-md px-1.5 py-0.5 text-center font-sans text-xs text-muted in-data-sheet:hidden">
            R
          </kbd>
        </span>
      </Switch>
      {copy && made && !made.url && (
        <p aria-live="polite" className={cx("text-xs tabular-nums", made.error ? "text-danger" : "text-muted")}>
          {copyProgress(copy.range, made, what ?? ("media" in copy ? "video" : "Segment"))}
        </p>
      )}
    </Group>
  );
}

/**
 * The phone's Speed sheet, of `item` (actions.ts' `speedSheetItem`): the inspector's Speed section,
 * with each change the same history group as there; a Freeze frame's Duration instead.
 */
export function SpeedPanel({
  item,
  edits,
  mediaById,
  copyOf,
  onSpeed,
  onReverse,
  onHold,
  onSegment,
  onOverlay,
  onMusic,
}: {
  item: SpeedRef;
  edits: AdvancedEdits;
  mediaById: Map<string, MediaItem>;
  copyOf: (item: SpeedRef) => RetimedAsk | null;
  onSpeed: (item: SpeedRef, speed: number, group: string) => void;
  onReverse: (item: SpeedRef, reverse: boolean) => void;
  onHold: (id: string, hold: number) => void;
  onSegment: (segment: ClipSegment, group: string) => void;
  onOverlay: (overlay: Overlay, group: string) => void;
  onMusic: (clip: MusicClip, group: string) => void;
}) {
  const segment = item.kind === "segment" ? edits.segments.find((other) => other.id === item.id) : undefined;
  const overlay = item.kind === "overlay" ? edits.overlays.find((other) => other.id === item.id) : undefined;
  const clip = item.kind === "music" ? edits.music.find((other) => other.id === item.id) : undefined;
  if (segment?.hold != null) return <HoldFields key={segment.id} hold={segment.hold} onHold={(hold) => onHold(segment.id, hold)} />;
  const fields = segment
    ? {
        chosen: segment,
        heard: !segment.media || mediaById.get(segment.media)?.has_audio !== false,
        onPitch: (pitch: boolean) => onSegment({ ...segment, pitch }, `segment:${segment.id}:pitch`),
      }
    : overlay
      ? {
          chosen: overlay,
          heard: !!mediaById.get(overlay.media)?.has_audio,
          onPitch: (pitch: boolean) => onOverlay({ ...overlay, pitch }, `overlay:${overlay.id}:pitch`),
        }
      : clip && {
          chosen: clip,
          heard: true,
          onPitch: (pitch: boolean) => onMusic({ ...clip, pitch }, `music:${clip.id}:pitch`),
        };
  if (!fields) return null;
  const { chosen, heard, onPitch } = fields;
  return (
    <SpeedFields
      key={chosen.id}
      speed={chosen.speed ?? 1}
      pitch={chosen.pitch ?? false}
      reverse={chosen.reverse ?? false}
      heard={heard}
      group={`${item.kind}:${item.id}:speed`}
      copy={copyOf(item)}
      onSpeed={(speed, group) => onSpeed(item, speed, group)}
      onPitch={onPitch}
      onReverse={(reverse) => onReverse(item, reverse)}
    />
  );
}

/**
 * The Speed typed in (×). What is typed stays as it is while the field has focus; each number within
 * the Speed's range it makes is a change, and one outside it waits, so that "0.5" passes no 0.0625×
 * on its way.
 */
function SpeedNumber({ speed, onChange }: { speed: number; onChange: (speed: number) => void }) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const [low, high] = SPEED_RANGE;
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-sm font-medium">
        Exact speed
      </label>
      <div className="relative w-28">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={low}
          max={high}
          step="any"
          value={typed ?? String(speed)}
          onChange={(event) => {
            setTyped(event.target.value);
            const number = event.target.valueAsNumber;
            if (number >= low && number <= high) onChange(speedOf(number));
          }}
          onBlur={() => setTyped(null)}
          className={cx(
            "w-full min-w-0 rounded-control border border-border bg-fill py-2 pr-8 pl-3 text-base text-text tabular-nums in-data-sheet:min-h-11",
            "user-invalid:border-danger",
          )}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted">
          ×
        </span>
      </div>
    </div>
  );
}

/**
 * A Freeze frame's Duration, in place of the Speed section: how long it holds its frame, typed in
 * seconds and set when the field is left or Enter is pressed (one change, its ripple included). The
 * edit keeps it within 0.1 s and the longest clip.
 */
export function HoldFields({ hold, onHold }: { hold: number; onHold: (hold: number) => void }) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    const number = Number(typed);
    if (typed !== null && typed.trim() !== "" && Number.isFinite(number) && number !== hold) onHold(number);
    setTyped(null);
  };
  return (
    <Group title="Freeze frame">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          Duration
        </label>
        <div className="relative w-28">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            min={0.1}
            step="any"
            value={typed ?? String(hold)}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") commit();
            }}
            className={cx(
              "w-full min-w-0 rounded-control border border-border bg-fill py-2 pr-8 pl-3 text-base text-text tabular-nums in-data-sheet:min-h-11",
              "user-invalid:border-danger",
            )}
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted">
            s
          </span>
        </div>
      </div>
      <p className="text-xs text-pretty text-muted">It holds one frame, silent, while the music plays on. Drag either of its edges to change it too.</p>
    </Group>
  );
}
