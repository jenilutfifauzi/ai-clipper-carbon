// .scratch/text-advanced/issues/03-wrap-width-and-fixed-height.md: the inspector's Box section sets a
// Text Layer's wrap width and fixed height, each Auto at 0 with a way back to it.
import { isValidElement, type ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { BoxField } from "./TextLayers";

type SliderElement = ReactElement<Parameters<typeof Slider>[0]>;

function field(value: number, set: number[]): SliderElement {
  const element = BoxField({ label: "Wrap width", value, most: 1080, onChange: (next) => set.push(next) });
  if (!isValidElement(element) || element.type !== Slider) throw new Error("not a Slider");
  return element as SliderElement;
}

describe("the inspector's Box section", () => {
  test("reads Auto at 0, with nothing to go back to", () => {
    const auto = field(0, []);
    expect(auto.props.format!(0)).toBe("Auto");
    expect(auto.props.after).toBeFalsy();
  });

  test("sets a width in pixels, and Auto puts it back to 0", () => {
    const set: number[] = [];
    const wide = field(400, set);
    expect(wide.props.format!(400)).toBe("400 px");
    wide.props.onChange(520);
    const back = wide.props.after as ReactElement<{ onClick: () => void }>;
    expect(back.type).toBe(Button);
    back.props.onClick();
    expect(set).toEqual([520, 0]);
    // One set wider than the frame (by the agent) still shows on its slider.
    expect(field(2000, []).props.max).toBe(2000);
  });
});
