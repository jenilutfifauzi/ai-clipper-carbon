import { useId, useState } from "react";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { Group } from "../editor/StyleFields";
import { octaveOf, SPEED_CHIPS, SPEED_OCTAVES, SPEED_RANGE, speedAtOctave, speedLabel, speedOf } from "./speed";

/**
 * A Segment's or a video Overlay's Speed section (docs/adr/0009): chips of the common Speeds, a
 * slider over its octaves (0.0625–16×) and the Speed typed in, each a change of `group`; and, for an
 * item with sound (`heard`), the switch "Change pitch with speed".
 */
export function SpeedFields({
  speed,
  pitch,
  heard,
  group,
  onSpeed,
  onPitch,
}: {
  speed: number;
  pitch: boolean;
  heard: boolean;
  group: string;
  onSpeed: (speed: number, group: string) => void;
  onPitch: (pitch: boolean) => void;
}) {
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
              "min-h-8 rounded-lg text-sm font-medium tabular-nums",
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
    </Group>
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
            "w-full min-w-0 rounded-control border border-border bg-fill py-2 pr-8 pl-3 text-base text-text tabular-nums",
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
