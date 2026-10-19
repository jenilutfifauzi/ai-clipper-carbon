// .scratch/transitions-expanded/issues/06: the join inspector chooses how a Transition's sound
// crosses, each choice one step of undo. And 04: its Strength and Colour, where its kind reads them.
import { isValidElement, type JSXElementConstructor, type ReactElement, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import type { Transition } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { TransitionPanel } from "./Transitions";

type Choice = { legend: string; options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void };

// The elements of `type` in the element tree `node`, without rendering the components in it.
function found<Props>(node: ReactNode, type: JSXElementConstructor<never>): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap((child) => found<Props>(child, type));
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const inside = found<Props>(node.props.children, type);
  return node.type === type ? [node as ReactElement<Props>, ...inside] : inside;
}
const segmented = (node: ReactNode) => found<Choice>(node, Segmented);
type Field<T> = { label: string; value: T; onChange: (value: T) => void; format?: (value: T) => string };
const sliders = (node: ReactNode) => found<Field<number>>(node, Slider);
const colours = (node: ReactNode) => found<Field<string>>(node, ColorField);

const panel = (transition: Transition, onChange: (transition: Transition, group?: string) => void) =>
  TransitionPanel({ transition, joined: true, kinds: false, onPick: () => {}, onChange, onRemove: () => {} });

describe("the join inspector's Sound", () => {
  test("offers Linear, Equal power and Cut, a stored Transition reading as Linear", () => {
    const [sound] = segmented(panel({ after: "s0", kind: "fadeblack", secs: 0.5 }, () => {}));
    expect(sound.props.legend).toBe("Sound");
    expect(sound.props.options.map((option) => option.label)).toEqual(["Linear", "Equal power", "Cut"]);
    expect(sound.props.value).toBe("linear");
  });

  test("sets the Transition's sound as one step of undo, keeping the rest of it", () => {
    const onChange = vi.fn();
    const [sound] = segmented(panel({ after: "s0", kind: "fade", secs: 0.8, sound: "equal_power" }, onChange));
    expect(sound.props.value).toBe("equal_power");
    sound.props.onChange("cut");
    // No group, so it never merges into the step before.
    expect(onChange).toHaveBeenCalledWith({ after: "s0", kind: "fade", secs: 0.8, sound: "cut" });
    expect(onChange.mock.calls[0]).toHaveLength(1);
  });
});

describe("the join inspector's knobs", () => {
  test("Strength shows only for kinds that read it, as a share of its own when unset", () => {
    const labels = (transition: Transition) => sliders(panel(transition, () => {})).map((slider) => slider.props.label);
    expect(labels({ after: "s0", kind: "fade", secs: 0.5, strength: 0.3 })).toEqual(["Length"]);
    expect(labels({ after: "s0", kind: "dipcolour", secs: 0.5 })).toEqual(["Length"]);
    for (const kind of ["filmburn", "lightleak", "rgbsplit"] as const) expect(labels({ after: "s0", kind, secs: 0.5 })).toEqual(["Length", "Strength"]);
    const [, strength] = sliders(panel({ after: "s0", kind: "filmburn", secs: 0.5 }, () => {}));
    expect(strength.props.value).toBe(0.6);
    expect(strength.props.format?.(0.6)).toBe("60%");
  });

  test("Colour shows only for Dip to colour, black when unset", () => {
    expect(colours(panel({ after: "s0", kind: "fadeblack", secs: 0.5, colour: "#FF0000" }, () => {}))).toEqual([]);
    expect(colours(panel({ after: "s0", kind: "filmburn", secs: 0.5 }, () => {}))).toEqual([]);
    const [colour] = colours(panel({ after: "s0", kind: "dipcolour", secs: 0.5 }, () => {}));
    expect(colour.props).toMatchObject({ label: "Colour", value: "#000000" });
  });

  test("each knob's changes are one step of undo, keeping the rest of the Transition", () => {
    const onChange = vi.fn();
    const transition: Transition = { after: "s1", kind: "dipcolour", secs: 0.8, sound: "cut", strength: 0.4 };
    colours(panel(transition, onChange))[0].props.onChange("#3366FF");
    expect(onChange).toHaveBeenLastCalledWith({ ...transition, colour: "#3366FF" }, "transition:s1:colour");
    sliders(panel({ ...transition, kind: "rgbsplit" }, onChange))[1].props.onChange(0.9);
    expect(onChange).toHaveBeenLastCalledWith({ ...transition, kind: "rgbsplit", strength: 0.9 }, "transition:s1:strength");
  });
});

