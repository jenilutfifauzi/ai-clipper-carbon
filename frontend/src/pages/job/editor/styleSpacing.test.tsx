// .scratch/text-advanced/issues/13-hook-and-caption-tracking-and-line-height.md: the clip editor's
// style fields set the hook's line height and tracking and the captions' tracking, as Style Overrides.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test } from "vitest";
import type { CaptionStyle, HookStyle, StyleValue } from "../../../api";
import { Slider } from "../../../components/Slider";
import { CaptionStylePanel } from "./CaptionStylePanel";
import { HookMoreOptions } from "./HookStylePanel";
import type { StyleControls, StylePart } from "./useStyleDraft";

function controls(sets: [StylePart, string, StyleValue][]): StyleControls {
  return {
    hook: { shape: "block", max_lines: 2, align: "center", uppercase: false, tracking: 6, line_height: 0.82 } as HookStyle,
    caption: { tracking: 0, max_words: null, position: "auto", highlight: "colour", uppercase: true } as CaptionStyle,
    overrides: { caption: {}, hook: { tracking: 6 }, watermark: {} },
    set: (part, field, value) => {
      sets.push([part, field, value]);
    },
  } as StyleControls;
}

// The Sliders in the element tree `node`, without rendering the components in it.
function sliders(node: ReactNode): ReactElement<Parameters<typeof Slider>[0]>[] {
  if (Array.isArray(node)) return node.flatMap(sliders);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  if (node.type === Slider) return [node as ReactElement<Parameters<typeof Slider>[0]>];
  return sliders(node.props.children);
}

const slider = (node: ReactNode, label: string) => {
  const found = sliders(node).find((element) => element.props.label === label);
  expect(found).toBeDefined();
  return found!.props;
};

describe("spacing in the clip editor's style fields", () => {
  test("the hook's line height and tracking are among its More options, and set its style", () => {
    const sets: [StylePart, string, StyleValue][] = [];
    const style = controls(sets);
    const more = HookMoreOptions({ style, open: true, onToggle: () => {} });
    // The tracking override counts among the changed More options.
    expect((more as ReactElement<{ changed: number }>).props.changed).toBe(1);
    const lineHeight = slider(more, "Line height");
    expect([lineHeight.value, lineHeight.min, lineHeight.max]).toEqual([0.82, 0.5, 2.5]);
    lineHeight.onChange(1.2);
    const tracking = slider(more, "Tracking");
    expect([tracking.value, tracking.min, tracking.max]).toEqual([6, -20, 60]);
    tracking.onChange(-4);
    expect(sets).toEqual([
      ["hook", "line_height", 1.2],
      ["hook", "tracking", -4],
    ]);
  });

  test("the captions' tracking is with their line breaks, and sets their style", () => {
    const sets: [StylePart, string, StyleValue][] = [];
    const panel = CaptionStylePanel({ style: controls(sets), fonts: null, more: true, onMore: () => {} });
    const tracking = slider(panel, "Tracking");
    expect([tracking.value, tracking.min, tracking.max]).toEqual([0, -20, 60]);
    tracking.onChange(10);
    expect(sets).toEqual([["caption", "tracking", 10]]);
  });
});
