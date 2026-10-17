// .scratch/text-advanced/issues/14-hook-and-caption-shadow-and-box-shape.md: the clip editor's style
// fields set the hook's and captions' drop shadow, the hook's box padding and the highlight box's
// padding and corners, as Style Overrides.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import type { CaptionStyle, DropShadow, HookStyle, StyleValue } from "../../../api";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { NO_SHADOW } from "./shadow";
import { CaptionStylePanel } from "./CaptionStylePanel";
import { HookMoreOptions } from "./HookStylePanel";
import { ShadowFields } from "./ShadowFields";
import type { StyleControls, StylePart } from "./useStyleDraft";

const HARD: DropShadow = { colour: "#000000", opacity: 1, blur: 0, distance: 4 * Math.SQRT2, angle: 45 };

function controls(sets: [StylePart, string, StyleValue][], highlight: CaptionStyle["highlight"] = "box"): StyleControls {
  return {
    hook: { shape: "strips", size: 80, max_lines: 2, align: "center", uppercase: false, shadow: NO_SHADOW, padding_x: null, padding_y: 30 } as HookStyle,
    caption: { size: 100, shadow: HARD, highlight, padding_x: null, padding_y: null, radius: 8, max_words: null, position: "auto", uppercase: true } as CaptionStyle,
    overrides: { caption: { radius: 8 }, hook: { padding_y: 30, shadow: { blur: 2 } }, watermark: {} },
    set: (part, field, value) => {
      sets.push([part, field, value]);
    },
  } as StyleControls;
}

// The elements of `type` in the element tree `node`, without rendering the components in it.
function found<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => found<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  if (node.type === type) return [node as ReactElement<P>];
  return found<P>(node.props.children, type);
}

type SliderProps = Parameters<typeof Slider>[0];
const slider = (node: ReactNode, label: string) => {
  const [element] = found<SliderProps>(node, Slider).filter((element) => element.props.label === label);
  expect(element).toBeDefined();
  return element.props;
};
const shadowFields = (node: ReactNode) => {
  const [element] = found<Parameters<typeof ShadowFields>[0]>(node, ShadowFields);
  expect(element).toBeDefined();
  return element.props;
};

describe("the drop shadow in the clip editor's style fields", () => {
  test("turning it on moves and blurs it a little, and each field changes the whole shadow", () => {
    const changes: DropShadow[] = [];
    const off = ShadowFields({ shadow: NO_SHADOW, onChange: (shadow) => changes.push(shadow), marker: null });
    expect(found(off, Slider)).toEqual([]);
    found<Parameters<typeof Switch>[0]>(off, Switch)[0].props.onChange(true);
    expect(changes).toEqual([{ ...NO_SHADOW, distance: 6, blur: 8 }]);

    const on = ShadowFields({ shadow: HARD, onChange: (shadow) => changes.push(shadow), marker: null });
    expect(found<SliderProps>(on, Slider).map((element) => element.props.label)).toEqual(["Shadow opacity", "Blur", "Distance", "Angle"]);
    slider(on, "Angle").onChange(90);
    slider(on, "Blur").onChange(12);
    found<Parameters<typeof Switch>[0]>(on, Switch)[0].props.onChange(false);
    expect(changes.slice(1)).toEqual([{ ...HARD, angle: 90 }, { ...HARD, blur: 12 }, { ...HARD, opacity: 0 }]);
  });

  test("the hook's and the captions' set their style's shadow", () => {
    const sets: [StylePart, string, StyleValue][] = [];
    const style = controls(sets);
    const hook = shadowFields(HookMoreOptions({ style, open: true, onToggle: () => {} }));
    expect(hook.shadow).toBe(NO_SHADOW);
    hook.onChange({ ...NO_SHADOW, distance: 3 });
    const caption = shadowFields(CaptionStylePanel({ style, fonts: null, more: true, onMore: () => {} }));
    expect(caption.shadow).toBe(HARD);
    caption.onChange({ ...HARD, blur: 4 });
    expect(sets).toEqual([
      ["hook", "shadow", { ...NO_SHADOW, distance: 3 }],
      ["caption", "shadow", { ...HARD, blur: 4 }],
    ]);
  });
});

describe("box shape in the clip editor's style fields", () => {
  test("the hook's box padding shows its Shape's own until it is set, and counts among the changed More options", () => {
    const sets: [StylePart, string, StyleValue][] = [];
    const more = HookMoreOptions({ style: controls(sets), open: true, onToggle: () => {} });
    expect((more as ReactElement<{ changed: number }>).props.changed).toBe(2);
    // A strip's own across: a quarter of the size.
    const across = slider(more, "Padding across");
    expect([across.value, across.min, across.max]).toEqual([20, 0, 200]);
    expect(slider(more, "Padding down").value).toBe(30);
    across.onChange(48);
    expect(sets).toEqual([["hook", "padding_x", 48]]);
  });

  test("the highlight box's padding and corners are shown with a box highlight, its own until set", () => {
    const sets: [StylePart, string, StyleValue][] = [];
    const panel = CaptionStylePanel({ style: controls(sets), fonts: null, more: true, onMore: () => {} });
    expect([slider(panel, "Padding across").value, slider(panel, "Padding down").value, slider(panel, "Corner radius").value]).toEqual([12, 8, 8]);
    slider(panel, "Padding down").onChange(14);
    expect(sets).toEqual([["caption", "padding_y", 14]]);
    const colour = CaptionStylePanel({ style: controls(sets, "colour"), fonts: null, more: true, onMore: () => {} });
    expect(found<SliderProps>(colour, Slider).some((element) => element.props.label === "Padding across")).toBe(false);
  });
});