// .scratch/transitions-expanded/issues/08: the actions on every join, and the Random card.
type Clicked = { children?: ReactNode; disabled?: boolean; onClick?: () => void };
const text = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(text).join("") : isValidElement<{ children?: ReactNode }>(node) ? text(node.props.children) : typeof node === "string" ? node : "";
const buttons = (node: ReactNode) => found<Clicked>(node, Button).map((button) => ({ label: text(button.props.children), ...button.props }));
const randomCard = (node: ReactNode) => found<Clicked & { "data-random"?: boolean }>(node, "button" as never).find((button) => button.props["data-random"]);

const allActions = { onApplyAll: () => {}, onRandomiseAll: () => {}, onRemoveAll: () => {}, onRandom: () => {} };
const joinPanel = (props: Partial<Parameters<typeof TransitionPanel>[0]> = {}) =>
  TransitionPanel({ transition: { after: "s0", kind: "fade", secs: 0.5 }, joined: true, kinds: false, any: true, onPick: () => {}, onChange: () => {}, onRemove: () => {}, ...allActions, ...props });

describe("the join inspector's actions on every join", () => {
  test("with a Transition picked: Apply to all, Randomise all and Remove from all, each calling its action", () => {
    const onApplyAll = vi.fn();
    const onRandomiseAll = vi.fn();
    const onRemoveAll = vi.fn();
    const shown = buttons(joinPanel({ onApplyAll, onRandomiseAll, onRemoveAll }));
    expect(shown.map((button) => button.label)).toEqual(["Remove transition", "Apply to all joins", "Randomise all joins", "Remove from all"]);
    for (const button of shown.slice(1)) button.onClick?.();
    expect([onApplyAll, onRandomiseAll, onRemoveAll].map((action) => action.mock.calls.length)).toEqual([1, 1, 1]);
  });

  test("Remove from all shows while any join has a Transition, the picked one or not", () => {
    expect(buttons(joinPanel({ transition: null })).map((button) => button.label)).toEqual(["Remove from all"]);
    expect(buttons(joinPanel({ transition: null, any: false }))).toEqual([]);
  });

  test("on a locked Video Track, the three are disabled", () => {
    expect(buttons(joinPanel({ locked: true })).map((button) => button.disabled ?? false)).toEqual([false, true, true, true]);
    expect(buttons(joinPanel()).map((button) => button.disabled ?? false)).toEqual([false, false, false, false]);
  });
});

describe("the Random card", () => {
  const tab = (props: Partial<Parameters<typeof TransitionPanel>[0]> = {}) => joinPanel({ transition: null, joined: false, kinds: true, cuts: true, ...props });

  test("applies a random kind on a click", () => {
    const onRandom = vi.fn();
    const card = randomCard(tab({ onRandom }));
    expect(text(card?.props.children)).toContain("Random");
    expect(card?.props.disabled).toBe(false);
    card?.props.onClick?.();
    expect(onRandom).toHaveBeenCalledOnce();
  });

  test("is disabled in a Clip with no cut, and on a locked Video Track", () => {
    expect(randomCard(tab({ cuts: false }))?.props.disabled).toBe(true);
    expect(randomCard(tab({ locked: true }))?.props.disabled).toBe(true);
  });
});
