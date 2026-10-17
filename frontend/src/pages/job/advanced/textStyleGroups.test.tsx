// .scratch/text-advanced/issues/04-shadow-plate-and-spacing.md: the inspector's Shadow, Plate and
// Spacing groups set a Text Layer's style, or several picked ones' at once.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import type { TextLayer } from "../../../api";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { IDENTITY } from "../editor/picture";
import { NO_SHADOW, shadowOn, withShadow } from "../editor/shadow";
import { layersStyle, layerStyle, PlateGroup, ShadowGroup, SpacingGroup, type StyleAccess } from "./TextStyleGroups";
import { textStyle } from "./textStyle";

const layer = (id: string, style: Parameters<typeof textStyle>[0] = {}): TextLayer => ({
  id,
  text: "Halo",
  start: 0,
  secs: 2,
  transform: { ...IDENTITY },
  style: textStyle(style),
  animation_in: "none",
  animation_out: "none",
  animation_ms: 300,
  keys: {},
});

// The elements of `types` in the element tree `node`, in its order, without rendering the components in it.
function found<P>(node: ReactNode, ...types: unknown[]): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => found<P>(child, ...types));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const inside = found<P>(node.props.children, ...types);
  return types.includes(node.type) ? [node as ReactElement<P>, ...inside] : inside;
}

type Labelled = { label: string; value: unknown; onChange: (value: never) => void; format?: (value: number) => string; marker?: ReactNode };
const fields = (node: ReactNode) => found<Labelled>(node, Slider, ColorField);
const field = (node: ReactNode, label: string): Labelled => {
  const [element] = fields(node).filter((e) => e.props.label === label);
  expect(element, label).toBeDefined();
  return element.props;
};
const labels = (node: ReactNode) => fields(node).map((e) => e.props.label);

// One layer, its changes kept in `changed`.
function one(picked: TextLayer, changed: [TextLayer, string][]): StyleAccess {
  return layerStyle(picked, (next, group) => changed.push([next, group]));
}

describe("a Text Style's shadow, plate and spacing in the inspector", () => {
  test("a shadow is off by default; turned on it falls down and right, and off keeps what it was", () => {
    expect(shadowOn(NO_SHADOW)).toBe(false);
    const on = withShadow(NO_SHADOW, true);
    expect(on).toEqual({ ...NO_SHADOW, distance: 6, blur: 8 });
    expect(shadowOn(on)).toBe(true);
    const off = withShadow({ ...on, angle: 120 }, false);
    expect(off).toEqual({ ...on, angle: 120, opacity: 0 });
    expect(withShadow(off, true)).toEqual({ ...on, angle: 120 });
    // A halo stays a halo.
    expect(withShadow({ ...NO_SHADOW, blur: 20, opacity: 0 }, true)).toEqual({ ...NO_SHADOW, blur: 20 });
  });

  test("the Shadow group turns it on, and sets one of its fields keeping the others", () => {
    const changed: [TextLayer, string][] = [];
    const plain = layer("a");
    const off = ShadowGroup({ style: one(plain, changed) });
    expect(labels(off)).toEqual([]);
    found<{ onChange: (on: boolean) => void }>(off, Switch)[0].props.onChange(true);
    const [[lit, group]] = changed;
    expect(lit.style.shadow).toEqual({ ...NO_SHADOW, distance: 6, blur: 8 });
    expect(group).toBe("text:a:shadow");

    const fields = ShadowGroup({ style: one(lit, changed) });
    expect(labels(fields)).toEqual(["Shadow colour", "Shadow opacity", "Blur", "Distance", "Angle"]);
    const angle = field(fields, "Angle");
    expect(angle.format!(135)).toBe("135°");
    (angle.onChange as (value: number) => void)(135);
    const [next, angleGroup] = changed[1];
    expect(next.style.shadow).toEqual({ ...lit.style.shadow, angle: 135 });
    expect({ ...next.style, shadow: lit.style.shadow }).toEqual(lit.style);
    expect(angleGroup).toBe("text:a:shadow.angle");
  });

  test("the Plate group picks Block or Strips and sets the corners and padding", () => {
    const changed: [TextLayer, string][] = [];
    const plain = layer("a", { size: 80 });
    const none = PlateGroup({ style: one(plain, changed) });
    expect(labels(none)).toEqual([]);
    const shape = found<{ options: readonly { value: string }[]; onChange: (shape: string) => void }>(none, Segmented)[0].props;
    expect(shape.options.map((option) => option.value)).toEqual(["none", "block", "strips"]);
    shape.onChange("strips");
    const strips = changed[0][0];
    expect(strips.style.plate).toEqual({ ...plain.style.plate, shape: "strips" });

    const fields = PlateGroup({ style: one(strips, changed) });
    expect(labels(fields)).toEqual(["Plate colour", "Plate opacity", "Corner radius", "Padding across", "Padding down"]);
    (field(fields, "Corner radius").onChange as (value: number) => void)(40);
    (field(fields, "Padding down").onChange as (value: number) => void)(30);
    expect(changed[1][0].style.plate).toEqual({ ...strips.style.plate, radius: 40 });
    expect(changed[2][0].style.plate).toEqual({ ...strips.style.plate, padding_y: 30 });
    expect(changed.map(([, group]) => group)).toEqual(["text:a:plate.shape", "text:a:plate.radius", "text:a:plate.padding_y"]);
  });

  test("the Spacing group sets the line height and the tracking, negative too", () => {
    const changed: [TextLayer, string][] = [];
    const spacing = SpacingGroup({ style: one(layer("a"), changed) });
    const tracking = field(spacing, "Tracking");
    expect(tracking.value).toBe(0);
    (tracking.onChange as (value: number) => void)(-6);
    (field(spacing, "Line height").onChange as (value: number) => void)(1.4);
    expect(changed.map(([next]) => [next.style.tracking, next.style.line_height])).toEqual([
      [-6, 1.1],
      [0, 1.4],
    ]);
  });

  test("several picked layers show Mixed where they differ, and a change sets it on each, keeping the rest", () => {
    const shadowed = layer("a", { shadow: { distance: 10, opacity: 1 } });
    const plain = layer("b", { colour: "#FF0000" });
    const changes: ((layer: TextLayer) => TextLayer)[] = [];
    const style = layersStyle([shadowed, plain], (change) => changes.push(change));
    const group = ShadowGroup({ style });
    // The fields show, as one of them has a shadow; the opacity and distance differ.
    expect(field(group, "Distance").format!(10)).toBe("Mixed");
    expect(field(group, "Shadow opacity").format!(1)).toBe("Mixed");
    expect(field(group, "Shadow colour").marker).toBeUndefined();
    expect(field(group, "Blur").format!(0)).toBe("0 px");
    (field(group, "Blur").onChange as (value: number) => void)(12);
    const [blurred, blurredPlain] = [shadowed, plain].map(changes[0]);
    expect(blurred.style.shadow).toEqual({ ...shadowed.style.shadow, blur: 12 });
    expect(blurredPlain.style).toEqual({ ...plain.style, shadow: { ...plain.style.shadow, blur: 12 } });

    const spacing = SpacingGroup({ style });
    expect(field(spacing, "Tracking").format!(0)).toBe("0 px");
  });
});
