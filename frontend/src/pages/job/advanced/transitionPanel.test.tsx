// .scratch/transitions-expanded/issues/06: the join inspector chooses how a Transition's sound
// crosses, each choice one step of undo.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, test, vi } from "vitest";
import type { Transition } from "../../../api";
import { Segmented } from "../../../components/Segmented";
import { TransitionPanel } from "./Transitions";

type Choice = { legend: string; options: readonly { value: string; label: string }[]; value: string; onChange: (value: string) => void };

// The segmented controls in the element tree `node`, without rendering the components in it.
function segmented(node: ReactNode): ReactElement<Choice>[] {
  if (Array.isArray(node)) return node.flatMap(segmented);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  const inside = segmented(node.props.children);
  return node.type === Segmented ? [node as ReactElement<Choice>, ...inside] : inside;
}

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
