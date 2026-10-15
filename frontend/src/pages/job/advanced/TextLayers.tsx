import { Copy, Trash2 } from "lucide-react";
import { useId } from "react";
import type { Animation, FontInfo, TextAlign, TextLayer } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { fontFamily } from "../../../fonts";
import { fontChoices, Group } from "../editor/StyleFields";
import { DRAG_TEXT } from "./drag";
import { shared } from "./actions";
import { newId, round } from "./edits";
import { TimingFields } from "./TimingFields";

// A new Text Layer stays this long, or to the Clip's end.
const TEXT_SECS = 3;
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

/** A Text Layer in `look` at `at` (the playhead, or where it was dropped), for TEXT_SECS or to the Clip's end. */
export function newTextLayer(look: Omit<TextLayer, "id" | "start" | "secs">, at: number, duration: number): TextLayer {
  const start = Math.max(0, Math.min(at, duration - Math.min(TEXT_SECS, duration)));
  return { ...look, id: newId(), start: round(start), secs: round(Math.min(TEXT_SECS, duration - start)) };
}

/** The Text tab: a button per look, each adding a Text Layer at the playhead, or where it is dropped on the timeline. */
export function TextAssets({ fonts, onAdd }: { fonts: FontInfo[] | null; onAdd: (look: Omit<TextLayer, "id" | "start" | "secs">) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Hint more="Drag a text on the video to place it.">Click to add at the playhead, or drag onto the timeline.</Hint>
      <div className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map(({ name, layer }) => (
          <button
            key={name}
            type="button"
            draggable
            onDragStart={(event) => {
              event.dataTransfer.setData(DRAG_TEXT, name);
              event.dataTransfer.effectAllowed = "copy";
            }}
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
      <TimingFields item={layer} duration={duration} labels={{ start: "Comes on at", secs: "Stays for" }} onChange={onChange} />
    </div>
  );
}

/**
 * Several picked Text Layers' look and motion, set on every one of them at once. A field they differ
 * in shows the first one's value, marked Mixed, until it is set. Their words and places stay their own.
 */
export function TextLayersFields({
  layers,
  fonts,
  onChange,
  onDuplicate,
  onDelete,
}: {
  layers: TextLayer[];
  fonts: FontInfo[] | null;
  // `field` set on them all; `group` names the field, so that its changes are undone as one.
  onChange: <K extends keyof TextLayer>(field: K, value: TextLayer[K], group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const value = <K extends keyof TextLayer>(field: K) => shared(layers, field) ?? layers[0][field];
  const mixed = (field: keyof TextLayer) => shared(layers, field) === undefined;
  const marker = (field: keyof TextLayer) => (mixed(field) ? <Mixed /> : undefined);
  const set = <K extends keyof TextLayer>(field: K, next: TextLayer[K]) => onChange(field, next, `texts:${field}`);
  // A number as its slider shows it, or Mixed.
  const shown = (field: keyof TextLayer, format: (v: number) => string) => (v: number) => (mixed(field) ? "Mixed" : format(v));
  const any = (test: (layer: TextLayer) => boolean) => layers.some(test);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Editing {layers.length} layers</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate them">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete them">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <Hint more="Their words, places and times stay each one's own: change those one at a time.">A change here applies to every picked text.</Hint>
      <Group title="Look">
        <Select label="Font" value={value("font")} onChange={(font) => set("font", font)} marker={marker("font")} {...fontChoices(fonts)} />
        <Slider label="Size" value={value("size")} min={16} max={320} format={shown("size", String)} onChange={(size) => set("size", size)} />
        <ColorField label="Colour" value={value("colour")} onChange={(colour) => set("colour", colour)} marker={marker("colour")} />
        <Slider
          label="Outline"
          value={value("outline")}
          min={0}
          max={20}
          format={shown("outline", (v) => (v ? `${v} px` : "None"))}
          onChange={(outline) => set("outline", outline)}
        />
        {any((layer) => layer.outline > 0) && (
          <ColorField
            label="Outline colour"
            value={value("outline_colour")}
            onChange={(colour) => set("outline_colour", colour)}
            marker={marker("outline_colour")}
          />
        )}
        <Switch checked={value("box")} onChange={(box) => set("box", box)}>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Box behind the text {marker("box")}
          </span>
        </Switch>
        {any((layer) => layer.box) && (
          <>
            <ColorField label="Box colour" value={value("box_colour")} onChange={(colour) => set("box_colour", colour)} marker={marker("box_colour")} />
            <Slider
              label="Box opacity"
              value={value("box_opacity")}
              min={0}
              max={1}
              step={0.05}
              format={shown("box_opacity", (v) => `${Math.round(v * 100)}%`)}
              onChange={(opacity) => set("box_opacity", opacity)}
            />
          </>
        )}
        <Segmented legend="Lines" options={ALIGNS} value={value("align")} onChange={(align: TextAlign) => set("align", align)} marker={marker("align")} />
      </Group>
      <Group title="Motion">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Comes on"
            value={value("animation_in")}
            options={ANIMATIONS}
            onChange={(next: Animation) => set("animation_in", next)}
            marker={marker("animation_in")}
          />
          <Select
            label="Goes off"
            value={value("animation_out")}
            options={ANIMATIONS}
            onChange={(next: Animation) => set("animation_out", next)}
            marker={marker("animation_out")}
          />
        </div>
        {any((layer) => layer.animation_in !== "none" || layer.animation_out !== "none") && (
          <Slider
            label="Animation length"
            value={value("animation_ms")}
            min={100}
            max={2000}
            step={50}
            format={shown("animation_ms", (v) => `${(v / 1000).toFixed(2)} s`)}
            onChange={(ms) => set("animation_ms", ms)}
          />
        )}
      </Group>
    </div>
  );
}

// A field the picked Text Layers differ in.
function Mixed() {
  return <span className="rounded-md bg-fill px-1.5 py-0.5 text-xs font-normal text-muted">Mixed</span>;
}
