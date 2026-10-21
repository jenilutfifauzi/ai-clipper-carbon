import { Crop as CropIcon, FlipHorizontal2, FlipVertical2 } from "lucide-react";
import { useContext, useId, useState, type ReactNode } from "react";
import type { Background, Crop, Keys, Shape, TextLayer, Transform } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { croppedSize, NO_CROP, tidyCrop } from "../editor/cropGestures";
import { Group } from "../editor/StyleFields";
import { PICTURE_KEYS, type PictureKey } from "../editor/keyframes";
import { centreOf, useCanvas } from "../editor/canvas";
import { clamp, fillScale, SCALE_RANGE, STRETCH_RANGE } from "../editor/picture";
import type { Playback } from "../editor/playback";
import { keyedRange, shownTransform, tooManyKeys, writtenTransform } from "./keyActions";
import { KeyCluster, KeyingContext, useKeyNotice, useKeyTime, useTouch, type Keying } from "./KeyCluster";
import { heldKeyTime, keyedGroup, keyTime, resetTextLayer, type KeyedRef, type KeySpan } from "./keying";
import type { PictureLayerKind } from "./pick";

// A picture's fields that a Text Layer's Transform hasn't: its Crop, Fit, Fill and its stretch and flips.
interface PictureFields {
  crop: Crop;
  // Its item's picture, in pixels; undefined while the Media Library loads.
  size: { width: number; height: number } | undefined;
  // What Reset puts the Transform back to: a new Overlay's placement, or a Framing's fit (the identity).
  defaults: Transform;
  // The Crop set, with the Transform too when it is given (Reset): one change.
  onCrop: (crop: Crop, field: string, transform?: Transform) => void;
  onCropMode?: () => void;
  // An Overlay's Blend Mode menu, shown next to its opacity (BlendModeField).
  blend?: ReactNode;
}

type TransformFieldsProps = {
  transform: Transform;
  onChange: (transform: Transform, field: string) => void;
  keyed?: { item: KeyedRef; keys: Keys; inside: boolean };
} & (PictureFields | { onReset: () => void });

/**
 * A picture's Transform as numbers (ADR 0007): its centre, its scale in percent of its fitted size
 * and its stretch across and down, its rotation, flips and opacity; and Fit (scale 1, no stretch,
 * centred), Fill (the scale that covers the Canvas with what its Crop keeps of its item's `size`, as
 * turned: `fillScale`) and Reset (the Transform at its `defaults`, and no Crop, as one change). Its
 * Crop's four edges in percent of its width and height, tidied as they change (a tenth kept), and
 * with `onCropMode` a Crop button that opens Crop mode on the stage. Each field's changes are one
 * `group` of the history, named after it.
 *
 * A Text Layer's (ADR 0010), with `onReset` instead of a Crop, has its centre, scale, rotation and
 * opacity alone: its words, stroke and plate are drawn larger or smaller as they are, never
 * rewrapped, and it is never stretched, flipped nor cropped. Its Reset is `onReset`.
 *
 * With `keyed`, the item's X, Y, Scale, Rotation and Opacity have a ‹ ◆ › each (KeyCluster), and
 * `transform` is what is shown at the playhead (ADR 0008, useKeyedTransform); a keyed field, and Fit
 * and Fill when they would change one, are off while the playhead is outside the item, with a note.
 * A keyed Rotation takes ±3600°, as its Keyframes may; its constant, ±360°.
 */
