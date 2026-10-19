// .scratch/transitions-expanded/issues/10-overlay-animations.md: an Overlay's inspector has the Text
// Layer's Motion fields, an Overlay stored without them reading as none.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { Animation, Overlay } from "../../../api";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { IDENTITY } from "../editor/picture";
import { MotionFields } from "./TextLayers";

// A still from 1 s for 2 s, stored before Overlays had animations.
const still = (changes: Partial<Overlay> = {}): Overlay => ({
  id: "o1",
  media: "m1",
  start: 1,
  secs: 2,
  offset: 0,
  transform: IDENTITY,
  crop: { left: 0, top: 0, right: 0, bottom: 0 },
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
  ...changes,
});

// The first element of `node`'s tree (its own elements, not those its components render) of `type` labelled `label`.
function found(node: ReactNode, type: unknown, label: string): ReactElement<{ value: unknown; onChange: (value: never) => void }> | null {
  if (!isValidElement(node)) return Array.isArray(node) ? (node.map((each) => found(each, type, label)).find(Boolean) ?? null) : null;
  const props = node.props as { label?: string; children?: ReactNode };
  if (node.type === type && props.label === label) return node as ReactElement<{ value: unknown; onChange: (value: never) => void }>;
  return found(props.children, type, label);
}

describe("an Overlay's Motion fields", () => {
  test("read an Overlay stored without animations as none, its length shown once it animates", () => {
    const fields = MotionFields({ item: still(), kind: "overlay", onChange: () => {} });
    expect([found(fields, Select, "Comes on")!.props.value, found(fields, Select, "Goes off")!.props.value]).toEqual(["none", "none"]);
    expect(renderToStaticMarkup(fields)).not.toContain("Animation length");
    expect(renderToStaticMarkup(MotionFields({ item: still({ animation_in: "pop", animation_ms: 500 }), kind: "overlay", onChange: () => {} }))).toContain(
      "0.50 s",
    );
  });

  test("each change is stored on the Overlay as a step of its own field", () => {
    const changed: [Overlay, string][] = [];
    const fields = MotionFields({ item: still(), kind: "overlay", onChange: (overlay, group) => changed.push([overlay, group]) });
    found(fields, Select, "Comes on")!.props.onChange("fade" satisfies Animation as never);
    found(fields, Select, "Goes off")!.props.onChange("slide" satisfies Animation as never);
    expect(changed).toEqual([
      [still({ animation_in: "fade" }), "overlay:o1:animation_in"],
      [still({ animation_out: "slide" }), "overlay:o1:animation_out"],
    ]);
    const animated = MotionFields({ item: still({ animation_in: "fade" }), kind: "overlay", onChange: (overlay, group) => changed.push([overlay, group]) });
    found(animated, Slider, "Animation length")!.props.onChange(800 as never);
    expect(changed[2]).toEqual([still({ animation_in: "fade", animation_ms: 800 }), "overlay:o1:animation_ms"]);
  });
});
