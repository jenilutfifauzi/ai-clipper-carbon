// .scratch/text-advanced/issues/07: the Face picker, with its weights and italic, is every style's font
// field: the Text Layer's (one or several), and the captions', hook's and Watermark's.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { CaptionStyle, FontInfo, HookStyle, TextLayer, WatermarkStyle } from "../../../api";
import { TextLayerFields, TextLayersFields } from "../advanced/TextLayers";
import { textStyle } from "../advanced/textStyle";
import { CaptionStylePanel } from "./CaptionStylePanel";
import { FacePicker } from "./FacePicker";
import { HookLook } from "./HookStylePanel";
import { IDENTITY } from "./picture";
import type { StyleControls } from "./useStyleDraft";
import { WatermarkPanel } from "./WatermarkPanel";

const face = (id: string, family: string, weight = 400, italic = false, extra: Partial<FontInfo> = {}): FontInfo => ({
  id,
  label: id,
  family: id,
  typographic_family: family,
  weight,
  italic,
  bundled: true,
  copyright: "",
  licence: "",
  licence_url: "",
  restricted: false,
  url: `/api/fonts/${id}?v=1`,
  units: 1000,
  em: 1000,
  ascent: 800,
  cap_height: 700,
  descent: 200,
  ...extra,
});

const FONTS = [
  face("anton", "Anton"),
  face("passion-one-regular", "Passion One", 400),
  face("passion-one-bold", "Passion One", 700),
  face("passion-one-black", "Passion One", 900),
  face("kanit-black", "Kanit", 900),
  face("kanit-black-italic", "Kanit", 900, true),
  face("brand-regular", "Brand Sans", 400, false, {
    bundled: false,
    copyright: "Copyright 2026 Brand",
    licence: "Brand's own licence",
    restricted: true,
  }),
];

const markup = (element: ReactElement) => renderToStaticMarkup(element);
// The labels of the options of the <select> labelled `label`, read off the markup (there is no DOM).
function selectOptions(html: string, label: string): string[] {
  const id = html.match(new RegExp(`<label for="([^"]+)"[^>]*>${label}<`))?.[1];
  const select = id && html.match(new RegExp(`<select id="${id}"[^>]*>(.*?)</select>`))?.[1];
  return select ? [...select.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((option) => option[1]) : [];
}

// The families the list offers, by their names.
const listed = (html: string) => [...html.matchAll(/role="option"[^>]*>.*?<span[^>]*style[^>]*>(.*?)<\/span>/g)].map((option) => option[1]);
const italicButton = (html: string) => html.match(/<button[^>]*aria-label="Italic"[^>]*>/)?.[0];

describe("the Face picker", () => {
  test("shows the Face's family, offers exactly the family's weights, and lists each family once", () => {
    const html = markup(<FacePicker value="passion-one-bold" fonts={FONTS} onChange={() => {}} />);
    expect(html).toContain(">Passion One<svg");
    expect(selectOptions(html, "Weight")).toEqual(["Regular", "Bold", "Black"]);
    // Imported first, then the bundled by name; no italic in Passion One.
    expect(listed(html)).toEqual(["Brand Sans", "Anton", "Kanit", "Passion One"]);
    expect(italicButton(html)).toBeUndefined();
    expect(html).toContain("Import font");
  });

  test("offers italic where the weight has it, pressed for an italic Face", () => {
    const italic = italicButton(markup(<FacePicker value="kanit-black-italic" fonts={FONTS} onChange={() => {}} />));
    expect(italic).toContain('aria-pressed="true"');
    expect(italic).not.toContain('disabled=""');
  });

  test("marks an imported family, with its licence, and warns when it may not be embedded", () => {
    const html = markup(<FacePicker value="brand-regular" fonts={FONTS} onChange={() => {}} />);
    expect(html).toContain("Imported font");
    expect(html).toContain("Copyright 2026 Brand");
    expect(html).toContain("Brand&#x27;s own licence");
    expect(html).toContain("may not be embedded");
    expect(markup(<FacePicker value="anton" fonts={FONTS} onChange={() => {}} />)).not.toContain("Imported font");
  });
});

describe("every style's font field is the Face picker", () => {
  const controls = {
    caption: {
      font: "passion-one-black",
      size: 110,
      colour: "#FFFFFF",
      active_colour: "#FF9F0A",
      outline: 7,
      outline_colour: "#000000",
      shadow: { colour: "#000000", opacity: 0.6, blur: 0, distance: 0, angle: 45 },
      tracking: 0,
      highlight: "colour",
      padding_x: null,
      padding_y: null,
      radius: null,
      position: "auto",
      y: 1396,
      x: null,
      uppercase: true,
      max_chars: 16,
      max_words: null,
      max_secs: 1.4,
      pause_secs: 0.5,
    } as CaptionStyle,
    hook: { font: "passion-one-regular", shape: "block", size: 88, colour: "#FFFFFF", emphasis_colour: "#FFE600", box_colour: "#000000" } as HookStyle,
    watermark: { kind: "text", font: "passion-one-bold", text: "@me", colour: "#FFFFFF", position: "top_right", outline: true } as WatermarkStyle,
    overrides: { caption: {}, hook: {}, watermark: {} },
    set: () => {},
  } as unknown as StyleControls;
  const layer: TextLayer = {
    id: "t1",
    text: "HALO",
    start: 0,
    secs: 2,
    transform: IDENTITY,
    keyframes: [],
    style: textStyle({ font: "passion-one-bold" }),
    animation_in: "none",
    animation_out: "none",
    animation_ms: 300,
  } as unknown as TextLayer;

  test.each([
    ["a Text Layer's", <TextLayerFields layer={layer} duration={10} fonts={FONTS} onChange={() => {}} onApplyTextStyle={() => {}} onDuplicate={() => {}} onDelete={() => {}} />],
    [
      "several Text Layers'",
      <TextLayersFields layers={[layer, layer]} fonts={FONTS} onChange={() => {}} onApplyTextStyle={() => {}} onDuplicate={() => {}} onCopy={() => {}} onDelete={() => {}} />,
    ],
    ["the captions'", <CaptionStylePanel style={controls} fonts={FONTS} more={false} onMore={() => {}} />],
    ["the hook's", <HookLook style={controls} fonts={FONTS} />],
    ["the Watermark's", <WatermarkPanel style={controls} fonts={FONTS} />],
  ])("%s", (_, element) => {
    const html = markup(element);
    expect(html).toContain('placeholder="Search fonts"');
    expect(selectOptions(html, "Weight")).toEqual(["Regular", "Bold", "Black"]);
  });
});
