import { ClipboardCopy, Copy, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { Shape, ShapeKind, ShapeStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { allStroke, FRAME, SHAPE_SIZE_RANGE } from "../editor/picture";
import { shadowControls, type ShadowAccess } from "../editor/ShadowFields";
import { Group, Mixed } from "../editor/StyleFields";
import { shared } from "./actions";
import { cornersFormat } from "./DecorationFields";
import { DRAG_SHAPE } from "./drag";
import { drawsSomething, NEW_FILL, NOTHING_TO_DRAW, SHAPE_KINDS, SHAPE_STROKE_MAX, withKind } from "./shapeStyle";
import { MotionFields, SeveralMotionFields } from "./TextLayers";
import { TimingFields } from "./TimingFields";
import { ShapeTransformFields } from "./TransformFields";

// Each Shape Kind's tile on the Stickers tab: what it is called, and its figure drawn on it, in a
// 36 px square (a rectangle as a square, an ellipse as a circle).
const TILES: Record<ShapeKind, { name: string; figure: ReactNode }> = {
  rectangle: { name: "a rectangle", figure: <rect x="5" y="5" width="26" height="26" rx="2" /> },
  ellipse: { name: "an ellipse", figure: <circle cx="18" cy="18" r="14" /> },
  triangle: { name: "a triangle", figure: <polygon points="18,5 33,31 3,31" /> },
  parallelogram: { name: "a parallelogram", figure: <polygon points="10,8 34,8 26,28 2,28" /> },
  trapezoid: { name: "a trapezoid", figure: <polygon points="10,8 26,8 34,28 2,28" /> },
  line: { name: "a line", figure: <rect x="2" y="16" width="32" height="4" rx="2" /> },
  arrow: { name: "an arrow", figure: <path d="M4 16h20v-6l10 8-10 8v-6H4a2 2 0 0 1 0-4z" /> },
};

// The inspector's kind field's choices.
const KIND_OPTIONS = SHAPE_KINDS.map((kind) => ({ value: kind, label: kind[0].toUpperCase() + kind.slice(1) }));

/**
 * The Stickers tab (GLOSSARY.md): its one shelf, Shapes, with a tile per Shape Kind, each drawn as
 * the figure it adds (a rectangle as a square, an ellipse as a circle). A click adds it at the
 * playhead; dragged onto the Timeline or the preview, it is added where and when it is dropped.
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
          {SHAPE_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_SHAPE, kind);
                event.dataTransfer.effectAllowed = "copy";
              }}
              onClick={() => onAdd(kind)}
              aria-label={`Add ${TILES[kind].name}`}
              title={kind}
              className="raised grid min-h-16 place-items-center rounded-[10px] p-2 hover:bg-fill focus-visible:outline-2 focus-visible:outline-focus"
            >
              <svg aria-hidden viewBox="0 0 36 36" className="size-9 fill-current text-text">
                {TILES[kind].figure}
              </svg>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * The picked Shape's Shape Style (its kind, size, fill, stroke, corners and drop shadow), Transform,
 * motion and time. It is never left with neither fill nor stroke: with no stroke its fill can't be
 * turned off (which it says), and with no fill its stroke is at least 1 px. Its kind switches its
 * figure, its look kept (`withKind`). It shows only the fields its kind uses: corners a rectangle's
 * alone, and a line's or an arrow's its length, thickness and colour (its stroke's), at least 1 px
 * thick, with no height nor fill.
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
  const restyle = (next: ShapeStyle, group: string) => {
    if (drawsSomething(next)) onChange({ ...shape, style: next }, `shape:${shape.id}:style.${group}`);
  };
  const setStyle = <K extends keyof ShapeStyle>(field: K, value: ShapeStyle[K], group: string = field) => restyle({ ...shape.style, [field]: value }, group);
  const { style } = shape;
  const filled = style.fill !== null;
  const line = allStroke(style.kind);
  const shadow: ShadowAccess = {
    shadow: style.shadow,
    mixed: () => false,
    any: (test) => test(style.shadow),
    change: (change, field) => setStyle("shadow", change(style.shadow), field ? `shadow.${field}` : "shadow"),
  };
  // Whole pixels, up to the frame's side (or more, where it is already larger).
  const size = (value: number, frame: number) => ({ min: SHAPE_SIZE_RANGE[0], max: Math.max(frame, value), format: (v: number) => `${Math.round(v)} px` });
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
        <Select label="Figure" value={style.kind} options={KIND_OPTIONS} onChange={(kind) => restyle(withKind(style, kind), "kind")} />
        <Slider
          label={line ? "Length" : "Width"}
          value={style.width}
          {...size(style.width, FRAME.width)}
          onChange={(width) => setStyle("width", Math.round(width))}
        />
        {!line && (
          <>
            <Slider label="Height" value={style.height} {...size(style.height, FRAME.height)} onChange={(height) => setStyle("height", Math.round(height))} />
            <Switch checked={filled} disabled={filled && !style.stroke_width} onChange={(on) => setStyle("fill", on ? NEW_FILL : null)}>
              <span className="text-sm font-medium">Fill</span>
            </Switch>
            {style.fill !== null && <ColorField label="Fill colour" value={style.fill} onChange={(fill) => setStyle("fill", fill)} />}
            {filled && !style.stroke_width && <Hint>{NOTHING_TO_DRAW}</Hint>}
          </>
        )}
        <Slider
          label={line ? "Thickness" : "Stroke"}
          value={style.stroke_width}
          min={filled && !line ? 0 : 1}
          max={Math.max(SHAPE_STROKE_MAX, style.stroke_width)}
          format={(v) => (v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", Math.round(width))}
        />
        {style.stroke_width > 0 && (
          <ColorField label={line ? "Colour" : "Stroke colour"} value={style.stroke_colour} onChange={(colour) => setStyle("stroke_colour", colour)} />
        )}
        {style.kind === "rectangle" && (
          <Slider label="Corners" value={style.radius} min={0} max={0.5} step={0.01} format={cornersFormat} onChange={(radius) => setStyle("radius", radius)} />
        )}
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
  kind: (shape: Shape) => shape.style.kind,
  width: (shape: Shape) => shape.style.width,
  height: (shape: Shape) => shape.style.height,
  fill: (shape: Shape) => shape.style.fill,
  stroke_width: (shape: Shape) => shape.style.stroke_width,
  stroke_colour: (shape: Shape) => shape.style.stroke_colour,
  radius: (shape: Shape) => shape.style.radius,
};
type Field = keyof typeof READ;

/**
 * Several picked Shapes' Shape Style and motion, set on every one of them at once, as TextLayersFields sets
 * several Text Layers'. A field they differ in shows the first one's value, marked Mixed, until it is
 * set. Their places and times stay their own. A field shows while one of them uses it, and is set on
 * those that do: height and fill on the filled figures, corners on the rectangles.
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
  // Each read among `among` of them: all of them, or those that use the field.
  const value = <F extends Field>(field: F, among = shapes) => (shared(among, read(field)) ?? read(field)(among[0])) as ReturnType<(typeof READ)[F]>;
  const mixed = (field: Field, among = shapes) => shared(among, read(field)) === undefined;
  const marker = (field: Field, among = shapes) => (mixed(field, among) ? <Mixed /> : undefined);
  const figures = shapes.filter((shape) => !allStroke(shape.style.kind));
  const rectangles = shapes.filter((shape) => shape.style.kind === "rectangle");
  const lines = figures.length === 0;
  // `change` made to each one's style, but where it would leave one with nothing to draw.
  const restyle = (change: (style: ShapeStyle) => ShapeStyle, group: string) =>
    onChange((shape) => {
      const style = change(shape.style);
      return drawsSomething(style) ? { ...shape, style } : shape;
    }, `shapes:style.${group}`);
  const setStyle = <K extends keyof ShapeStyle>(field: K, next: ShapeStyle[K]) => restyle((style) => ({ ...style, [field]: next }), field);
  // `field` set on those of them that use it (`uses`).
  const setUsed = <K extends keyof ShapeStyle>(uses: (style: ShapeStyle) => boolean, field: K, next: ShapeStyle[K]) =>
    restyle((style) => (uses(style) ? { ...style, [field]: next } : style), field);
  const filled = !lines && value("fill", figures) !== null;
  // Turning the fill off would leave one with nothing to draw.
  const fillStays = figures.some((shape) => shape.style.fill !== null && !shape.style.stroke_width);
  const outline = shapes.some((shape) => allStroke(shape.style.kind) || shape.style.fill === null);
  const shadow: ShadowAccess = {
    shadow: shapes[0].style.shadow,
    mixed: (read) => shared(shapes, (shape) => read(shape.style.shadow)) === undefined,
    any: (test) => shapes.some((shape) => test(shape.style.shadow)),
    change: (change, field) => restyle((style) => ({ ...style, shadow: change(style.shadow) }), field ? `shadow.${field}` : "shadow"),
  };
  // Whole pixels, as ShapeFields' (or Mixed).
  const size = (field: "width" | "height", frame: number, among = shapes) => ({
    min: SHAPE_SIZE_RANGE[0],
    max: Math.max(frame, ...among.map(read(field) as (shape: Shape) => number)),
    format: (v: number) => (mixed(field, among) ? "Mixed" : `${Math.round(v)} px`),
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
        <Select
          label="Figure"
          value={value("kind")}
          options={KIND_OPTIONS}
          onChange={(kind) => restyle((style) => withKind(style, kind), "kind")}
          marker={marker("kind")}
        />
        <Slider
          label={lines ? "Length" : "Width"}
          value={value("width")}
          {...size("width", FRAME.width)}
          onChange={(width) => setStyle("width", Math.round(width))}
        />
        {!lines && (
          <>
            <Slider
              label="Height"
              value={value("height", figures)}
              {...size("height", FRAME.height, figures)}
              onChange={(height) => setUsed((style) => !allStroke(style.kind), "height", Math.round(height))}
            />
            <Switch
              checked={filled}
              disabled={filled && fillStays}
              onChange={(on) => restyle((style) => (!allStroke(style.kind) ? { ...style, fill: on ? (style.fill ?? NEW_FILL) : null } : style), "fill")}
            >
              <span className="flex items-center gap-1.5 text-sm font-medium">Fill {marker("fill", figures)}</span>
            </Switch>
            {figures.some((shape) => shape.style.fill !== null) && (
              <ColorField
                label="Fill colour"
                value={figures.find((shape) => shape.style.fill !== null)?.style.fill ?? NEW_FILL}
                onChange={(fill) => restyle((style) => (style.fill === null || allStroke(style.kind) ? style : { ...style, fill }), "fill")}
                marker={marker("fill", figures)}
              />
            )}
            {filled && fillStays && <Hint>{NOTHING_TO_DRAW}</Hint>}
          </>
        )}
        <Slider
          label={lines ? "Thickness" : "Stroke"}
          value={value("stroke_width")}
          min={outline ? 1 : 0}
          max={Math.max(SHAPE_STROKE_MAX, ...shapes.map((shape) => shape.style.stroke_width))}
          format={(v) => (mixed("stroke_width") ? "Mixed" : v ? `${v} px` : "None")}
          onChange={(width) => setStyle("stroke_width", Math.round(width))}
        />
        {shapes.some((shape) => shape.style.stroke_width > 0) && (
          <ColorField
            label={lines ? "Colour" : "Stroke colour"}
            value={value("stroke_colour")}
            onChange={(colour) => setStyle("stroke_colour", colour)}
            marker={marker("stroke_colour")}
          />
        )}
        {rectangles.length > 0 && (
          <Slider
            label="Corners"
            value={value("radius", rectangles)}
            min={0}
            max={0.5}
            step={0.01}
            format={(v) => (mixed("radius", rectangles) ? "Mixed" : cornersFormat(v))}
            onChange={(radius) => setUsed((style) => style.kind === "rectangle", "radius", radius)}
          />
        )}
      </Group>
      <Group title="Shadow">{shadowControls(shadow, { inspector: true })}</Group>
      <SeveralMotionFields items={shapes} prefix="shapes" onChange={onChange} />
    </div>
  );
}
