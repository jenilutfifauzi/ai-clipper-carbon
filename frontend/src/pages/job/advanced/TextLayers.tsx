import { Copy, Trash2 } from "lucide-react";
import { useId } from "react";
import type { Animation, FontInfo, TextAlign, TextLayer } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { fontFamily } from "../../../fonts";
import { fontChoices, Group } from "../editor/StyleFields";

// A new Text Layer stays this long, or to the Clip's end; the shortest one lasts TEXT_MIN_SECS.
const TEXT_SECS = 3;
export const TEXT_MIN_SECS = 0.1;
// The backend's limit (TEXT_LAYER_MAX_CHARS in app/candidates.py).
const TEXT_MAX_CHARS = 300;

const BASE: Omit<TextLayer, "id" | "start" | "secs"> = {
  text: "Text",
  x: 540,
  y: 960,
  font: "montserrat-extrabold",
  size: 80,
  colour: "#FFFFFF",
  outline: 4,
  outline_colour: "#000000",
  box: false,
  box_colour: "#000000",
  box_opacity: 0.7,
  align: "center",
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
};

/** The looks a new Text Layer can start from. */
export const TEXT_PRESETS: { name: string; layer: Omit<TextLayer, "id" | "start" | "secs"> }[] = [
  { name: "Text", layer: BASE },
  {
    name: "Title",
    layer: { ...BASE, text: "Title", font: "anton", size: 130, colour: "#FFE600", outline: 6, y: 700, animation_in: "pop" },
  },
  {
    name: "Label",
    layer: { ...BASE, text: "Label", size: 64, colour: "#000000", outline: 0, box: true, box_colour: "#FFFFFF", box_opacity: 1 },
  },
  {
    name: "Subtitle",
    layer: { ...BASE, text: "Subtitle", size: 56, outline: 0, box: true, box_opacity: 0.6, y: 1400, animation_in: "fade", animation_out: "fade" },
  },
];

export const newId = () => crypto.randomUUID().slice(0, 8);

