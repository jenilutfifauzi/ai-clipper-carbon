import type { FontInfo } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { MoreOptions } from "../../../components/MoreOptions";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { countChanged, fontChoices, Group, StyleMarker } from "./StyleFields";
import type { StyleControls } from "./useStyleDraft";

const HIGHLIGHTS = [
  { value: "colour", label: "Colour" },
  { value: "box", label: "Box" },
  { value: "none", label: "None" },
] as const;

const POSITIONS = [
  { value: "auto", label: "Auto" },
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
  { value: "custom", label: "Custom" },
] as const;

const MAX_WORDS = [
  { value: "", label: "No limit" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
];

// The fields behind More options.
const MORE = ["outline", "outline_colour", "shadow", "shadow_colour", "tracking", "max_chars", "max_words", "max_secs", "pause_secs"] as const;

/**
 * The Caption Style: the controls used most, then More options (outline, shadow, tracking and line breaks).
 * Each control shows the resolved value, with a reset button when it overrides the Preset.
 */
export function CaptionStylePanel({
  style,
  fonts,
  more,
  onMore,
}: {
  style: StyleControls;
  fonts: FontInfo[] | null;
  more: boolean;
  onMore: (open: boolean) => void;
}) {
  const caption = style.caption;
  const set = (field: string, value: string | number | boolean | null) => style.set("caption", field, value);
  const marker = (field: string, label: string) => <StyleMarker style={style} part="caption" field={field} label={label} />;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <Select label="Font" value={caption.font} {...fontChoices(fonts)} onChange={(v) => set("font", v)} marker={marker("font", "font")} />
        <Slider label="Size" value={caption.size} min={40} max={200} onChange={(v) => set("size", v)} marker={marker("size", "size")} />
        <ColorField label="Text colour" value={caption.colour} onChange={(v) => set("colour", v)} marker={marker("colour", "text colour")} />
        <ColorField
          label="Highlight colour"
          value={caption.active_colour}
          onChange={(v) => set("active_colour", v)}
          marker={marker("active_colour", "highlight colour")}
        />
      </div>
      <Segmented
        legend="Highlight the spoken word"
        options={HIGHLIGHTS}
        value={caption.highlight}
        onChange={(v) => set("highlight", v)}
        marker={marker("highlight", "highlight")}
        className="max-w-sm"
      />
      <Segmented
        legend="Position"
        options={POSITIONS}
        value={caption.position}
        // Auto, Top, Middle and Bottom are centred across; Custom keeps where they were dragged.
        onChange={(v) => (v === "custom" ? set("position", v) : style.setMany("caption", { position: v, x: null }))}
        marker={marker("position", "position")}
      />
      {caption.position === "custom" && (
        <>
          <Slider label="Height of the line's centre" value={caption.y} min={332} max={1436} format={(v) => `${v} px`} onChange={(v) => set("y", v)} marker={marker("y", "height")} />
          <Slider label="Line's centre across" value={caption.x ?? 540} min={0} max={1080} format={(v) => `${v} px`} onChange={(v) => set("x", v)} marker={marker("x", "centre across")} />
        </>
      )}
      <Switch checked={caption.uppercase} onChange={(v) => set("uppercase", v)}>
        <span className="flex items-center gap-1.5 text-sm">
          UPPERCASE {marker("uppercase", "uppercase")}
        </span>
      </Switch>

      <MoreOptions open={more} onToggle={onMore} contents="Outline, shadow, tracking, line breaks" changed={countChanged(style, "caption", MORE)}>
        <Group title="Outline and shadow">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <Slider label="Outline" value={caption.outline} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("outline", v)} marker={marker("outline", "outline")} />
            <ColorField label="Outline colour" value={caption.outline_colour} onChange={(v) => set("outline_colour", v)} marker={marker("outline_colour", "outline colour")} />
            <Slider label="Shadow" value={caption.shadow} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("shadow", v)} marker={marker("shadow", "shadow")} />
            <ColorField label="Shadow colour" value={caption.shadow_colour} onChange={(v) => set("shadow_colour", v)} marker={marker("shadow_colour", "shadow colour")} />
          </div>
        </Group>
        <Group title="Tracking and line breaks">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            {/* Counted by Most characters: a spaced-out line holds fewer. */}
            <Slider
              label="Tracking"
              value={caption.tracking}
              min={-20}
              max={60}
              format={(v) => `${v} px`}
              onChange={(v) => set("tracking", v)}
              marker={marker("tracking", "tracking")}
              className="sm:col-span-2"
            />
            <Slider label="Most characters" value={caption.max_chars} min={4} max={60} onChange={(v) => set("max_chars", v)} marker={marker("max_chars", "most characters")} />
            <Select
              label="Most words"
              value={caption.max_words === null ? "" : String(caption.max_words)}
              options={MAX_WORDS}
              onChange={(v) => set("max_words", v === "" ? null : Number(v))}
              marker={marker("max_words", "most words")}
            />
            <Slider
              label="Longest on screen"
              value={caption.max_secs}
              min={0.3}
              max={5}
              step={0.1}
              format={(v) => `${v.toFixed(1)} s`}
              onChange={(v) => set("max_secs", v)}
              marker={marker("max_secs", "longest on screen")}
            />
            <Slider
              label="New line after a pause of"
              value={caption.pause_secs}
              min={0.1}
              max={2}
              step={0.05}
              format={(v) => `${v.toFixed(2)} s`}
              onChange={(v) => set("pause_secs", v)}
              marker={marker("pause_secs", "pause")}
            />
          </div>
        </Group>
      </MoreOptions>
    </div>
  );
}
