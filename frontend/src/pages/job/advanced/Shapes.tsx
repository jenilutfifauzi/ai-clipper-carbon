import { ClipboardCopy, Copy, Trash2 } from "lucide-react";
import type { Animation, Shape, ShapeKind, ShapeStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { FRAME } from "../editor/picture";
import { shadowControls, type ShadowAccess } from "../editor/ShadowFields";
import { Group, Mixed } from "../editor/StyleFields";
import { shared } from "./actions";
import { cornersFormat } from "./DecorationFields";
import { DRAG_SHAPE } from "./drag";
import { drawsSomething, NEW_FILL, NOTHING_TO_DRAW, SHAPE_SIZE, SHAPE_STROKE_MAX } from "./shapeStyle";
import { ANIMATIONS, MotionFields } from "./TextLayers";
import { TimingFields } from "./TimingFields";
import { ShapeTransformFields } from "./TransformFields";

// The Stickers tab's tiles, each by its Shape Kind: what it is called, and its figure drawn on it.
const TILES: { kind: ShapeKind; name: string; figure: string }[] = [{ kind: "rectangle", name: "rectangle", figure: "aspect-square w-9" }];

/**
 * The Stickers tab (GLOSSARY.md): its one shelf, Shapes, with a tile per Shape Kind, each drawn as
 * the figure it adds (a rectangle as a square). A click adds it at the playhead; dragged onto the
 * Timeline or the preview, it is added where and when it is dropped.
 */
export function ShapeAssets({ onAdd }: { onAdd: (kind: ShapeKind) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Hint more="Or drag it onto the timeline or the video. On the video, drag it to place it; its corners scale it and the handle above turns it.">
        Click a shape to add it at the playhead.
      </Hint>
      <section className="flex flex-col gap-2" aria-label="Shapes">
        <h3 className="text-sm font-medium text-muted">Shapes</h3>
        <div className="grid grid-cols-3 gap-2">
          {TILES.map((tile) => (
            <button
              key={tile.kind}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_SHAPE, tile.kind);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(tile.kind)}
              aria-label={`Add a ${tile.name}`}
              title={tile.name}
              className="raised grid min-h-16 place-items-center rounded-[10px] p-2 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
            >
              <span aria-hidden className={`${tile.figure} rounded-[2px] bg-text`} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * The picked Shape's Shape Style (its size, fill, stroke, corners and drop shadow), Transform,
 * motion and time. It is never left with neither fill nor stroke: with no stroke its fill can't be
 * turned off (which it says), and with no fill its stroke is at least 1 px.
 */
export function ShapeFields({
  shape,
  duration,
  onChange,
  onDuplicate,
  onDelete,
}: {
  shape: Shape;
  duration: number;
  // `group` names the field being changed, so that its changes are undone as one.
  onChange: (shape: Shape, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const setStyle = <K extends keyof ShapeStyle>(field: K, value: ShapeStyle[K], group: string = field) => {
    const next = { ...shape.style, [field]: value };
    if (drawsSomething(next)) onChange({ ...shape, style: next }, `shape:${shape.id}:style.${group}`);
  };
  const { style } = shape;
  const filled = style.fill !== null;
  const shadow: ShadowAccess = {
    shadow: style.shadow,
    mixed: () => false,
    any: (test) => test(style.shadow),
    change: (change, field) => setStyle("shadow", change(style.shadow), field ? `shadow.${field}` : "shadow"),
  };
  // Whole pixels, up to the frame's side (or more, where it is already larger).
  const size = (value: number, frame: number) => ({ min: SHAPE_SIZE.min, max: Math.max(frame, value), format: (v: number) => `${Math.round(v)} px` });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Shape</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate shape">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete shape">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <Group title="Look">
        <Slider label="Width" value={style.width} {...size(style.width, FRAME.width)} onChange={(width) => setStyle("width", Math.round(width))} />
        <Slider label="Height" value={style.height} {...size(style.height, FRAME.height)} onChange={(height) => setStyle("height", Math.round(height))} />
        <Switch checked={filled} disabled={filled && !style.stroke_width} onChange={(on) => setStyle("fill", on ? NEW_FILL : null)}>
          <span className="text-sm font-medium">Fill</span>
        </Switch>
        {style.fill !== null && <ColorField label="Fill colour" value={style.fill} onChange={(fill) => setStyle("fill", fill)} />}
        {filled && !style.stroke_width && <Hint>{NOTHING_TO_DRAW}</Hint>}
        <Slider
          label="Stroke"
          value={style.stroke_width}
          min={filled ? 0 : 1}
          max={Math.max(SHAPE_STROKE_MAX, style.stroke_width)}
          format={(v) => (v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", Math.round(width))}
        />
        {style.stroke_width > 0 && <ColorField label="Stroke colour" value={style.stroke_colour} onChange={(colour) => setStyle("stroke_colour", colour)} />}
        <Slider label="Corners" value={style.radius} min={0} max={0.5} step={0.01} format={cornersFormat} onChange={(radius) => setStyle("radius", radius)} />
      </Group>
      <Group title="Shadow">{shadowControls(shadow, { inspector: true })}</Group>
      <ShapeTransformFields shape={shape} onChange={onChange} />
      <MotionFields item={shape} kind="shape" onChange={onChange} />
      <TimingFields item={shape} duration={duration} labels={{ start: "Comes on at", secs: "Stays for" }} onChange={onChange} />
    </div>
  );
}

// How the several-Shapes fields read each of their values off a Shape.
const READ = {
  width: (shape: Shape) => shape.style.width,
  height: (shape: Shape) => shape.style.height,
  fill: (shape: Shape) => shape.style.fill,
  stroke_width: (shape: Shape) => shape.style.stroke_width,
  stroke_colour: (shape: Shape) => shape.style.stroke_colour,
  radius: (shape: Shape) => shape.style.radius,
  animation_in: (shape: Shape) => shape.animation_in,
  animation_out: (shape: Shape) => shape.animation_out,
  animation_ms: (shape: Shape) => shape.animation_ms,
};
type Field = keyof typeof READ;

/**
 * Several picked Shapes' Shape Style and motion, set on every one of them at once, as TextLayersFields sets
 * several Text Layers'. A field they differ in shows the first one's value, marked Mixed, until it is
 * set. Their places and times stay their own.
 */
export function ShapesFields({
  shapes,
  onChange,
  onDuplicate,
  onCopy,
  onDelete,
}: {
  shapes: Shape[];
  // `change` made to them all; `group` names the field, so that its changes are undone as one.
  onChange: (change: (shape: Shape) => Shape, group: string) => void;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const read = (field: Field) => READ[field] as (shape: Shape) => unknown;
  const value = <F extends Field>(field: F) => (shared(shapes, read(field)) ?? read(field)(shapes[0])) as ReturnType<(typeof READ)[F]>;
  const mixed = (field: Field) => shared(shapes, read(field)) === undefined;
  const marker = (field: Field) => (mixed(field) ? <Mixed /> : undefined);
  const set = <K extends keyof Shape>(field: K, next: Shape[K]) => onChange((shape) => ({ ...shape, [field]: next }), `shapes:${field}`);
  // `change` made to each one's style, but where it would leave one with nothing to draw.
  const restyle = (change: (style: ShapeStyle) => ShapeStyle, group: string) =>
    onChange((shape) => {
      const style = change(shape.style);
      return drawsSomething(style) ? { ...shape, style } : shape;
    }, `shapes:style.${group}`);
  const setStyle = <K extends keyof ShapeStyle>(field: K, next: ShapeStyle[K]) => restyle((style) => ({ ...style, [field]: next }), field);
  const filled = value("fill") !== null;
  // Turning the fill off would leave one with nothing to draw.
  const fillStays = shapes.some((shape) => shape.style.fill !== null && !shape.style.stroke_width);
  const outline = shapes.some((shape) => shape.style.fill === null);
  const shadow: ShadowAccess = {
    shadow: shapes[0].style.shadow,
    mixed: (read) => shared(shapes, (shape) => read(shape.style.shadow)) === undefined,
    any: (test) => shapes.some((shape) => test(shape.style.shadow)),
    change: (change, field) => restyle((style) => ({ ...style, shadow: change(style.shadow) }), field ? `shadow.${field}` : "shadow"),
  };
  // Whole pixels, as ShapeFields' (or Mixed).
  const size = (field: "width" | "height", frame: number) => ({
    min: SHAPE_SIZE.min,
    max: Math.max(frame, ...shapes.map(read(field) as (shape: Shape) => number)),
    format: (v: number) => (mixed(field) ? "Mixed" : `${Math.round(v)} px`),
  });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Editing {shapes.length} shapes</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate them">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onCopy} aria-label="Copy them">
            <ClipboardCopy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete them">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <Hint more="Their places and times stay each one's own: change those one at a time.">A change here applies to every picked shape.</Hint>
      <Group title="Look">
        <Slider label="Width" value={value("width")} {...size("width", FRAME.width)} onChange={(width) => setStyle("width", Math.round(width))} />
        <Slider label="Height" value={value("height")} {...size("height", FRAME.height)} onChange={(height) => setStyle("height", Math.round(height))} />
        <Switch
          checked={filled}
          disabled={filled && fillStays}
          onChange={(on) => restyle((style) => ({ ...style, fill: on ? (style.fill ?? NEW_FILL) : null }), "fill")}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">Fill {marker("fill")}</span>
        </Switch>
        {shapes.some((shape) => shape.style.fill !== null) && (
          <ColorField
            label="Fill colour"
            value={shapes.find((shape) => shape.style.fill !== null)?.style.fill ?? NEW_FILL}
            onChange={(fill) => restyle((style) => (style.fill === null ? style : { ...style, fill }), "fill")}
            marker={marker("fill")}
          />
        )}
        {filled && fillStays && <Hint>{NOTHING_TO_DRAW}</Hint>}
        <Slider
          label="Stroke"
          value={value("stroke_width")}
          min={outline ? 1 : 0}
          max={Math.max(SHAPE_STROKE_MAX, ...shapes.map((shape) => shape.style.stroke_width))}
          format={(v) => (mixed("stroke_width") ? "Mixed" : v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", Math.round(width))}
        />
        {shapes.some((shape) => shape.style.stroke_width > 0) && (
          <ColorField label="Stroke colour" value={value("stroke_colour")} onChange={(colour) => setStyle("stroke_colour", colour)} marker={marker("stroke_colour")} />
        )}
        <Slider
          label="Corners"
          value={value("radius")}
          min={0}
          max={0.5}
          step={0.01}
          format={(v) => (mixed("radius") ? "Mixed" : cornersFormat(v))}
          onChange={(radius) => setStyle("radius", radius)}
        />
      </Group>
      <Group title="Shadow">{shadowControls(shadow, { inspector: true })}</Group>
      <Group title="Motion">
        <div className="grid grid-cols-2 gap-3">
          <Select
            label="Comes on"
            value={value("animation_in")}
            options={ANIMATIONS}
            onChange={(next: Animation) => set("animation_in", next)}
            marker={marker("animation_in")}
          />
          <Select
            label="Goes off"
            value={value("animation_out")}
            options={ANIMATIONS}
            onChange={(next: Animation) => set("animation_out", next)}
            marker={marker("animation_out")}
          />
        </div>
        {shapes.some((shape) => shape.animation_in !== "none" || shape.animation_out !== "none") && (
          <Slider
            label="Animation length"
            value={value("animation_ms")}
            min={100}
            max={2000}
            step={50}
            format={(v) => (mixed("animation_ms") ? "Mixed" : `${(v / 1000).toFixed(2)} s`)}
            onChange={(ms) => set("animation_ms", ms)}
          />
        )}
      </Group>
    </div>
  );
}
