import { Copy, Trash2 } from "lucide-react";
import type { Shape, ShapeKind, ShapeStyle } from "../../../api";
import { Button } from "../../../components/Button";
import { ColorField } from "../../../components/ColorField";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { FRAME } from "../editor/picture";
import { Group } from "../editor/StyleFields";
import { SHAPE_SIZE } from "./shapeStyle";
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
