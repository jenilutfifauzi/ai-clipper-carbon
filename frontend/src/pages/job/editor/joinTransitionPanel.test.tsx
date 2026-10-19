// .scratch/transitions-expanded/issues/09: a Style Preset's Join Transition, shown and set in the
// Transitions tab where its other styles are, and saved with them; none, read-only, on a built-in one.
import { isValidElement, type JSXElementConstructor, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { CaptionStyle, HookStyle, JoinTransition, StylePreset, WatermarkStyle } from "../../../api";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { JoinKind, JoinTransitionPanel } from "./JoinTransitionPanel";
import { savedLook, type StyleControls } from "./useStyleDraft";

// The elements of `type` in the element tree `node`, without rendering the components in it.
function found<Props>(node: ReactNode, type: JSXElementConstructor<never>): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((child) => found<Props>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const inside = found<Props>(node.props.children, type);
  return node.type === type ? [node as ReactElement<Props>, ...inside] : inside;
}
type Field<T> = { label?: string; legend?: string; value: T; onChange: (value: T) => void; disabled?: boolean };

const CROSSFADE: JoinTransition = { kind: "filmburn", secs: 0.8, sound: "equal_power", strength: null, colour: null };

function controls(join: JoinTransition | null, builtin = false, setJoin = vi.fn()): StyleControls {
  const preset = { id: builtin ? "default" : "p1", name: "House", builtin, join_transition: join } as StylePreset;
  return { preset, join, setJoin, joinChanged: false } as unknown as StyleControls;
}

describe("the Preset's Join Transition", () => {
  test("a built-in Preset shows none, read-only", () => {
    const panel = JoinTransitionPanel({ style: controls(null, true) });
    const [kind] = found<Field<string>>(panel, JoinKind);
    expect(kind.props).toMatchObject({ value: "none", disabled: true });
    expect(found(panel, Slider)).toEqual([]);
    expect(renderToStaticMarkup(<JoinKind value="none" disabled onChange={() => {}} />)).toMatch(/<select[^>]* disabled=""[^>]*>.*<option value="none" selected="">None<\/option>/);
  });

  test("the owner's Preset offers None and every kind by group, and picking one sets it", () => {
    const html = renderToStaticMarkup(<JoinKind value="none" onChange={() => {}} />);
    expect([...html.matchAll(/<optgroup label="([^"]*)"/g)].map(([, group]) => group)).toEqual(["Basic", "Slide", "Wipe", "Shape", "Zoom", "Light", "Glitch"]);
    const setJoin = vi.fn();
    const [kind] = found<Field<string>>(JoinTransitionPanel({ style: controls(null, false, setJoin) }), JoinKind);
    expect(kind.props.disabled).toBeFalsy();
    kind.props.onChange("fadeblack");
    expect(setJoin).toHaveBeenLastCalledWith({ kind: "fadeblack", secs: 0.5, sound: "linear" });
    const [again] = found<Field<string>>(JoinTransitionPanel({ style: controls(CROSSFADE, false, setJoin) }), JoinKind);
    // Another kind keeps its length, sound and knobs; None clears it.
    again.props.onChange("fade");
    expect(setJoin).toHaveBeenLastCalledWith({ ...CROSSFADE, kind: "fade" });
    again.props.onChange("none");
    expect(setJoin).toHaveBeenLastCalledWith(null);
  });

  test("its length, strength where its kind reads it, and sound are set", () => {
    const setJoin = vi.fn();
    const panel = JoinTransitionPanel({ style: controls(CROSSFADE, false, setJoin) });
    const sliders = found<Field<number>>(panel, Slider);
    expect(sliders.map((slider) => [slider.props.label, slider.props.value])).toEqual([["Length", 0.8], ["Strength", 0.6]]);
    sliders[0].props.onChange(1.2);
    expect(setJoin).toHaveBeenLastCalledWith({ ...CROSSFADE, secs: 1.2 });
    const [sound] = found<Field<string>>(panel, Segmented);
    expect(sound.props).toMatchObject({ legend: "Sound", value: "equal_power" });
    sound.props.onChange("cut");
    expect(setJoin).toHaveBeenLastCalledWith({ ...CROSSFADE, sound: "cut" });
  });

  test("is saved with the Preset's styles", () => {
    const style = {
      caption: { size: 90 } as CaptionStyle,
      hook: { size: 80 } as HookStyle,
      watermark: { kind: "none" } as WatermarkStyle,
      join: CROSSFADE,
    } as StyleControls;
    expect(savedLook(style)).toEqual({ caption: style.caption, hook: style.hook, watermark: style.watermark, join_transition: CROSSFADE });
  });
});