export function TransformFields(props: TransformFieldsProps) {
  const { transform, onChange, keyed } = props;
  // A picture's, not a Text Layer's.
  const picture = "crop" in props;
  // A keyable field's cluster, and whether it is off.
  const cluster = (prop: PictureKey, label: string): ReactNode => keyed && <KeyCluster item={keyed.item} property={prop} label={label} />;
  const off = (prop: PictureKey) => !!keyed && !keyed.inside && !!keyed.keys[prop]?.length;
  const fitOff = off("x") || off("y") || off("scale");
  const touch = useTouch();
  const canvas = useCanvas();
  const set = (field: keyof Transform, value: Transform[keyof Transform]) => {
    if (keyed && (PICTURE_KEYS as readonly string[]).includes(field)) touch(field as PictureKey);
    onChange({ ...transform, [field]: value }, field);
  };
  return (
    <Group title="Transform">
      {PICTURE_KEYS.some(off) && <p className="text-sm text-pretty text-muted">Its keyed fields change with the playhead on it.</p>}
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="X" unit="px" value={transform.x} range={[0, canvas.width]} onChange={(x) => set("x", x)} cluster={cluster("x", "X")} disabled={off("x")} />
        <NumberField label="Y" unit="px" value={transform.y} range={[0, canvas.height]} onChange={(y) => set("y", y)} cluster={cluster("y", "Y")} disabled={off("y")} />
        <NumberField
          label="Scale"
          unit="%"
          value={transform.scale * 100}
          range={percents(SCALE_RANGE)}
          onChange={(scale) => set("scale", scale / 100)}
          cluster={cluster("scale", "Scale")}
          disabled={off("scale")}
        />
        <NumberField
          label="Rotation"
          unit="°"
          value={transform.rotation}
          range={keyedRange("rotation", !!keyed?.keys.rotation?.length, canvas)}
          onChange={(rotation) => set("rotation", rotation)}
          cluster={cluster("rotation", "Rotation")}
          disabled={off("rotation")}
        />
        {picture && (
          <>
            <NumberField label="Stretch ↔" unit="%" value={transform.stretch_x * 100} range={percents(STRETCH_RANGE)} onChange={(stretch) => set("stretch_x", stretch / 100)} />
            <NumberField label="Stretch ↕" unit="%" value={transform.stretch_y * 100} range={percents(STRETCH_RANGE)} onChange={(stretch) => set("stretch_y", stretch / 100)} />
          </>
        )}
      </div>
      {picture && (
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
      )}
      <Slider
        label="Opacity"
        value={transform.opacity}
        min={0}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(opacity) => set("opacity", opacity)}
        after={cluster("opacity", "Opacity")}
        disabled={off("opacity")}
      />
      {"crop" in props && props.blend}
      {"crop" in props ? (
        <CropAndFit picture={props} transform={transform} fitOff={fitOff} onChange={onChange} />
      ) : (
        <Button size="sm" variant="ghost" className="self-start" onClick={props.onReset}>
          Reset
        </Button>
      )}
    </Group>
  );
}

// A picture's Crop, and its Fit, Fill and Reset.
function CropAndFit({
  picture,
  transform,
  fitOff,
  onChange,
}: {
  picture: PictureFields;
  transform: Transform;
  fitOff: boolean;
  onChange: (transform: Transform, field: string) => void;
}) {
  const { crop, size, defaults, onCrop, onCropMode } = picture;
  const cut = (edge: keyof Crop) => (value: number) => onCrop(tidyCrop({ ...crop, [edge]: value / 100 }), edge);
  const kept = size && croppedSize(size, crop);
  const canvas = useCanvas();
  const centred = { ...centreOf(canvas), stretch_x: 1, stretch_y: 1 };
  return (
    <>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Crop</legend>
        {onCropMode && (
          <Button size="sm" className="mb-1.5 self-start" onClick={onCropMode} title="Crop on the video: drag its edges and corners">
            <CropIcon aria-hidden size={16} />
            Crop
          </Button>
        )}
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Left" unit="%" value={crop.left * 100} range={CUT_RANGE} onChange={cut("left")} />
          <NumberField label="Right" unit="%" value={crop.right * 100} range={CUT_RANGE} onChange={cut("right")} />
          <NumberField label="Top" unit="%" value={crop.top * 100} range={CUT_RANGE} onChange={cut("top")} />
          <NumberField label="Bottom" unit="%" value={crop.bottom * 100} range={CUT_RANGE} onChange={cut("bottom")} />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={fitOff} onClick={() => onChange({ ...transform, ...centred, scale: 1 }, "fit")}>
          Fit
        </Button>
        <Button
          size="sm"
          disabled={!kept || fitOff}
          onClick={() => kept && onChange({ ...transform, ...centred, scale: clamp(fillScale(kept.width, kept.height, transform.rotation, canvas), SCALE_RANGE) }, "fill")}
        >
          Fill
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onCrop(NO_CROP, "reset", defaults)}>
          Reset
        </Button>
      </div>
    </>
  );
}

/**
 * TransformFields' `transform`, `onChange` and `keyed` for an item whose Transform may be keyed (ADR
 * 0008), playing over `span` (none: shown as at its start): its Transform as it is at the playhead
 * (held at its ends outside it), and each change written there as a Keyframe of a keyed property
 * (writtenTransform), or refused with a notice when that would make too many. `onWritten` is given
 * its constants and Keyframes as written, and the change's history `group` with its field: a
 * Keyframe written at another time is a step of its own.
 */
