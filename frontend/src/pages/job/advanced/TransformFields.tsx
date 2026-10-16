import { FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { useId, useState } from "react";
import type { Background, Crop, Transform } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { croppedSize, tidyCrop } from "../editor/cropGestures";
import { Group } from "../editor/StyleFields";
import { clamp, FRAME, fillScale, IDENTITY, SCALE_RANGE, STRETCH_RANGE } from "../editor/picture";

/**
 * A picture's Transform as numbers (ADR 0007): its centre, its scale and stretch in percent of its
 * fitted size, its rotation, flips and opacity; and Fit (scale 1, no stretch, centred), Fill (the
 * scale that covers the frame with what its Crop keeps of its item's `size`, as turned: `fillScale`) and Reset (every field
 * of the Transform at its identity). Its Crop's four edges in percent of its width and height,
 * tidied as they change (a tenth kept). Each field's changes are one `group` of the history, named
 * after it.
 */
export function TransformFields({
  transform,
  crop,
  size,
  onChange,
  onCrop,
}: {
  transform: Transform;
  crop: Crop;
  // Its item's picture, in pixels; undefined while the Media Library loads.
  size: { width: number; height: number } | undefined;
  onChange: (transform: Transform, field: string) => void;
  onCrop: (crop: Crop, field: string) => void;
}) {
  const set = (field: keyof Transform, value: Transform[keyof Transform]) => onChange({ ...transform, [field]: value }, field);
  const cut = (edge: keyof Crop) => (value: number) => onCrop(tidyCrop({ ...crop, [edge]: value / 100 }), edge);
  const kept = size && croppedSize(size, crop);
  const centred = { x: FRAME.width / 2, y: FRAME.height / 2, stretch_x: 1, stretch_y: 1 };
  return (
    <Group title="Transform">
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="X" unit="px" value={transform.x} range={[0, FRAME.width]} onChange={(x) => set("x", x)} />
        <NumberField label="Y" unit="px" value={transform.y} range={[0, FRAME.height]} onChange={(y) => set("y", y)} />
        <NumberField label="Scale" unit="%" value={transform.scale * 100} range={percents(SCALE_RANGE)} onChange={(scale) => set("scale", scale / 100)} />
        <NumberField label="Rotation" unit="°" value={transform.rotation} range={[-360, 360]} onChange={(rotation) => set("rotation", rotation)} />
        <NumberField label="Width" unit="%" value={transform.stretch_x * 100} range={percents(STRETCH_RANGE)} onChange={(stretch) => set("stretch_x", stretch / 100)} />
        <NumberField label="Height" unit="%" value={transform.stretch_y * 100} range={percents(STRETCH_RANGE)} onChange={(stretch) => set("stretch_y", stretch / 100)} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" aria-pressed={transform.flip_h} className="aria-pressed:text-accent-text" onClick={() => set("flip_h", !transform.flip_h)}>
          <FlipHorizontal2 aria-hidden size={16} />
          Flip ↔
        </Button>
        <Button size="sm" aria-pressed={transform.flip_v} className="aria-pressed:text-accent-text" onClick={() => set("flip_v", !transform.flip_v)}>
          <FlipVertical2 aria-hidden size={16} />
          Flip ↕
        </Button>
      </div>
      <Slider
        label="Opacity"
        value={transform.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => set("opacity", opacity)}
      />
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Crop</legend>
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Left" unit="%" value={crop.left * 100} range={CUT_RANGE} onChange={cut("left")} />
          <NumberField label="Right" unit="%" value={crop.right * 100} range={CUT_RANGE} onChange={cut("right")} />
          <NumberField label="Top" unit="%" value={crop.top * 100} range={CUT_RANGE} onChange={cut("top")} />
          <NumberField label="Bottom" unit="%" value={crop.bottom * 100} range={CUT_RANGE} onChange={cut("bottom")} />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => onChange({ ...transform, ...centred, scale: 1 }, "fit")}>
          Fit
        </Button>
        <Button
          size="sm"
          disabled={!kept}
          onClick={() => kept && onChange({ ...transform, ...centred, scale: clamp(fillScale(kept.width, kept.height, transform.rotation), SCALE_RANGE) }, "fill")}
        >
          Fill
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(IDENTITY, "reset")}>
          Reset
        </Button>
      </div>
    </Group>
  );
}

const BACKGROUNDS = [
  { value: "blur", label: "Blur" },
  { value: "colour", label: "Colour" },
] as const;

/**
 * A Framing's Background (ADR 0007): the picture itself blurred, or a colour, which shows wherever
 * the picture doesn't cover the frame. Each change is one `group` of the history, named after its field.
 */
export function BackgroundFields({ background, onChange }: { background: Background; onChange: (background: Background, field: string) => void }) {
  return (
    <Group title="Background">
      <Segmented
        legend="Behind the picture"
        options={BACKGROUNDS}
        value={background.kind}
        onChange={(kind: Background["kind"]) => onChange({ ...background, kind }, "kind")}
      />
      {background.kind === "colour" && <ColorField label="Colour" value={background.colour} onChange={(colour) => onChange({ ...background, colour }, "colour")} />}
    </Group>
  );
}

const percents = ([low, high]: readonly [number, number]) => [low * 100, high * 100] as const;

// An edge of the Crop cuts off at most 90% (backend/app/candidates.py).
const CUT_RANGE = [0, 90] as const;

/**
 * A number typed in, kept within `range`, shown to a tenth. What is typed stays as it is while the
 * field has focus (so "-" or "1." can be typed on the way to a number); each number it makes is a change.
 */
function NumberField({
  label,
  unit,
  value,
  range,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  range: readonly [number, number];
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={range[0]}
          max={range[1]}
          value={typed ?? String(Math.round(value * 10) / 10)}
          onChange={(event) => {
            setTyped(event.target.value);
            const number = event.target.valueAsNumber;
            if (Number.isFinite(number)) onChange(clamp(number, range));
          }}
          onBlur={() => setTyped(null)}
          className={cx(
            "w-full min-w-0 rounded-control border border-border bg-fill py-2 pr-8 pl-3 text-base text-text tabular-nums",
            "user-invalid:border-danger",
          )}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted">
          {unit}
        </span>
      </div>
    </div>
  );
}
