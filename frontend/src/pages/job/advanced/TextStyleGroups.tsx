import type { ReactNode } from "react";
import type { HookShape, Plate, TextLayer, TextStyle } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { shadowControls, type ShadowAccess } from "../editor/ShadowFields";
import { Group, Mixed } from "../editor/StyleFields";
import { shared } from "./actions";

/**
 * How a group of Text Style fields reads and changes the picked Text Layers' styles: one layer's,
 * or several at once, where a field they differ in shows the first one's value, marked Mixed.
 */
export interface StyleAccess {
  value<V>(read: (style: TextStyle) => V): V;
  // Whether they differ in what `read` reads.
  mixed(read: (style: TextStyle) => unknown): boolean;
  // Whether any of them passes `test`.
  any(test: (style: TextStyle) => boolean): boolean;
  // `group` names the field being changed, so that its changes are undone as one.
  change(change: (style: TextStyle) => TextStyle, group: string): void;
}

/** One Text Layer's style, changed through `onChange`. */
export function layerStyle(layer: TextLayer, onChange: (layer: TextLayer, group: string) => void): StyleAccess {
  return {
    value: (read) => read(layer.style),
    mixed: () => false,
    any: (test) => test(layer.style),
    change: (change, group) => onChange({ ...layer, style: change(layer.style) }, `text:${layer.id}:${group}`),
  };
}

/** Several picked Text Layers' styles, each changed alike through `onChange`. */
export function layersStyle(
  layers: TextLayer[],
  onChange: (change: (layer: TextLayer) => TextLayer, group: string) => void,
): StyleAccess {
  const mixed = (read: (style: TextStyle) => unknown) => shared(layers, (layer) => read(layer.style)) === undefined;
  return {
    value: (read) => read(layers[0].style),
    mixed,
    any: (test) => layers.some((layer) => test(layer.style)),
    change: (change, group) => onChange((layer) => ({ ...layer, style: change(layer.style) }), `texts:${group}`),
  };
}

// The fields' readers and changers for one part of the style (its plate).
function part<P>(style: StyleAccess, read: (style: TextStyle) => P, write: (style: TextStyle, part: P) => TextStyle, name: string) {
  const marker = (field: keyof P): ReactNode => (style.mixed((s) => read(s)[field]) ? <Mixed /> : undefined);
  return {
    value: <K extends keyof P>(field: K) => style.value((s) => read(s)[field]),
    marker,
    format:
      <K extends keyof P>(field: K, format: (value: number) => string) =>
      (value: number) =>
        style.mixed((s) => read(s)[field]) ? "Mixed" : format(value),
    set: <K extends keyof P>(field: K, value: P[K]) =>
      style.change((s) => write(s, { ...read(s), [field]: value }), `${name}.${String(field)}`),
  };
}

const px = (value: number) => `${Math.round(value)} px`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The drop shadow: on or off, and its colour, opacity, blur, distance and angle (shadowControls). */
export function ShadowGroup({ style }: { style: StyleAccess }) {
  const shadow: ShadowAccess = {
    shadow: style.value((s) => s.shadow),
    mixed: (read) => style.mixed((s) => read(s.shadow)),
    any: (test) => style.any((s) => test(s.shadow)),
    change: (change, field) => style.change((s) => ({ ...s, shadow: change(s.shadow) }), field ? `shadow.${field}` : "shadow"),
  };
  return <Group title="Shadow">{shadowControls(shadow, { inspector: true })}</Group>;
}

const SHAPES = [
  { value: "none", label: "None" },
  { value: "block", label: "Block" },
  { value: "strips", label: "Strips" },
] as const;

/** The plate: none, a Block behind all the lines or Strips behind each, and its colour, opacity, corners and padding. */
export function PlateGroup({ style }: { style: StyleAccess }) {
  const plate = part<Plate>(style, (s) => s.plate, (s, next) => ({ ...s, plate: next }), "plate");
  return (
    <Group title="Plate">
      <Segmented
        legend="Behind the text"
        options={SHAPES}
        value={plate.value("shape")}
        onChange={(shape: HookShape) => plate.set("shape", shape)}
        marker={plate.marker("shape")}
      />
      {style.any((s) => s.plate.shape !== "none") && (
        <>
          <ColorField label="Plate colour" value={plate.value("colour")} onChange={(colour) => plate.set("colour", colour)} marker={plate.marker("colour")} />
          <Slider
            label="Plate opacity"
            value={plate.value("opacity")}
            min={0}
            max={1}
            step={0.05}
            format={plate.format("opacity", percent)}
            onChange={(opacity) => plate.set("opacity", opacity)}
          />
          <Slider
            label="Corner radius"
            value={plate.value("radius")}
            min={0}
            max={200}
            format={plate.format("radius", px)}
            onChange={(radius) => plate.set("radius", radius)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Slider
              label="Padding across"
              value={plate.value("padding_x")}
              min={0}
              max={200}
              format={plate.format("padding_x", px)}
              onChange={(padding) => plate.set("padding_x", padding)}
            />
            <Slider
              label="Padding down"
              value={plate.value("padding_y")}
              min={0}
              max={200}
              format={plate.format("padding_y", px)}
              onChange={(padding) => plate.set("padding_y", padding)}
            />
          </div>
        </>
      )}
    </Group>
  );
}

/** The spacing of the lines and of the letters. */
export function SpacingGroup({ style }: { style: StyleAccess }) {
  const lineHeight = (s: TextStyle) => s.line_height;
  const tracking = (s: TextStyle) => s.tracking;
  return (
    <Group title="Spacing">
      <Slider
        label="Line height"
        value={style.value(lineHeight)}
        min={0.5}
        max={3}
        step={0.05}
        format={(v) => (style.mixed(lineHeight) ? "Mixed" : `${v.toFixed(2)}×`)}
        onChange={(value) => style.change((s) => ({ ...s, line_height: value }), "style.line_height")}
      />
      <Slider
        label="Tracking"
        value={style.value(tracking)}
        min={-50}
        max={200}
        format={(v) => (style.mixed(tracking) ? "Mixed" : `${Math.round(v)} px`)}
        onChange={(value) => style.change((s) => ({ ...s, tracking: value }), "style.tracking")}
      />
    </Group>
  );
}
