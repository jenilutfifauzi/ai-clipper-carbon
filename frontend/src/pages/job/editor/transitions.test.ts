// .scratch/transitions-expanded/issues/01: the preview's catalogue of Transition kinds, each with
// its label, group and look.
import { describe, expect, test } from "vitest";
import { showLook, TRANSITION_KINDS, TRANSITIONS } from "./transitions";

// A layer as the preview styles it.
const layer = () => ({ style: {} as CSSStyleDeclaration });

describe("the Transition catalogue", () => {
  test("lists every kind in the Transitions tab's order, xfade's slides named Push", () => {
    expect(TRANSITION_KINDS.map((kind) => [TRANSITIONS[kind].label, TRANSITIONS[kind].group])).toEqual([
      ["Fade", "Basic"],
      ["Dip to black", "Basic"],
      ["Dip to white", "Basic"],
      ["Push left", "Slide"],
      ["Push right", "Slide"],
      ["Push up", "Slide"],
      ["Push down", "Slide"],
      ["Wipe", "Wipe"],
      ["Zoom in", "Zoom"],
      ["Circle open", "Shape"],
    ]);
  });

  test("a look shown on a layer replaces what the last one set there", () => {
    const outgoing = layer();
    const veil = layer();
    showLook(TRANSITIONS.slideleft.look(0.5).outgoing, outgoing);
    expect(outgoing.style.transform).toBe("translateX(-50%)");
    showLook(TRANSITIONS.fade.look(0.25).outgoing, outgoing);
    expect(outgoing.style).toMatchObject({ transform: "", opacity: "0.75" });

    showLook(TRANSITIONS.fadeblack.look(0.25).veil, veil);
    expect(veil.style).toMatchObject({ background: "#000", opacity: "0.5" });
    showLook(TRANSITIONS.fade.look(0.25).veil, veil);
    expect(veil.style).toMatchObject({ background: "", opacity: "" });
  });
});
