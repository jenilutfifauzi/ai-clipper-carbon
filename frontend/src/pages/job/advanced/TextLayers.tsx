import { ClipboardCopy, Copy, Trash2 } from "lucide-react";
import { useId } from "react";
import type { Animation, FontInfo, Plate, TextAlign, TextLayer, TextStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { fontFamily } from "../../../fonts";
import { IDENTITY } from "../editor/picture";
import { fontChoices, Group } from "../editor/StyleFields";
import { DRAG_TEXT } from "./drag";
import { ImportFont } from "./ImportFont";
import { shared } from "./actions";
import { newId, round } from "./edits";
import { styled, textStyle } from "./textStyle";
import { TimingFields } from "./TimingFields";
import { TextTransformFields } from "./TransformFields";

// A new Text Layer stays this long, or to the Clip's end.
const TEXT_SECS = 3;
// The backend's limit (TEXT_LAYER_MAX_CHARS in app/candidates.py).
const TEXT_MAX_CHARS = 300;

// What a new Text Layer is made of: all of it but its id and its time.
export type TextLook = Omit<TextLayer, "id" | "start" | "secs">;

const BASE: TextLook = {
  text: "Text",
  transform: IDENTITY,
  style: textStyle({ stroke_width: 4 }),
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
};

/** The looks a new Text Layer can start from. */
export const TEXT_PRESETS: { name: string; layer: TextLook }[] = [
  { name: "Text", layer: BASE },
  {
    name: "Title",
    layer: {
      ...BASE,
      text: "Title",
      transform: { ...IDENTITY, y: 700 },
      style: textStyle({ font: "anton", size: 130, colour: "#FFE600", stroke_width: 6 }),
      animation_in: "pop",
    },
  },
  {
    name: "Label",
    layer: { ...BASE, text: "Label", style: textStyle({ size: 64, colour: "#000000", plate: { shape: "block", colour: "#FFFFFF", opacity: 1 } }) },
  },
  {
    name: "Subtitle",
    layer: {
      ...BASE,
      text: "Subtitle",
      transform: { ...IDENTITY, y: 1400 },
      style: textStyle({ size: 56, plate: { shape: "block", opacity: 0.6 } }),
      animation_in: "fade",
      animation_out: "fade",
    },
  },
];

/** A Text Layer in `look` at `at` (the playhead, or where it was dropped), for TEXT_SECS or to the Clip's end. */
export function newTextLayer(look: TextLook, at: number, duration: number): TextLayer {
  const start = Math.max(0, Math.min(at, duration - Math.min(TEXT_SECS, duration)));
  return { ...look, id: newId(), start: round(start), secs: round(Math.min(TEXT_SECS, duration - start)) };
}

/**
 * The Text tab: a button per look, each adding a Text Layer at the playhead, or where it is dropped on
 * the timeline; and Import font, whose Faces every font picker then lists.
 */
export function TextAssets({ fonts, onAdd }: { fonts: FontInfo[] | null; onAdd: (look: TextLook) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Hint more="Drag a text on the video to place it.">Click to add at the playhead, or drag onto the timeline.</Hint>
      <div className="grid grid-cols-2 gap-2">
        {TEXT_PRESETS.map(({ name, layer, layer: { style } }) => (
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
                fontFamily: fonts?.some((font) => font.id === style.font) ? fontFamily(style.font) : undefined,
                color: style.colour,
                backgroundColor: style.plate.shape === "none" ? undefined : style.plate.colour,
                WebkitTextStroke: style.stroke_width ? `1px ${style.stroke_colour}` : undefined,
              }}
            >
              {name}
            </span>
          </button>
        ))}
      </div>
      <ImportFont />
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

/** The selected Text Layer's text, look, Transform, motion and time. */
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
  const setStyle = <K extends keyof TextStyle>(field: K, value: TextStyle[K]) =>
    onChange({ ...layer, style: styled(layer.style, field, value) }, `text:${layer.id}:style.${field}`);
  const setPlate = <K extends keyof Plate>(field: K, value: Plate[K]) =>
    onChange({ ...layer, style: { ...layer.style, plate: { ...layer.style.plate, [field]: value } } }, `text:${layer.id}:plate.${field}`);
  const { style } = layer;
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
        <Select label="Font" value={style.font} onChange={(font) => setStyle("font", font)} {...fontChoices(fonts)} />
        <Slider label="Size" value={style.size} min={16} max={320} onChange={(size) => setStyle("size", size)} />
        <ColorField label="Colour" value={style.colour} onChange={(colour) => setStyle("colour", colour)} />
        <Slider
          label="Outline"
          value={style.stroke_width}
          min={0}
          max={20}
          format={(v) => (v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", width)}
        />
        {style.stroke_width > 0 && <ColorField label="Outline colour" value={style.stroke_colour} onChange={(colour) => setStyle("stroke_colour", colour)} />}
        <Switch checked={style.plate.shape === "block"} onChange={(box) => setPlate("shape", box ? "block" : "none")}>
          <span className="text-sm font-medium">Box behind the text</span>
        </Switch>
        {style.plate.shape === "block" && (
          <>
            <ColorField label="Box colour" value={style.plate.colour} onChange={(colour) => setPlate("colour", colour)} />
            <Slider
              label="Box opacity"
              value={style.plate.opacity}
              min={0}
              max={1}
              step={0.05}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(opacity) => setPlate("opacity", opacity)}
            />
          </>
        )}
        <Segmented legend="Lines" options={ALIGNS} value={style.align} onChange={(align: TextAlign) => setStyle("align", align)} />
      </Group>
      <TextTransformFields transform={layer.transform} onChange={(transform, field) => onChange({ ...layer, transform }, `text:${layer.id}:transform.${field}`)} />
      <Group title="Box">
        <BoxField label="Wrap width" value={style.wrap_width} most={FRAME_WIDTH} onChange={(width) => setStyle("wrap_width", width)} />
        <BoxField label="Fixed height" value={style.fixed_height} most={FRAME_HEIGHT} onChange={(height) => setStyle("fixed_height", height)} />
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

// The frame, which a box's slider reaches across (the field itself takes more: 4096 px).
const FRAME_WIDTH = 1080;
const FRAME_HEIGHT = 1920;

/**
 * A Text Layer's wrap width or fixed height: Auto at 0 (the frame less a margin, or the words' own
 * height), or in output pixels, with Auto to go back to it. Its box Grips on the stage set it too.
 */
export function BoxField({ label, value, most, onChange }: { label: string; value: number; most: number; onChange: (value: number) => void }) {
  return (
    <Slider
      label={label}
      value={value}
      min={0}
      max={Math.max(most, value)}
      format={(v) => (v ? `${Math.round(v)} px` : "Auto")}
      onChange={onChange}
      after={
        value > 0 && (
          <Button variant="ghost" size="xs" onClick={() => onChange(0)} aria-label={`${label}: back to Auto`}>
            Auto
          </Button>
        )
      }
    />
  );
}

// How the multi-layer fields read each of their values off a Text Layer.
const READ = {
  font: (layer: TextLayer) => layer.style.font,
  size: (layer: TextLayer) => layer.style.size,
  colour: (layer: TextLayer) => layer.style.colour,
  stroke_width: (layer: TextLayer) => layer.style.stroke_width,
  stroke_colour: (layer: TextLayer) => layer.style.stroke_colour,
  align: (layer: TextLayer) => layer.style.align,
  box: (layer: TextLayer) => layer.style.plate.shape === "block",
  box_colour: (layer: TextLayer) => layer.style.plate.colour,
  box_opacity: (layer: TextLayer) => layer.style.plate.opacity,
  animation_in: (layer: TextLayer) => layer.animation_in,
  animation_out: (layer: TextLayer) => layer.animation_out,
  animation_ms: (layer: TextLayer) => layer.animation_ms,
};
type Field = keyof typeof READ;

/**
 * Several picked Text Layers' look and motion, set on every one of them at once. A field they differ
 * in shows the first one's value, marked Mixed, until it is set. Their words and places stay their own.
 */
export function TextLayersFields({
  layers,
  fonts,
  onChange,
  onDuplicate,
  onCopy,
  onDelete,
}: {
  layers: TextLayer[];
  fonts: FontInfo[] | null;
  // `change` made to them all; `group` names the field, so that its changes are undone as one.
  onChange: (change: (layer: TextLayer) => TextLayer, group: string) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const read = (field: Field) => READ[field] as (layer: TextLayer) => unknown;
  const value = <F extends Field>(field: F) => (shared(layers, read(field)) ?? read(field)(layers[0])) as ReturnType<(typeof READ)[F]>;
  const mixed = (field: Field) => shared(layers, read(field)) === undefined;
  const marker = (field: Field) => (mixed(field) ? <Mixed /> : undefined);
  const set = <K extends keyof TextLayer>(field: K, next: TextLayer[K]) => onChange((layer) => ({ ...layer, [field]: next }), `texts:${field}`);
  const setStyle = <K extends keyof TextStyle>(field: K, next: TextStyle[K]) =>
    onChange((layer) => ({ ...layer, style: styled(layer.style, field, next) }), `texts:style.${field}`);
  const setPlate = <K extends keyof Plate>(field: K, next: Plate[K]) =>
    onChange((layer) => ({ ...layer, style: { ...layer.style, plate: { ...layer.style.plate, [field]: next } } }), `texts:plate.${field}`);
  // A number as its slider shows it, or Mixed.
  const shown = (field: Field, format: (v: number) => string) => (v: number) => (mixed(field) ? "Mixed" : format(v));
  const any = (test: (layer: TextLayer) => boolean) => layers.some(test);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Editing {layers.length} layers</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate them">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onCopy} aria-label="Copy them">
            <ClipboardCopy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete them">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <Hint more="Their words, places and times stay each one's own: change those one at a time.">A change here applies to every picked text.</Hint>
      <Group title="Look">
        <Select label="Font" value={value("font")} onChange={(font) => setStyle("font", font)} marker={marker("font")} {...fontChoices(fonts)} />
        <Slider label="Size" value={value("size")} min={16} max={320} format={shown("size", String)} onChange={(size) => setStyle("size", size)} />
        <ColorField label="Colour" value={value("colour")} onChange={(colour) => setStyle("colour", colour)} marker={marker("colour")} />
        <Slider
          label="Outline"
          value={value("stroke_width")}
          min={0}
          max={20}
          format={shown("stroke_width", (v) => (v ? `${v} px` : "None"))}
          onChange={(width) => setStyle("stroke_width", width)}
        />
        {any((layer) => layer.style.stroke_width > 0) && (
          <ColorField
            label="Outline colour"
            value={value("stroke_colour")}
            onChange={(colour) => setStyle("stroke_colour", colour)}
            marker={marker("stroke_colour")}
          />
        )}
        <Switch checked={value("box")} onChange={(box) => setPlate("shape", box ? "block" : "none")}>
          <span className="flex items-center gap-1.5 text-sm font-medium">
            Box behind the text {marker("box")}
          </span>
        </Switch>
        {any(READ.box) && (
          <>
            <ColorField label="Box colour" value={value("box_colour")} onChange={(colour) => setPlate("colour", colour)} marker={marker("box_colour")} />
            <Slider
              label="Box opacity"
              value={value("box_opacity")}
              min={0}
              max={1}
              step={0.05}
              format={shown("box_opacity", (v) => `${Math.round(v * 100)}%`)}
              onChange={(opacity) => setPlate("opacity", opacity)}
            />
          </>
        )}
        <Segmented legend="Lines" options={ALIGNS} value={value("align")} onChange={(align: TextAlign) => setStyle("align", align)} marker={marker("align")} />
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
