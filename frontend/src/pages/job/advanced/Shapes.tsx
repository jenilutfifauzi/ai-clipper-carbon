import { ClipboardCopy, Copy, Trash2 } from "lucide-react";
import type { Shape, ShapeKind, ShapeStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { FRAME } from "../editor/picture";
import { Group, Mixed } from "../editor/StyleFields";
import { shared } from "./actions";
import { DRAG_SHAPE } from "./drag";
import { SHAPE_SIZE } from "./shapeStyle";
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

/** The picked Shape's Shape Style (its size and fill), Transform and time. */
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
  const setStyle = <K extends keyof ShapeStyle>(field: K, value: ShapeStyle[K]) =>
    onChange({ ...shape, style: { ...shape.style, [field]: value } }, `shape:${shape.id}:style.${field}`);
  const { style } = shape;
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
        <ColorField label="Fill" value={style.fill ?? "#FFFFFF"} onChange={(fill) => setStyle("fill", fill)} />
      </Group>
      <ShapeTransformFields shape={shape} onChange={onChange} />
      <TimingFields item={shape} duration={duration} labels={{ start: "Comes on at", secs: "Stays for" }} onChange={onChange} />
    </div>
  );
}

// How the several-Shapes fields read each of their values off a Shape.
const READ = {
  width: (shape: Shape) => shape.style.width,
  height: (shape: Shape) => shape.style.height,
  fill: (shape: Shape) => shape.style.fill,
};
type Field = keyof typeof READ;

/**
 * Several picked Shapes' Shape Style, set on every one of them at once, as TextLayersFields sets
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
  const setStyle = <K extends keyof ShapeStyle>(field: K, next: ShapeStyle[K]) =>
    onChange((shape) => ({ ...shape, style: { ...shape.style, [field]: next } }), `shapes:style.${field}`);
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
        <ColorField label="Fill" value={value("fill") ?? "#FFFFFF"} onChange={(fill) => setStyle("fill", fill)} marker={mixed("fill") ? <Mixed /> : undefined} />
      </Group>
    </div>
  );
}
