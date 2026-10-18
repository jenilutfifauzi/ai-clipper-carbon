import { ClipboardCopy, Copy, Trash2 } from "lucide-react";
import { useId } from "react";
import type { Animation, FontInfo, TextAlign, TextLayer, TextStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { FacePicker } from "../editor/FacePicker";
import { FRAME } from "../editor/picture";
import { Group, Mixed } from "../editor/StyleFields";
import { shared } from "./actions";
import { newId, newTiming } from "./edits";
import type { PictureLayerKind } from "./pick";
import { styled } from "./textStyle";
import { ApplyTextPreset, SaveAsTextPreset } from "./TextPresets";
import { layersStyle, layerStyle, PlateGroup, ShadowGroup, SpacingGroup } from "./TextStyleGroups";
import { TimingFields } from "./TimingFields";
import { TextTransformFields } from "./TransformFields";

// The backend's limit (TEXT_LAYER_MAX_CHARS in app/candidates.py).
const TEXT_MAX_CHARS = 300;

// What a new Text Layer is made of: all of it but its id, its time and its Keyframes (it has none):
// a Text Preset's sample in its Text Style (TextPresets.tsx' fromPreset).
export type UntimedTextLayer = Omit<TextLayer, "id" | "start" | "secs" | "keys">;

/** A Text Layer of `made` at `at` (the playhead, or where it was dropped), for NEW_LAYER_SECS or to the Clip's end. */
export function newTextLayer(made: UntimedTextLayer, at: number, duration: number): TextLayer {
  return { ...made, id: newId(), ...newTiming(at, duration), keys: {} };
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

/** The selected Text Layer's words, Text Style, Transform, motion and time. */
export function TextLayerFields({
  layer,
  duration,
  fonts,
  onChange,
  onApplyTextStyle,
  onDuplicate,
  onDelete,
}: {
  layer: TextLayer;
  duration: number;
  fonts: FontInfo[] | null;
  // `group` names the field being changed, so that its changes are undone as one.
  onChange: (layer: TextLayer, group: string) => void;
  // A Text Preset's Text Style given to it (actions.ts' applyTextStyle), as one change.
  onApplyTextStyle: (style: TextStyle) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const id = useId();
  const set = <K extends keyof TextLayer>(field: K, value: TextLayer[K]) => onChange({ ...layer, [field]: value }, `text:${layer.id}:${field}`);
  const setStyle = <K extends keyof TextStyle>(field: K, value: TextStyle[K]) =>
    onChange({ ...layer, style: styled(layer.style, field, value) }, `text:${layer.id}:style.${field}`);
  const { style } = layer;
  const access = layerStyle(layer, onChange);
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
        <ApplyTextPreset onApply={onApplyTextStyle} />
        <FacePicker value={style.font} fonts={fonts} onChange={(font) => setStyle("font", font)} />
        <Slider label="Size" value={style.size} min={16} max={320} onChange={(size) => setStyle("size", size)} />
        <ColorField label="Colour" value={style.colour} onChange={(colour) => setStyle("colour", colour)} />
        <Slider
          label="Stroke"
          value={style.stroke_width}
          min={0}
          max={20}
          format={(v) => (v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", width)}
        />
        {style.stroke_width > 0 && <ColorField label="Stroke colour" value={style.stroke_colour} onChange={(colour) => setStyle("stroke_colour", colour)} />}
        <Segmented legend="Lines" options={ALIGNS} value={style.align} onChange={(align: TextAlign) => setStyle("align", align)} />
        <SaveAsTextPreset style={style} />
      </Group>
      <ShadowGroup style={access} />
      <PlateGroup style={access} />
      <SpacingGroup style={access} />
      <Group title="Box">
        <BoxField label="Wrap width" value={style.wrap_width} most={FRAME.width} onChange={(width) => setStyle("wrap_width", width)} />
        <BoxField label="Fixed height" value={style.fixed_height} most={FRAME.height} onChange={(height) => setStyle("fixed_height", height)} />
      </Group>
      <TextTransformFields layer={layer} onChange={onChange} />
      <MotionFields item={layer} kind="text" onChange={onChange} />
      <TimingFields item={layer} duration={duration} labels={{ start: "Comes on at", secs: "Stays for" }} onChange={onChange} />
    </div>
  );
}

// What comes on and goes off as the hook does: a Text Layer, a Shape.
type Animated = Pick<TextLayer, "id" | "animation_in" | "animation_out" | "animation_ms">;

/**
 * The Motion fields of a Text Layer or a Shape (`kind`): how it comes on and goes off (Fade, Pop,
 * Slide), stacked on its Keyframes, and, once it does, for how long. Each field's changes are a step
 * of their own.
 */
export function MotionFields<T extends Animated>({ item, kind, onChange }: { item: T; kind: PictureLayerKind; onChange: (item: T, group: string) => void }) {
  const set = <K extends keyof Animated>(field: K, value: Animated[K]) => onChange({ ...item, [field]: value }, `${kind}:${item.id}:${field}`);
  const animated = item.animation_in !== "none" || item.animation_out !== "none";
  return (
    <Group title="Motion">
      <div className="grid grid-cols-2 gap-3">
        <Select label="Comes on" value={item.animation_in} options={ANIMATIONS} onChange={(value: Animation) => set("animation_in", value)} />
        <Select label="Goes off" value={item.animation_out} options={ANIMATIONS} onChange={(value: Animation) => set("animation_out", value)} />
      </div>
      {animated && (
        <Slider
          label="Animation length"
          value={item.animation_ms}
          min={100}
          max={2000}
          step={50}
          format={(v) => `${(v / 1000).toFixed(2)} s`}
          onChange={(ms) => set("animation_ms", ms)}
        />
      )}
    </Group>
  );
}

// The Motion fields, by name.
type Motion = Exclude<keyof Animated, "id">;

/**
 * Several picked Text Layers' or Shapes' Motion fields, each set on every one of them at once, as
 * one change named after its `prefix` and field ("texts:animation_in"). A field they differ in
 * shows the first one's value, marked Mixed, until it is set.
 */
export function SeveralMotionFields<T extends Animated>({
  items,
  prefix,
  onChange,
}: {
  items: T[];
  prefix: "texts" | "shapes";
  onChange: (change: (item: T) => T, group: string) => void;
}) {
  const onSet = <K extends Motion>(field: K, value: Animated[K]) => onChange((item) => ({ ...item, [field]: value }), `${prefix}:${field}`);
  const mixed = (field: Motion) => shared(items, (item) => item[field]) === undefined;
  const value = <K extends Motion>(field: K) => (shared(items, (item) => item[field]) ?? items[0][field]) as Animated[K];
  const marker = (field: Motion) => (mixed(field) ? <Mixed /> : undefined);
  return (
    <Group title="Motion">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Comes on"
          value={value("animation_in")}
          options={ANIMATIONS}
          onChange={(next: Animation) => onSet("animation_in", next)}
          marker={marker("animation_in")}
        />
        <Select
          label="Goes off"
          value={value("animation_out")}
          options={ANIMATIONS}
          onChange={(next: Animation) => onSet("animation_out", next)}
          marker={marker("animation_out")}
        />
      </div>
      {items.some((item) => item.animation_in !== "none" || item.animation_out !== "none") && (
        <Slider
          label="Animation length"
          value={value("animation_ms")}
          min={100}
          max={2000}
          step={50}
          format={(v) => (mixed("animation_ms") ? "Mixed" : `${(v / 1000).toFixed(2)} s`)}
          onChange={(ms) => onSet("animation_ms", ms)}
        />
      )}
    </Group>
  );
}

/**
 * A Text Layer's wrap width or fixed height: Auto at 0 (the frame less a margin, or the words' own
 * height), or in output pixels, with Auto to go back to it. Its slider reaches across the frame
 * (`most`), the field itself takes more (4096 px). Its box Grips on the stage set it too.
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
};
type Field = keyof typeof READ;

/**
 * Several picked Text Layers' Text Style and motion, set on every one of them at once. A field they differ
 * in shows the first one's value, marked Mixed, until it is set. Their words and places stay their own.
 */
export function TextLayersFields({
  layers,
  fonts,
  onChange,
  onApplyTextStyle,
  onDuplicate,
  onCopy,
  onDelete,
}: {
  layers: TextLayer[];
  fonts: FontInfo[] | null;
  // `change` made to them all; `group` names the field, so that its changes are undone as one.
  onChange: (change: (layer: TextLayer) => TextLayer, group: string) => void;
  // A Text Preset's Text Style given to them all (actions.ts' applyTextStyle), as one change.
  onApplyTextStyle: (style: TextStyle) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const read = (field: Field) => READ[field] as (layer: TextLayer) => unknown;
  const value = <F extends Field>(field: F) => (shared(layers, read(field)) ?? read(field)(layers[0])) as ReturnType<(typeof READ)[F]>;
  const mixed = (field: Field) => shared(layers, read(field)) === undefined;
  const marker = (field: Field) => (mixed(field) ? <Mixed /> : undefined);
  const setStyle = <K extends keyof TextStyle>(field: K, next: TextStyle[K]) =>
    onChange((layer) => ({ ...layer, style: styled(layer.style, field, next) }), `texts:style.${field}`);
  const access = layersStyle(layers, onChange);
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
        <ApplyTextPreset onApply={onApplyTextStyle} />
        <FacePicker value={value("font")} fonts={fonts} onChange={(font) => setStyle("font", font)} marker={marker("font")} />
        <Slider label="Size" value={value("size")} min={16} max={320} format={shown("size", String)} onChange={(size) => setStyle("size", size)} />
        <ColorField label="Colour" value={value("colour")} onChange={(colour) => setStyle("colour", colour)} marker={marker("colour")} />
        <Slider
          label="Stroke"
          value={value("stroke_width")}
          min={0}
          max={20}
          format={shown("stroke_width", (v) => (v ? `${v} px` : "None"))}
          onChange={(width) => setStyle("stroke_width", width)}
        />
        {any((layer) => layer.style.stroke_width > 0) && (
          <ColorField
            label="Stroke colour"
            value={value("stroke_colour")}
            onChange={(colour) => setStyle("stroke_colour", colour)}
            marker={marker("stroke_colour")}
          />
        )}
        <Segmented legend="Lines" options={ALIGNS} value={value("align")} onChange={(align: TextAlign) => setStyle("align", align)} marker={marker("align")} />
      </Group>
      <ShadowGroup style={access} />
      <PlateGroup style={access} />
      <SpacingGroup style={access} />
      <SeveralMotionFields items={layers} prefix="texts" onChange={onChange} />
    </div>
  );
}
