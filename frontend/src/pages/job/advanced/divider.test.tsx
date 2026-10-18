// .scratch/workspace-layout/issues/05-divider-keyboard.md: each Divider is a keyboard-reachable
// `separator` that resizes with the arrows, matching the drag semantics (right/down positive). These
// test the pure key→step helper for every branch and both orientations, and the rendered ARIA — no
// jsdom in this repo, so the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Divider, dividerKeyStep } from "./Divider";

describe("dividerKeyStep", () => {
  test("vertical: ArrowRight grows, ArrowLeft shrinks (right positive)", () => {
    expect(dividerKeyStep("ArrowRight", false, "vertical")).toEqual({ deltaPx: 16 });
    expect(dividerKeyStep("ArrowLeft", false, "vertical")).toEqual({ deltaPx: -16 });
  });

  test("vertical: the vertical-axis arrows do nothing", () => {
    expect(dividerKeyStep("ArrowUp", false, "vertical")).toBeNull();
    expect(dividerKeyStep("ArrowDown", false, "vertical")).toBeNull();
  });

  test("horizontal: ArrowDown grows, ArrowUp shrinks (down positive)", () => {
    expect(dividerKeyStep("ArrowDown", false, "horizontal")).toEqual({ deltaPx: 16 });
    expect(dividerKeyStep("ArrowUp", false, "horizontal")).toEqual({ deltaPx: -16 });
  });

  test("horizontal: the horizontal-axis arrows do nothing", () => {
    expect(dividerKeyStep("ArrowLeft", false, "horizontal")).toBeNull();
    expect(dividerKeyStep("ArrowRight", false, "horizontal")).toBeNull();
  });

  test("Shift takes the larger 64px step, keeping the sign, in both orientations", () => {
    expect(dividerKeyStep("ArrowRight", true, "vertical")).toEqual({ deltaPx: 64 });
    expect(dividerKeyStep("ArrowLeft", true, "vertical")).toEqual({ deltaPx: -64 });
    expect(dividerKeyStep("ArrowDown", true, "horizontal")).toEqual({ deltaPx: 64 });
    expect(dividerKeyStep("ArrowUp", true, "horizontal")).toEqual({ deltaPx: -64 });
  });

  test("Enter resets in either orientation, with or without Shift", () => {
    expect(dividerKeyStep("Enter", false, "vertical")).toBe("reset");
    expect(dividerKeyStep("Enter", true, "horizontal")).toBe("reset");
  });

  test("anything else is null (the event is left to the browser)", () => {
    expect(dividerKeyStep("Tab", false, "vertical")).toBeNull();
    expect(dividerKeyStep("Escape", false, "horizontal")).toBeNull();
    expect(dividerKeyStep(" ", false, "vertical")).toBeNull();
    expect(dividerKeyStep("a", false, "horizontal")).toBeNull();
  });
});

const noop = () => {};

const render = (orientation: "vertical" | "horizontal", value: number, min: number, max: number) =>
  renderToStaticMarkup(
    <Divider
      orientation={orientation}
      label="Resize the Asset Panel"
      value={value}
      min={min}
      max={max}
      onStart={noop}
      onDrag={noop}
      onReset={noop}
    />,
  );

describe("Divider ARIA", () => {
  test("is a named, focusable separator with the right orientation and value bounds", () => {
    const html = render("vertical", 17.4, 14, 28);
    expect(html).toContain('role="separator"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Resize the Asset Panel"');
    expect(html).toContain('aria-orientation="vertical"');
    // The value and bounds are rounded for AT.
    expect(html).toContain('aria-valuenow="17"');
    expect(html).toContain('aria-valuemin="14"');
    expect(html).toContain('aria-valuemax="28"');
  });

  test("a horizontal Divider reports aria-orientation horizontal", () => {
    expect(render("horizontal", 40, 22, 70)).toContain('aria-orientation="horizontal"');
  });

  test("it is not role=presentation (the old, unreachable role)", () => {
    expect(render("vertical", 17, 14, 28)).not.toContain('role="presentation"');
  });
});
