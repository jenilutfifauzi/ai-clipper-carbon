import type { FontInfo, StyleValue } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { MoreOptions } from "../../../components/MoreOptions";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { HookShapePicker } from "./HookShapePicker";
import { FacePicker } from "./FacePicker";
import { ShadowFields } from "./ShadowFields";
import { hookPadding } from "./styleShape";
import { countChanged, Group, StyleMarker } from "./StyleFields";
import type { StyleControls } from "./useStyleDraft";

const POSITIONS = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
  { value: "custom", label: "Custom" },
] as const;

const LINES = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
] as const;

const ALIGNS = [
  { value: "center", label: "Centre" },
  { value: "left", label: "Left" },
] as const;

const ANIMATIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide", label: "Slide" },
] as const;

// The fields behind More options.
const MORE = [
  "max_lines",
  "align",
  "uppercase",
  "line_height",
  "tracking",
  "box_opacity",
  "radius",
  "padding_x",
  "padding_y",
  "outline",
  "outline_colour",
  "shadow",
  "quote",
  "quote_colour",
  "kicker_colour",
  "kicker_box_colour",
  "animation_in",
  "animation_out",
  "animation_ms",
] as const;

// Setting and marking the Hook Style's fields.
function hookFields(style: StyleControls) {
  return {
    hook: style.hook,
    set: (field: string, value: StyleValue) => style.set("hook", field, value),
    marker: (field: string, label: string) => <StyleMarker style={style} part="hook" field={field} label={label} />,
  };
}

/** The hook's Shape, font, size and colours: its look at a glance. */
export function HookLook({ style, fonts }: { style: StyleControls; fonts: FontInfo[] | null }) {
  const { hook, set, marker } = hookFields(style);
  return (
    <>
      <HookShapePicker style={hook} onChange={(v) => set("shape", v)} marker={marker("shape", "shape")} />
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <FacePicker value={hook.font} fonts={fonts} onChange={(v) => set("font", v)} marker={marker("font", "hook font")} className="sm:col-span-2" />
        <Slider label="Size" value={hook.size} min={40} max={160} onChange={(v) => set("size", v)} marker={marker("size", "hook size")} />
        <ColorField label="Text colour" value={hook.colour} onChange={(v) => set("colour", v)} marker={marker("colour", "hook text colour")} />
        <ColorField
          label="Emphasis colour"
          value={hook.emphasis_colour}
          onChange={(v) => set("emphasis_colour", v)}
          marker={marker("emphasis_colour", "emphasis colour")}
        />
        {/* No box has no box colour; its value is kept for when a box comes back. */}
        {hook.shape !== "none" && (
          <ColorField label="Box colour" value={hook.box_colour} onChange={(v) => set("box_colour", v)} marker={marker("box_colour", "box colour")} />
        )}
      </div>
    </>
  );
}

/** Where on the frame the hook sits. */
export function HookPosition({ style }: { style: StyleControls }) {
  const { hook, set, marker } = hookFields(style);
  return (
    <>
      <Segmented
        legend="Position"
        options={POSITIONS}
        value={hook.position}
        // Top, Middle and Bottom are centred across; Custom keeps where it was dragged.
        onChange={(v) => (v === "custom" ? set("position", v) : style.setMany("hook", { position: v, x: null }))}
        marker={marker("position", "hook position")}
        className="max-w-md"
      />
      {hook.position === "custom" && (
        <>
          <Slider label="Height of the hook's top" value={hook.y} min={232} max={1536} format={(v) => `${v} px`} onChange={(v) => set("y", v)} marker={marker("y", "hook height")} />
          <Slider label="Hook's middle across" value={hook.x ?? 540} min={0} max={1080} format={(v) => `${v} px`} onChange={(v) => set("x", v)} marker={marker("x", "hook middle across")} />
        </>
      )}
    </>
  );
}

