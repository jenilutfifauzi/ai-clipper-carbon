// .scratch/transitions-expanded/issues/02: the Transitions tab's kinds by group, under sticky headings.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TransitionPanel } from "./Transitions";

describe("the Transitions tab", () => {
  test("lists the groups that have kinds as sections with sticky headings, in the spec's order", () => {
    const html = renderToStaticMarkup(<TransitionPanel transition={null} joined onPick={() => {}} onChange={() => {}} onRemove={() => {}} />);
    const headings = [...html.matchAll(/<h3 [^>]*class="([^"]*)"[^>]*>([^<]*)<\/h3>/g)].map(([, classes, text]) => ({ text, sticky: classes.split(" ").includes("sticky") }));
    expect(headings).toEqual(["Basic", "Slide", "Wipe", "Shape", "Zoom", "Glitch"].map((text) => ({ text, sticky: true })));
    // Each section's kinds follow its heading: the Slide group's Pushes then its Covers.
    const slide = html.slice(html.indexOf(">Slide</h3>"), html.indexOf(">Wipe</h3>"));
    expect([...slide.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(([, label]) => label)).toEqual([
      "Push left", "Push right", "Push up", "Push down", "Cover left", "Cover right", "Cover up", "Cover down",
    ]);
  });
});
