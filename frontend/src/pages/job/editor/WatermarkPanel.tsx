import { useId } from "react";
import type { FontInfo, StyleValue, WatermarkKind, WatermarkPosition } from "../../../api";
import { AnchorGrid } from "../../../components/AnchorGrid";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Segmented } from "../../../components/Segmented";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { LogoPicker } from "./LogoPicker";
import { FacePicker } from "./FacePicker";
import { StyleMarker } from "./StyleFields";
import type { StyleControls } from "./useStyleDraft";

const KINDS: readonly { value: WatermarkKind; label: string }[] = [
  { value: "none", label: "Off" },
  { value: "text", label: "Text" },
  { value: "logo", label: "Logo" },
];

// In rows, from the top-left corner, as AnchorGrid lays them out.
const ANCHORS: readonly { value: Exclude<WatermarkPosition, "custom">; label: string }[] = [
  { value: "top_left", label: "Top left" },
  { value: "top", label: "Top" },
  { value: "top_right", label: "Top right" },
  { value: "left", label: "Left" },
  { value: "middle", label: "Middle" },
  { value: "right", label: "Right" },
  { value: "bottom_left", label: "Bottom left" },
  { value: "bottom", label: "Bottom" },
  { value: "bottom_right", label: "Bottom right" },
];

/**
 * The Watermark: off, a line of text or one of the Logos, then where it sits (one of nine places,
 * or anywhere it is dragged on the preview), how large and how opaque it is.
 */
export function WatermarkPanel({ style, fonts }: { style: StyleControls; fonts: FontInfo[] | null }) {
  const id = useId();
  const watermark = style.watermark;
  const set = (field: string, value: StyleValue) => style.set("watermark", field, value);
  const marker = (field: string, label: string) => <StyleMarker style={style} part="watermark" field={field} label={label} />;
  const custom = watermark.position === "custom";

  return (
    <div className="flex flex-col gap-6">
      <Segmented legend="Watermark" options={KINDS} value={watermark.kind} onChange={(v) => set("kind", v)} marker={marker("kind", "watermark")} className="max-w-xs" />

      {watermark.kind === "none" && (
        <p className="text-sm text-muted">Mark every clip with your name or logo: pick Text or Logo, then save it into a preset.</p>
      )}

      {watermark.kind === "text" && (
        <section aria-labelledby={`${id}-what`} className="flex flex-col gap-3">
          <h4 id={`${id}-what`} className="font-semibold">
            Text
          </h4>
          <div className="flex min-w-0 flex-col gap-1">
            <label htmlFor={`${id}-text`} className="flex items-center gap-1.5 text-sm font-medium">
              Words {marker("text", "watermark text")}
            </label>
            <input
              id={`${id}-text`}
              value={watermark.text}
              maxLength={60}
              placeholder="@yourchannel"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => set("text", event.target.value)}
              className="min-h-10 rounded-[10px] border border-border bg-fill px-3 text-base"
            />
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
            <FacePicker
              value={watermark.font}
              fonts={fonts}
              onChange={(v) => set("font", v)}
              marker={marker("font", "watermark font")}
              className="sm:col-span-2"
            />
            <ColorField label="Colour" value={watermark.colour} onChange={(v) => set("colour", v)} marker={marker("colour", "watermark colour")} />
          </div>
          <Switch checked={watermark.outline} onChange={(v) => set("outline", v)}>
            <span className="flex items-center gap-1.5 text-sm">
              Thin outline, to read on any shot {marker("outline", "watermark outline")}
            </span>
          </Switch>
        </section>
      )}

      {watermark.kind === "logo" && (
        <LogoPicker value={watermark.logo} onChange={(v) => set("logo", v)} marker={marker("logo", "logo")} />
      )}

      {watermark.kind !== "none" && (
        <section aria-labelledby={`${id}-where`} className="flex flex-col gap-3">
          <h4 id={`${id}-where`} className="font-semibold">
            Where and how large
          </h4>
          <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
            <AnchorGrid
              legend="Place"
              options={ANCHORS}
              value={custom ? null : (watermark.position as Exclude<WatermarkPosition, "custom">)}
              onChange={(v) => set("position", v)}
              marker={marker("position", "watermark place")}
            />
            <div className="flex min-w-48 flex-1 flex-col gap-3">
              <p className="text-sm text-muted">
                {custom ? "Placed where you dragged it on the preview." : "Or drag it on the preview to place it anywhere; the arrow keys nudge it."}
              </p>
              {custom && (
                <Button size="xs" variant="ghost" className="self-start" onClick={() => set("position", "top_right")}>
                  Snap back to a corner
                </Button>
              )}
              <Slider
                label="Size"
                value={watermark.size}
                min={24}
                max={480}
                format={(v) => `${v} px`}
                onChange={(v) => set("size", v)}
                marker={marker("size", "watermark size")}
              />
              <Slider
                label="Opacity"
                value={watermark.opacity}
                min={0.05}
                max={1}
                step={0.05}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(v) => set("opacity", v)}
                marker={marker("opacity", "watermark opacity")}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
