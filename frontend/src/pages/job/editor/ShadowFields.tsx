import type { ReactNode } from "react";
import type { DropShadow } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { shadowOn, withShadow } from "../advanced/textStyle";

const px = (value: number) => `${Math.round(value)} px`;

/**
 * The hook's or the captions' drop shadow, as a Text Layer's: on or off, and its colour, opacity,
 * blur, distance and angle. Each change is the whole shadow; `marker` resets it to the Preset's.
 */
export function ShadowFields({
  shadow,
  onChange,
  marker,
}: {
  shadow: DropShadow;
  onChange: (shadow: DropShadow) => void;
  marker: ReactNode;
}) {
  const set = <K extends keyof DropShadow>(field: K, value: DropShadow[K]) => onChange({ ...shadow, [field]: value });
  return (
    <>
      <Switch checked={shadowOn(shadow)} onChange={(on) => onChange(withShadow(shadow, on))}>
        <span className="flex items-center gap-1.5 text-sm">Drop shadow {marker}</span>
      </Switch>
      {shadowOn(shadow) && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <ColorField label="Shadow colour" value={shadow.colour} onChange={(colour) => set("colour", colour)} />
          <Slider
            label="Shadow opacity"
            value={shadow.opacity}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(opacity) => set("opacity", opacity)}
          />
          <Slider label="Blur" value={shadow.blur} min={0} max={100} format={px} onChange={(blur) => set("blur", blur)} />
          <Slider label="Distance" value={shadow.distance} min={0} max={100} format={px} onChange={(distance) => set("distance", distance)} />
          <Slider
            label="Angle"
            value={shadow.angle}
            min={-180}
            max={180}
            step={5}
            format={(v) => `${Math.round(v)}°`}
            onChange={(angle) => set("angle", angle)}
          />
        </div>
      )}
    </>
  );
}