/** A Text Layer in `look` at the playhead (`at`), for TEXT_SECS or to the Clip's end. */
export function newTextLayer(look: Omit<TextLayer, "id" | "start" | "secs">, at: number, duration: number): TextLayer {
  const start = Math.max(0, Math.min(at, duration - Math.min(TEXT_SECS, duration)));
  return { ...look, id: newId(), start: round(start), secs: round(Math.min(TEXT_SECS, duration - start)) };
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * The Text Layers in lanes: each in the first lane where it overlaps none, so that each row of the
 * Text track holds layers that follow one another.
 */
export function textLanes(layers: TextLayer[]): TextLayer[][] {
  const lanes: TextLayer[][] = [];
  for (const layer of [...layers].sort((a, b) => a.start - b.start)) {
    const lane = lanes.find((items) => items.every((item) => item.start + item.secs <= layer.start + 1e-6 || layer.start + layer.secs <= item.start + 1e-6));
    if (lane) lane.push(layer);
    else lanes.push([layer]);
  }
  return lanes;
}

/** The Text tab: a button per look, each adding a Text Layer at the playhead. */
export function TextAssets({ fonts, onAdd }: { fonts: FontInfo[] | null; onAdd: (look: Omit<TextLayer, "id" | "start" | "secs">) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-pretty text-muted">Adds a text at the playhead. Drag it on the video to place it.</p>
      <div className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map(({ name, layer }) => (
          <button
            key={name}
            type="button"
            onClick={() => onAdd(layer)}
            className="raised flex min-h-20 items-center justify-center rounded-[10px] p-2 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
          >
            <span
              className="rounded-md px-1.5 text-lg leading-tight"
              style={{
                fontFamily: fonts?.some((font) => font.id === layer.font) ? fontFamily(layer.font) : undefined,
                color: layer.colour,
                backgroundColor: layer.box ? layer.box_colour : undefined,
                WebkitTextStroke: layer.outline ? `1px ${layer.outline_colour}` : undefined,
              }}
            >
              {name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

const ALIGNS = [
  { value: "left", label: "Left" },
  { value: "center", label: "Centre" },
  { value: "right", label: "Right" },
] as const;

const ANIMATIONS = [
  { value: "none", label: "None" },
  { value: "fade", label: "Fade" },
  { value: "pop", label: "Pop" },
  { value: "slide", label: "Slide" },
] as const;

/** The selected Text Layer's text, look, motion and time. */
export function TextLayerFields({
  layer,
  duration,
  fonts,
  onChange,
  onDuplicate,
  onDelete,
}: {
  layer: TextLayer;
  duration: number;
  fonts: FontInfo[] | null;
  // `group` names the field being changed, so that its changes are undone as one.
  onChange: (layer: TextLayer, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const set = <K extends keyof TextLayer>(field: K, value: TextLayer[K]) => onChange({ ...layer, [field]: value }, `text:${layer.id}:${field}`);
  const animated = layer.animation_in !== "none" || layer.animation_out !== "none";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Text</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate text">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete text">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-text`} className="text-sm font-medium">
          Words
        </label>
        <textarea
          id={`${id}-text`}
          value={layer.text}
          maxLength={TEXT_MAX_CHARS}
          rows={3}
          onChange={(event) => set("text", event.target.value)}
          className="min-h-20 w-full resize-y rounded-[10px] border border-border bg-fill px-3 py-2 text-base"
        />
      </div>
      <Group title="Look">
        <Select label="Font" value={layer.font} onChange={(font) => set("font", font)} {...fontChoices(fonts)} />
        <Slider label="Size" value={layer.size} min={16} max={320} onChange={(size) => set("size", size)} />
        <ColorField label="Colour" value={layer.colour} onChange={(colour) => set("colour", colour)} />
        <Slider label="Outline" value={layer.outline} min={0} max={20} format={(v) => (v ? `${v} px` : "None")} onChange={(outline) => set("outline", outline)} />
        {layer.outline > 0 && <ColorField label="Outline colour" value={layer.outline_colour} onChange={(colour) => set("outline_colour", colour)} />}
        <Switch checked={layer.box} onChange={(box) => set("box", box)}>
          <span className="text-sm font-medium">Box behind the text</span>
        </Switch>
        {layer.box && (
          <>
            <ColorField label="Box colour" value={layer.box_colour} onChange={(colour) => set("box_colour", colour)} />
            <Slider
              label="Box opacity"
              value={layer.box_opacity}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => set("box_opacity", opacity)}
            />
          </>
        )}
        <Segmented legend="Lines" options={ALIGNS} value={layer.align} onChange={(align: TextAlign) => set("align", align)} />
      </Group>
      <Group title="Motion">
        <div className="grid grid-cols-2 gap-3">
          <Select label="Comes on" value={layer.animation_in} options={ANIMATIONS} onChange={(value: Animation) => set("animation_in", value)} />
          <Select label="Goes off" value={layer.animation_out} options={ANIMATIONS} onChange={(value: Animation) => set("animation_out", value)} />
        </div>
        {animated && (
          <Slider
            label="Animation length"
            value={layer.animation_ms}
            min={100}
            max={2000}
            step={50}
            format={(v) => `${(v / 1000).toFixed(2)} s`}
            onChange={(ms) => set("animation_ms", ms)}
          />
        )}
      </Group>
      <Group title="Time">
        <Slider
          label="Comes on at"
          value={Math.min(layer.start, duration - TEXT_MIN_SECS)}
          min={0}
          max={Math.max(TEXT_MIN_SECS, duration - TEXT_MIN_SECS)}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(start) => onChange({ ...layer, start, secs: Math.min(layer.secs, duration - start) }, `text:${layer.id}:start`)}
        />
        <Slider
          label="Stays for"
          value={Math.min(layer.secs, duration - layer.start)}
          min={TEXT_MIN_SECS}
          max={Math.max(TEXT_MIN_SECS, duration - layer.start)}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(secs) => set("secs", secs)}
        />
      </Group>
    </div>
  );
}
