import { Copy, Trash2 } from "lucide-react";
import type { Shape, ShapeKind, ShapeStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import { FRAME } from "../editor/picture";
import { shadowControls, type ShadowAccess } from "../editor/ShadowFields";
import { Group } from "../editor/StyleFields";
import { cornersFormat } from "./DecorationFields";
import { drawsSomething, NEW_FILL, NOTHING_TO_DRAW, SHAPE_SIZE, SHAPE_STROKE_MAX } from "./shapeStyle";
import { MotionFields } from "./TextLayers";
import { TimingFields } from "./TimingFields";
import { ShapeTransformFields } from "./TransformFields";

// The Stickers tab's tiles, each by its Shape Kind: what it is called, and its figure drawn on it.
const TILES: { kind: ShapeKind; name: string; figure: string }[] = [{ kind: "rectangle", name: "rectangle", figure: "aspect-square w-9" }];

/**
 * The Stickers tab (GLOSSARY.md): its one shelf, Shapes, with a tile per Shape Kind, each drawn as
 * the figure it adds (a rectangle as a square). A click adds it at the playhead.
 */
export function ShapeAssets({ onAdd }: { onAdd: (kind: ShapeKind) => void }) {
  return (
    <div className="flex flex-col gap-3">
      <Hint more="Drag it on the video to place it; its corners scale it and the handle above turns it.">Click a shape to add it at the playhead.</Hint>
      <section className="flex flex-col gap-2" aria-label="Shapes">
        <h3 className="text-sm font-medium text-muted">Shapes</h3>
        <div className="grid grid-cols-3 gap-2">
          {TILES.map((tile) => (
            <button
              key={tile.kind}
              type="button"
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