/** The Hook Style's fields used less often, behind More options. */
export function HookMoreOptions({ style, open, onToggle }: { style: StyleControls; open: boolean; onToggle: (open: boolean) => void }) {
  const { hook, set, marker } = hookFields(style);
  const box = hook.shape !== "none";
  // The padding drawn, the Shape's own until it is set.
  const [paddingX, paddingY] = hookPadding(hook);
  return (
    <MoreOptions
      open={open}
      onToggle={onToggle}
      contents="Lines, spacing, box, outline, shadow, Quote Mark, Kicker colours, animation"
      changed={countChanged(style, "hook", MORE)}
    >
      <Group title="Lines">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Segmented
            legend="Most lines"
            options={LINES}
            value={String(hook.max_lines) as (typeof LINES)[number]["value"]}
            onChange={(v) => set("max_lines", Number(v))}
            marker={marker("max_lines", "most lines")}
          />
          <Segmented legend="Align" options={ALIGNS} value={hook.align} onChange={(v) => set("align", v)} marker={marker("align", "alignment")} />
        </div>
        <Switch checked={hook.uppercase} onChange={(v) => set("uppercase", v)}>
          <span className="flex items-center gap-1.5 text-sm">
            UPPERCASE {marker("uppercase", "hook uppercase")}
          </span>
        </Switch>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <Slider
            label="Line height"
            value={hook.line_height}
            min={0.5}
            max={2.5}
            step={0.02}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => set("line_height", v)}
            marker={marker("line_height", "hook line height")}
          />
          <Slider
            label="Tracking"
            value={hook.tracking}
            min={-20}
            max={60}
            format={(v) => `${v} px`}
            onChange={(v) => set("tracking", v)}
            marker={marker("tracking", "hook tracking")}
          />
        </div>
      </Group>

      <Group title={box ? "Box, outline and shadow" : "Outline and shadow"}>
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {box && (
            <>
              <Slider
                label="Box opacity"
                value={hook.box_opacity}
                min={0}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => set("box_opacity", v)}
                marker={marker("box_opacity", "box opacity")}
              />
              <Slider label="Corner radius" value={hook.radius} min={0} max={80} format={(v) => `${v} px`} onChange={(v) => set("radius", v)} marker={marker("radius", "corner radius")} />
              <Slider
                label="Padding across"
                value={paddingX}
                min={0}
                max={200}
                format={(v) => `${Math.round(v)} px`}
                onChange={(v) => set("padding_x", v)}
                marker={marker("padding_x", "box padding across")}
              />
              <Slider
                label="Padding down"
                value={paddingY}
                min={0}
                max={200}
                format={(v) => `${Math.round(v)} px`}
                onChange={(v) => set("padding_y", v)}
                marker={marker("padding_y", "box padding down")}
              />
            </>
          )}
          <Slider label="Outline" value={hook.outline} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("outline", v)} marker={marker("outline", "hook outline")} />
          <ColorField label="Outline colour" value={hook.outline_colour} onChange={(v) => set("outline_colour", v)} marker={marker("outline_colour", "hook outline colour")} />
        </div>
        <ShadowFields shadow={hook.shadow} onChange={(v) => set("shadow", v)} marker={marker("shadow", "hook shadow")} />
      </Group>

      <Group title="Quote Mark">
        <div className="grid grid-cols-1 items-end gap-x-4 gap-y-3 sm:grid-cols-2">
          <Switch checked={hook.quote} onChange={(v) => set("quote", v)}>
            <span className="flex items-center gap-1.5 text-sm">
              On the first line's corner {marker("quote", "quote mark")}
            </span>
          </Switch>
          {hook.quote && (
            <ColorField label="Badge colour" value={hook.quote_colour} onChange={(v) => set("quote_colour", v)} marker={marker("quote_colour", "quote mark colour")} />
          )}
        </div>
      </Group>

      <Group title="Kicker colours">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <ColorField label="Text colour" value={hook.kicker_colour} onChange={(v) => set("kicker_colour", v)} marker={marker("kicker_colour", "kicker text colour")} />
          <ColorField label="Pill colour" value={hook.kicker_box_colour} onChange={(v) => set("kicker_box_colour", v)} marker={marker("kicker_box_colour", "kicker pill colour")} />
        </div>
      </Group>

      <Group title="Animation">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Select label="Comes on" value={hook.animation_in} options={ANIMATIONS} onChange={(v) => set("animation_in", v)} marker={marker("animation_in", "how it comes on")} />
          <Select label="Goes off" value={hook.animation_out} options={ANIMATIONS} onChange={(v) => set("animation_out", v)} marker={marker("animation_out", "how it goes off")} />
          <Slider
            label="Length"
            value={hook.animation_ms}
            min={50}
            max={1000}
            step={50}
            format={(v) => `${(v / 1000).toFixed(2)} s`}
            onChange={(v) => set("animation_ms", v)}
            marker={marker("animation_ms", "animation length")}
          />
        </div>
      </Group>
    </MoreOptions>
  );
}
