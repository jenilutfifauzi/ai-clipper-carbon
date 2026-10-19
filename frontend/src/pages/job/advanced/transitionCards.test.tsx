// .scratch/transitions-expanded/issues/03: the Transitions tab's cards, and the join a click on one goes to.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TRANSITION_KINDS } from "../editor/transitions";
import { cardTarget } from "./actions";
import { TransitionPanel } from "./Transitions";

// Three Segments played back to back: joins at 4 s (after "a") and 9 s (after "b").
const segments = [{ id: "a" }, { id: "b" }, { id: "c" }];
const played = [
  { start: 0, end: 4 },
  { start: 4, end: 9 },
  { start: 9, end: 12 },
];

describe("the join a card's click goes to", () => {
  test("is the picked join, wherever the playhead is", () => {
    expect(cardTarget({ kind: "join", after: "b" }, segments, played, 0.5)).toBe("b");
  });

  test("with no join picked, is the join nearest the playhead", () => {
    expect(cardTarget(null, segments, played, 1)).toBe("a");
    expect(cardTarget(null, segments, played, 7)).toBe("b");
    expect(cardTarget({ kind: "items", items: [{ kind: "segment", id: "a" }] }, segments, played, 11.5)).toBe("b");
    // Halfway between two, the earlier.
    expect(cardTarget({ kind: "hook" }, segments, played, 6.5)).toBe("a");
  });

  test("is none in a Clip of one Segment", () => {
    expect(cardTarget(null, [{ id: "a" }], [{ end: 4 }], 2)).toBeNull();
  });
});

// The tab as drawn.
const tab = (props: Partial<Parameters<typeof TransitionPanel>[0]> = {}) =>
  renderToStaticMarkup(<TransitionPanel transition={null} joined={false} cuts onPick={() => {}} onChange={() => {}} onRemove={() => {}} {...props} />);
const cards = (html: string) => [...html.matchAll(/<button [^>]*data-kind="([^"]*)"[^>]*>/g)].map(([tag, kind]) => ({ kind, tag }));
// The style of the `layer` of `kind`'s card.
function layerStyle(html: string, kind: string, layer: "outgoing" | "incoming" | "veil") {
  const card = html.slice(html.indexOf(`data-kind="${kind}"`));
  const tag = card.match(new RegExp(`<div [^>]*data-layer="${layer}"[^>]*>`))?.[0] ?? "";
  return tag.match(/style="([^"]*)"/)?.[1] ?? "";
}

describe("the Transitions tab's cards", () => {
  test("every kind has a card of two sample pictures drawn in CSS, with no image", () => {
    const html = tab();
    expect(cards(html).map(({ kind }) => kind).sort()).toEqual([...TRANSITION_KINDS].sort());
    expect(html).not.toMatch(/<img|\.png|\.jpe?g|\.webp/);
    // Pixelize's filters drawn once beside them.
    expect(html.match(/id="transition-pixelize-0"/g)).toHaveLength(1);
  });

  test("a card rests part-way through its kind, as its look draws it", () => {
    const html = tab();
    // Fade halfway: the outgoing picture half through.
    expect(layerStyle(html, "fade", "outgoing")).toContain("opacity:0.5");
    // Push left halfway: both pictures moved.
    expect(layerStyle(html, "slideleft", "outgoing")).toContain("translateX(-50%)");
    expect(layerStyle(html, "slideleft", "incoming")).toContain("translateX(50%)");
    // A dip rests before its middle, where it would be all colour.
    expect(layerStyle(html, "fadeblack", "outgoing")).toContain("opacity:1");
    expect(layerStyle(html, "fadeblack", "veil")).toMatch(/opacity:0\.[1-9]/);
  });

  test("marks the picked join's kind", () => {
    const html = tab({ joined: true, transition: { after: "s0", kind: "radial", secs: 0.5 } });
    const pressed = cards(html).filter(({ tag }) => tag.includes('aria-pressed="true"'));
    expect(pressed.map(({ kind }) => kind)).toEqual(["radial"]);
  });

  test("in a Clip of one Segment, the cards are disabled with a hint that a Transition needs a cut", () => {
    const html = tab({ cuts: false });
    expect(cards(html).every(({ tag }) => / disabled=""/.test(tag))).toBe(true);
    expect(html).toContain("needs a cut");
    expect(cards(tab()).some(({ tag }) => / disabled=""/.test(tag))).toBe(false);
  });
});
