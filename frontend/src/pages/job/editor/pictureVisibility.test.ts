// A Media Library video's Segment was drawn over the whole Timeline: its PicturePanel set
// `visibility: visible`, which undid the `hidden` its MediaSegment's box sets outside its span.
import { describe, expect, test } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Picture } from "../../../api";
import { PicturePanel } from "./PicturePanel";

const picture = {
  centre: [540, 960], width: 1080, height: 1920, rotation: 0, flip_h: false, flip_v: false, opacity: 1, motion: {},
  crop: { x: 0, y: 0, width: 1080, height: 1920 }, item_size: [1080, 1920], radius: 0, border: null, shadow: null,
} as unknown as Picture;
const drawn = (hidden?: boolean) =>
  renderToStaticMarkup(createElement(PicturePanel, { picture, frame: { width: 1080, height: 1920 }, media: null, hidden }));

describe("a picture's visibility", () => {
  test("is its box's when it isn't hidden, so that a Segment hidden outside its span hides its picture", () => {
    expect(drawn()).not.toContain("visibility");
  });

  test("is hidden when it is (an Overlay outside its time, not picked)", () => {
    expect(drawn(true)).toMatch(/^<div[^>]*style="[^"]*visibility:hidden/);
  });
});
