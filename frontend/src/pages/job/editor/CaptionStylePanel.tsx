import { Check } from "lucide-react";
import type { FontInfo, StyleValue } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { MoreOptions } from "../../../components/MoreOptions";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { cx } from "../../../format";
import { CAPTION_HEIGHT, REFERENCE, REFERENCE_SAFE_AREA } from "./canvas";
import { FacePicker } from "./FacePicker";
import { LINE_LIMITS, lineLimitsOf } from "./lineLimits";
import { ShadowFields } from "./ShadowFields";
import { highlightShape } from "./styleShape";
import { countChanged, Group, StyleMarker } from "./StyleFields";
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

const LINES = [
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
] as const;

const NAMED_LIMITS = [
  { name: "phrase", label: "Phrase", hint: "one short line" },
  { name: "sentence", label: "Sentence", hint: "up to two lines, to a sentence's end" },
] as const;

const MAX_WORDS = [
  { value: "", label: "No limit" },
  ...Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })),
];

// The fields behind More options.
const MORE = [
  "outline",
  "outline_colour",
  "shadow",
  "padding_x",
  "padding_y",
  "radius",
  "tracking",
  "max_chars",
  "max_words",
  "max_secs",
  "pause_secs",
] as const;

/**
 * The Caption Style: the controls used most (with the lines a Cue holds, and Phrase and Sentence,
 * which fill the line limits), then More options (outline, shadow, the highlight box, tracking and
 * line breaks).
 * Each control shows the resolved value, with a reset button when it overrides the Preset.
 * Shared by the clip editor (two fields to a row on a wide screen) and the Advanced Edit's narrow
 * `inspector` (one to a row).
 */
export function CaptionStylePanel({
  style,
  fonts,
  more,
  onMore,
  inspector = false,
}: {
  style: StyleControls;
  fonts: FontInfo[] | null;
  more: boolean;
  onMore: (open: boolean) => void;
  inspector?: boolean;
}) {
  const caption = style.caption;
  const set = (field: string, value: StyleValue) => style.set("caption", field, value);
  const marker = (field: string, label: string) => <StyleMarker style={style} part="caption" field={field} label={label} />;
  // The highlight box drawn round a line at the style's size, its own until it is set.
  const box = highlightShape(caption, caption.size);
  const px = (v: number) => `${Math.round(v)} px`;
  const grid = cx("grid grid-cols-1 gap-x-4 gap-y-3", !inspector && "sm:grid-cols-2");
  const fullRow = inspector ? undefined : "sm:col-span-2";
  const limits = lineLimitsOf(caption);

  return (
    <div className="flex flex-col gap-5">
      <div className={grid}>
        <FacePicker value={caption.font} fonts={fonts} onChange={(v) => set("font", v)} marker={marker("font", "font")} className={fullRow} />
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
      {/* In the Reference Space (canvas.ts), which every Canvas maps it from. */}
      {caption.position === "custom" && (
        <>
          <Slider
            label="Height of the line's centre"
            value={caption.y}
            min={REFERENCE_SAFE_AREA.y + CAPTION_HEIGHT / 2}
            max={REFERENCE_SAFE_AREA.y + REFERENCE_SAFE_AREA.height - CAPTION_HEIGHT / 2}
            format={(v) => `${Math.round(v)} px`}
            onChange={(v) => set("y", v)}
            marker={marker("y", "height")}
          />
          <Slider label="Line's centre across" value={caption.x ?? REFERENCE.width / 2} min={0} max={REFERENCE.width} format={(v) => `${Math.round(v)} px`} onChange={(v) => set("x", v)} marker={marker("x", "centre across")} />
        </>
      )}
      <div className="flex flex-col gap-3">
        <div role="group" aria-label="Line limits" className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Line limits</span>
          <div className="flex flex-wrap gap-2">
            {NAMED_LIMITS.map(({ name, label, hint }) => (
              <Button
                key={name}
                size="sm"
                aria-pressed={limits === name}
                title={`${label}: ${hint}`}
                onClick={() => style.setMany("caption", LINE_LIMITS[name])}
              >
                {limits === name && <Check aria-hidden size={14} />}
                {label}
              </Button>
            ))}
          </div>
        </div>
        <Segmented
          legend="Lines"
          options={LINES}
          value={String(caption.max_lines) as (typeof LINES)[number]["value"]}
          onChange={(v) => set("max_lines", Number(v))}
          marker={marker("max_lines", "lines")}
          className="max-w-48"
        />
      </div>
      <Switch checked={caption.uppercase} onChange={(v) => set("uppercase", v)}>
        <span className="flex items-center gap-1.5 text-sm">
          UPPERCASE {marker("uppercase", "uppercase")}
        </span>
      </Switch>

      <MoreOptions open={more} onToggle={onMore} contents="Outline, shadow, highlight box, tracking, line breaks" changed={countChanged(style, "caption", MORE)}>
        <Group title="Outline and shadow">
          <div className={grid}>
            <Slider label="Outline" value={caption.outline} min={0} max={20} format={(v) => `${v} px`} onChange={(v) => set("outline", v)} marker={marker("outline", "outline")} />
            <ColorField label="Outline colour" value={caption.outline_colour} onChange={(v) => set("outline_colour", v)} marker={marker("outline_colour", "outline colour")} />
          </div>
          <ShadowFields shadow={caption.shadow} onChange={(v) => set("shadow", v)} marker={marker("shadow", "shadow")} inspector={inspector} />
        </Group>
        {caption.highlight === "box" && (
          <Group title="Highlight box">
            <div className={grid}>
              <Slider label="Padding across" value={box.padX} min={0} max={200} format={px} onChange={(v) => set("padding_x", v)} marker={marker("padding_x", "box padding across")} />
              <Slider label="Padding down" value={box.padY} min={0} max={200} format={px} onChange={(v) => set("padding_y", v)} marker={marker("padding_y", "box padding down")} />
              <Slider label="Corner radius" value={box.radius} min={0} max={200} format={px} onChange={(v) => set("radius", v)} marker={marker("radius", "box corner radius")} />
            </div>
          </Group>
        )}
        <Group title="Tracking and line breaks">
          <div className={grid}>
            {/* Counted by Most characters: a spaced-out line holds fewer. */}
            <Slider
              label="Tracking"
              value={caption.tracking}
              min={-20}
              max={60}
              format={(v) => `${v} px`}
              onChange={(v) => set("tracking", v)}
              marker={marker("tracking", "tracking")}
              className={fullRow}
            />
            <Slider label="Most characters a line" value={caption.max_chars} min={4} max={60} onChange={(v) => set("max_chars", v)} marker={marker("max_chars", "most characters")} />
            <Select
              label="Most words a line"
              value={caption.max_words === null ? "" : String(caption.max_words)}
              options={MAX_WORDS}
              onChange={(v) => set("max_words", v === "" ? null : Number(v))}
              marker={marker("max_words", "most words")}
            />
            <Slider
              label="Longest caption on screen"
              value={caption.max_secs}
              min={0.3}
              max={5}
              step={0.1}
              format={(v) => `${v.toFixed(1)} s`}
              onChange={(v) => set("max_secs", v)}
              marker={marker("max_secs", "longest on screen")}
            />
            <Slider
              label="New caption after a pause of"
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
