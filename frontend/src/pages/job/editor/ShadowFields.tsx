import type { ReactNode } from "react";
import type { DropShadow } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { shadowOn, withShadow } from "./shadow";
import { Mixed } from "./StyleFields";

const px = (value: number) => `${Math.round(value)} px`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * How the shadow fields read and change a drop shadow: one style's, or several picked Text Layers'
 * at once, where a field they differ in shows the first one's value, marked Mixed.
 */
export interface ShadowAccess {
  // The shadow shown: the first one's, of several.
  shadow: DropShadow;
  // Whether they differ in what `read` reads.
  mixed(read: (shadow: DropShadow) => unknown): boolean;
  // Whether any of them passes `test`.
  any(test: (shadow: DropShadow) => boolean): boolean;
  // `change` made to each of them: one `field` set, or the shadow turned on or off (null).
  change(change: (shadow: DropShadow) => DropShadow, field: keyof DropShadow | null): void;
}

/**
 * A drop shadow's fields, as the hook's, the captions' and a Text Layer's have it: on or off, and,
 * while it is on (any of several), its colour, opacity, blur, distance and angle. `marker` follows
 * the switch's label. In the Advanced Edit's `inspector`, they are one to a row; in the clip
 * editor, two on a wide screen.
 */
export function shadowControls(access: ShadowAccess, { marker, inspector = false }: { marker?: ReactNode; inspector?: boolean } = {}): ReactNode {
  const fieldMarker = (field: keyof DropShadow) => (access.mixed((shadow) => shadow[field]) ? <Mixed /> : undefined);
  const format = (field: keyof DropShadow, format: (value: number) => string) => (value: number) =>
    access.mixed((shadow) => shadow[field]) ? "Mixed" : format(value);
  const set = <K extends keyof DropShadow>(field: K, value: DropShadow[K]) => access.change((shadow) => ({ ...shadow, [field]: value }), field);
  const fields = (
    <>
      <ColorField label="Shadow colour" value={access.shadow.colour} onChange={(colour) => set("colour", colour)} marker={fieldMarker("colour")} />
      <Slider
        label="Shadow opacity"
        value={access.shadow.opacity}
        min={0}
        max={1}
        step={0.05}
        format={format("opacity", percent)}
        onChange={(opacity) => set("opacity", opacity)}
      />
      <Slider label="Blur" value={access.shadow.blur} min={0} max={100} format={format("blur", px)} onChange={(blur) => set("blur", blur)} />
      <Slider label="Distance" value={access.shadow.distance} min={0} max={100} format={format("distance", px)} onChange={(distance) => set("distance", distance)} />
      <Slider
        label="Angle"
        value={access.shadow.angle}
        min={-180}
        max={180}
        step={5}
        format={format("angle", (v) => `${Math.round(v)}°`)}
        onChange={(angle) => set("angle", angle)}
      />
    </>
  );
  return (
    <>
      <Switch checked={shadowOn(access.shadow)} onChange={(on) => access.change((shadow) => withShadow(shadow, on), null)}>
        <span className={cx("flex items-center gap-1.5 text-sm", inspector && "font-medium")}>
          Drop shadow {access.mixed(shadowOn) ? <Mixed /> : marker}
        </span>
      </Switch>
      {access.any(shadowOn) && (inspector ? fields : <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">{fields}</div>)}
    </>
  );
}

/**
 * The hook's or the captions' drop shadow, as a Text Layer's: on or off, and its colour, opacity,
 * blur, distance and angle. Each change is the whole shadow; `marker` resets it to the Preset's.
 */
export function ShadowFields({ shadow, onChange, marker }: { shadow: DropShadow; onChange: (shadow: DropShadow) => void; marker: ReactNode }) {
  return shadowControls(
    { shadow, mixed: () => false, any: (test) => test(shadow), change: (change) => onChange(change(shadow)) },
    { marker },
  );
}