export function useKeyedTransform({
  item,
  span,
  transform,
  keys,
  playback,
  group,
  onWritten,
}: {
  item: KeyedRef;
  span: KeySpan | null;
  transform: Transform;
  keys: Keys;
  playback: Playback;
  group: string;
  onWritten: (written: { transform: Transform; keys: Keys }, group: string) => void;
}): Pick<TransformFieldsProps, "transform" | "onChange" | "keyed"> {
  const time = useKeyTime(playback);
  const canvas = useCanvas();
  const at = span && keyTime(span, time);
  const shown = shownTransform(transform, keys, at ?? (span ? heldKeyTime(span, time) : 0), canvas);
  const notify = useKeyNotice();
  return {
    transform: shown,
    onChange: (next, field) => {
      const written = writtenTransform(transform, keys, next, at, canvas, shown);
      if (written.full) return notify(tooManyKeys(written.full));
      onWritten({ transform: written.transform, keys: written.keys }, keyedGroup(`${group}.${field}`, written.keys !== keys, at));
    },
    keyed: { item, keys, inside: at !== null },
  };
}

/**
 * A Text Layer's Transform as numbers (ADR 0007, 0010): TransformFields without a Crop, and Reset
 * unscaled, unturned and opaque, where it is (`resetTextLayer`).
 *
 * In the Advanced Edit (KeyingContext), its fields have a ‹ ◆ › each, as an Overlay's do: they show
 * the Transform at the playhead, a keyed field writes a Keyframe there (auto-key), and is off while
 * the playhead is outside the layer (ADR 0008).
 */
export function TextTransformFields({ layer, onChange }: { layer: TextLayer; onChange: (layer: TextLayer, group: string) => void }) {
  return <LayerTransformFields kind="text" layer={layer} onChange={onChange} />;
}

/** A Shape's Transform as numbers (docs/adr/0011), as a Text Layer's (TextTransformFields). */
export function ShapeTransformFields({ shape, onChange }: { shape: Shape; onChange: (shape: Shape, group: string) => void }) {
  return <LayerTransformFields kind="shape" layer={shape} onChange={onChange} />;
}

// A picture layer's Transform as numbers: a Text Layer's or a Shape's (`kind`).
function LayerTransformFields<T extends TextLayer | Shape>({
  kind,
  layer,
  onChange,
}: {
  kind: PictureLayerKind;
  layer: T;
  onChange: (layer: T, group: string) => void;
}) {
  const keying = useContext(KeyingContext);
  if (keying) return <KeyedLayerTransform keying={keying} kind={kind} layer={layer} onChange={onChange} />;
  return (
    <TransformFields
      transform={layer.transform}
      onChange={(transform, field) => onChange({ ...layer, transform }, `${kind}:${layer.id}:transform.${field}`)}
      onReset={() => onChange(resetTextLayer(layer), `${kind}:${layer.id}:transform.reset`)}
    />
  );
}

function KeyedLayerTransform<T extends TextLayer | Shape>({
  keying,
  kind,
  layer,
  onChange,
}: {
  keying: Keying;
  kind: PictureLayerKind;
  layer: T;
  onChange: (layer: T, group: string) => void;
}) {
  const fields = useKeyedTransform({
    item: { kind, id: layer.id },
    span: layer,
    transform: layer.transform,
    keys: layer.keys,
    playback: keying.playback,
    group: `${kind}:${layer.id}:transform`,
    onWritten: (written, group) => onChange({ ...layer, ...written }, group),
  });
  return <TransformFields {...fields} onReset={() => onChange(resetTextLayer(layer), `${kind}:${layer.id}:transform.reset`)} />;
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
 * field has focus (so "-" or "1." can be typed on the way to a number); each number it makes is a
 * change. `cluster` goes beside its label.
 */
function NumberField({
  label,
  unit,
  value,
  range,
  onChange,
  cluster,
  disabled,
}: {
  label: string;
  unit: string;
  value: number;
  range: readonly [number, number];
  onChange: (value: number) => void;
  cluster?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between gap-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {cluster}
      </div>
      <div className="relative">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={range[0]}
          max={range[1]}
          disabled={disabled}
          value={typed ?? String(Math.round(value * 10) / 10)}
          onChange={(event) => {
            setTyped(event.target.value);
            const number = event.target.valueAsNumber;
            if (Number.isFinite(number)) onChange(clamp(number, range));
          }}
          onBlur={() => setTyped(null)}
          className={cx(
            "w-full min-w-0 rounded-control border border-border bg-fill py-2 pr-8 pl-3 text-base text-text tabular-nums",
            "user-invalid:border-danger disabled:opacity-50",
          )}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-sm text-muted">
          {unit}
        </span>
      </div>
    </div>
  );
}
