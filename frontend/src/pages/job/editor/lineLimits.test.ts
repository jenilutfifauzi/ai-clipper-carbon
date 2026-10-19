// .scratch/captions-advanced/issues/03-two-line-cues-phrase-and-sentence.md: the shared Caption Style
// panel's Lines field and its Phrase and Sentence buttons, which fill the line limits and mark the
// one the current values match.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import shared from "../../../../../backend/tests/fixtures/line_limits.json";
import { describe, expect, test } from "vitest";
import type { CaptionStyle, HookStyle, StylePreset, WatermarkStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { Segmented } from "../../../components/Segmented";
import { CaptionStylePanel } from "./CaptionStylePanel";
import { LINE_LIMITS, lineLimitsOf } from "./lineLimits";
import { styleControls, type StyleDraft } from "./useStyleDraft";

const caption = {
  font: "montserrat-extrabold", size: 110, position: "auto", highlight: "colour", uppercase: true, tracking: 0, y: 1300, x: null,
  ...LINE_LIMITS.phrase,
} as unknown as CaptionStyle;
const PRESETS: StylePreset[] = [
  { id: "default", name: "Default", caption, hook: {} as HookStyle, watermark: {} as WatermarkStyle, builtin: true },
];

/** The clip editor's controls: each change a new draft, kept. */
function editor(start: StyleDraft = { preset_id: "default", style_overrides: { caption: {}, hook: {}, watermark: {} } }) {
  let draft = start;
  return {
    get draft() {
      return draft;
    },
    controls: () => styleControls(PRESETS, draft, (next) => (draft = next), () => {}),
  };
}

// The elements of type `type` in the element tree `node`, without rendering the components in it.
function found<P>(node: ReactNode, type: unknown): ReactElement<P>[] {
  if (Array.isArray(node)) return node.flatMap((child) => found<P>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [...(node.type === type ? [node as ReactElement<P>] : []), ...found<P>(node.props.children, type)];
}

function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join("");
  if (typeof node === "string") return node;
  return isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : "";
}

type ButtonProps = { children?: ReactNode; onClick?: () => void; "aria-pressed"?: boolean };

function panel(space: ReturnType<typeof editor>) {
  const tree = CaptionStylePanel({ style: space.controls(), fonts: null, more: false, onMore: () => {} });
  const buttons = found<ButtonProps>(tree, Button);
  const button = (label: string) => buttons.find((element) => text(element.props.children).includes(label))!.props;
  const lines = found<Parameters<typeof Segmented<string>>[0]>(tree, Segmented).find((element) => element.props.legend === "Lines")!.props;
  return { phrase: button("Phrase"), sentence: button("Sentence"), lines };
}

describe("Phrase and Sentence", () => {
  test("are the backend's (styles.py's LINE_LIMITS, which its tests check against the same file)", () => {
    expect(LINE_LIMITS).toEqual(shared);
  });

  test("a style is the one whose line limits it has, or neither", () => {
    expect(lineLimitsOf(caption)).toBe("phrase");
    expect(lineLimitsOf({ ...caption, ...LINE_LIMITS.sentence })).toBe("sentence");
    expect(lineLimitsOf({ ...caption, ...LINE_LIMITS.sentence, max_chars: 20 })).toBeNull();
    expect(lineLimitsOf({ ...caption, max_words: 3 })).toBeNull();
  });

  test("Sentence fills the line limits, its mark following hand edits; Phrase puts the Preset's back", () => {
    const space = editor();
    expect([panel(space).phrase["aria-pressed"], panel(space).sentence["aria-pressed"]]).toEqual([true, false]);
    expect(panel(space).lines.value).toBe("1");

    panel(space).sentence.onClick!();
    expect(space.draft.style_overrides.caption).toEqual({ max_lines: 2, max_chars: 24, max_secs: 5, pause_secs: 0.7 });
    expect([panel(space).phrase["aria-pressed"], panel(space).sentence["aria-pressed"]]).toEqual([false, true]);
    expect(panel(space).lines.value).toBe("2");

    // A hand edit: neither is marked.
    space.controls().set("caption", "max_chars", 20);
    expect([panel(space).phrase["aria-pressed"], panel(space).sentence["aria-pressed"]]).toEqual([false, false]);

    // The Preset's are Phrase's: its overrides go.
    panel(space).phrase.onClick!();
    expect(space.draft.style_overrides.caption).toEqual({});
  });

  test("the Lines field sets max_lines alone", () => {
    const space = editor();
    panel(space).lines.onChange("3");
    expect(space.draft.style_overrides.caption).toEqual({ max_lines: 3 });
    expect(lineLimitsOf(space.controls().caption)).toBeNull();
  });
});
