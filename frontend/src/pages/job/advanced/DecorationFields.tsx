import type { Border, Overlay, Shadow } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { Group } from "../editor/StyleFields";

// What a Border and a Shadow are when turned on (backend/app/candidates.py's defaults).
const BORDER: Border = { width: 8, colour: "#FFFFFF" };
const SHADOW: Shadow = { blur: 24, x: 0, y: 12, colour: "#000000", opacity: 0.5 };

const px = (value: number) => `${value} px`;

/**
 * An Overlay's corners, border and shadow: the radius as a share of the most it can be (half its
 * shorter side, a pill or a circle), and a border and a shadow each turned on and off, in output
 * pixels. Each field's changes are one history group, named after it.
 */
export function DecorationFields({ overlay, onChange }: { overlay: Overlay; onChange: (overlay: Overlay, group: string) => void }) {
  const group = (field: string) => `overlay:${overlay.id}:${field}`;
  const { border, shadow } = overlay;
  const setBorder = <K extends keyof Border>(field: K, value: Border[K]) =>
    border && onChange({ ...overlay, border: { ...border, [field]: value } }, group(`border.${field}`));
  const setShadow = <K extends keyof Shadow>(field: K, value: Shadow[K]) =>
    shadow && onChange({ ...overlay, shadow: { ...shadow, [field]: value } }, group(`shadow.${field}`));
  return (
    <>
      <Group title="Corners">
        <Slider
          label="Rounded"
          value={overlay.radius}
          min={0}
          max={0.5}
          step={0.01}
          format={(v) => (v === 0 ? "Square" : v === 0.5 ? "Round" : `${Math.round(v * 200)}%`)}
          onChange={(radius) => onChange({ ...overlay, radius }, group("radius"))}
        />
      </Group>
      <Group title="Border">
        <Switch checked={!!border} onChange={(on) => onChange({ ...overlay, border: on ? BORDER : null }, group("border"))}>
          <span className="text-sm font-medium">Border</span>
        </Switch>
        {border && (
          <>
            <Slider label="Width" value={border.width} min={1} max={40} format={px} onChange={(width) => setBorder("width", width)} />
            <ColorField label="Colour" value={border.colour} onChange={(colour) => setBorder("colour", colour)} />
          </>
        )}
      </Group>
      <Group title="Shadow">
        <Switch checked={!!shadow} onChange={(on) => onChange({ ...overlay, shadow: on ? SHADOW : null }, group("shadow"))}>
          <span className="text-sm font-medium">Drop shadow</span>
        </Switch>
        {shadow && (
          <>
            <Slider label="Blur" value={shadow.blur} min={0} max={100} format={px} onChange={(blur) => setShadow("blur", blur)} />
            <Slider label="Across" value={shadow.x} min={-100} max={100} format={px} onChange={(x) => setShadow("x", x)} />
            <Slider label="Down" value={shadow.y} min={-100} max={100} format={px} onChange={(y) => setShadow("y", y)} />
            <ColorField label="Colour" value={shadow.colour} onChange={(colour) => setShadow("colour", colour)} />
            <Slider
              label="Opacity"
              value={shadow.opacity}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => setShadow("opacity", opacity)}
            />
          </>
        )}
      </Group>
    </>
  );
}
