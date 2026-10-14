import { useId } from "react";
import type { HookAlign, HookShape, HookStyle } from "../../../api";
import { cx } from "../../../format";

const SHAPES: { value: HookShape; label: string }[] = [
  { value: "block", label: "Block" },
  { value: "strips", label: "Strips" },
  { value: "none", label: "No box" },
];

// A thumbnail's lines, as shares of its text's width: a hook of two lines, the second shorter.
const LINES = [1, 0.68];

/**
 * The hook's Shape, as radio cards each showing a small hook drawn in the style's colours and
 * alignment over a stand-in for the video.
 */
export function HookShapePicker({
  style,
  onChange,
  marker,
}: {
  style: HookStyle;
  onChange: (shape: HookShape) => void;
  marker?: React.ReactNode;
}) {
  const name = useId();
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">Shape {marker}</legend>
      <div className="grid grid-cols-3 gap-2">
        {SHAPES.map((shape) => (
          <label key={shape.value} className="flex min-w-0 cursor-pointer flex-col">
            <input
              type="radio"
              name={name}
              value={shape.value}
              checked={style.shape === shape.value}
              onChange={() => onChange(shape.value)}
              className="peer sr-only"
            />
            <span
              className={cx(
                "flex flex-col gap-1.5 rounded-control border border-border p-1.5 select-none",
                "hover:bg-fill peer-checked:border-accent peer-checked:bg-fill peer-checked:shadow-[0_0_0_1px_var(--accent)]",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
                "motion-safe:transition-[background-color,border-color,box-shadow] motion-safe:duration-150",
              )}
            >
              <Thumbnail shape={shape.value} style={style} />
              <span className="text-center text-sm font-medium">{shape.label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function Thumbnail({ shape, style }: { shape: HookShape; style: HookStyle }) {
  const width = 96;
  const height = 56;
  const text = 56;
  const bar = 5;
  const pitch = shape === "strips" ? 13 : 10;
  const left = (width - text) / 2;
  const x = (share: number, align: HookAlign) => (align === "left" ? left : (width - text * share) / 2);
  const top = (height - pitch * (LINES.length - 1) - bar) / 2;
  const box = style.box_opacity > 0;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} aria-hidden className="block w-full rounded-[7px]">
      <rect width={width} height={height} fill="#3a3a3c" />
      <rect y={height * 0.62} width={width} height={height * 0.38} fill="#4a4a4e" />
      {box && shape === "block" && (
        <rect x={left - 7} y={top - 7} width={text + 14} height={pitch + bar + 14} rx={Math.min(style.radius / 8, 8)} fill={style.box_colour} fillOpacity={style.box_opacity} />
      )}
      {LINES.map((share, i) => (
        <g key={i}>
          {box && shape === "strips" && (
            <rect
              x={x(share, style.align) - 4}
              y={top + i * pitch - 3.5}
              width={text * share + 8}
              height={bar + 7}
              rx={Math.min(style.radius / 8, 3)}
              fill={style.box_colour}
              fillOpacity={style.box_opacity}
            />
          )}
          <rect x={x(share, style.align)} y={top + i * pitch} width={text * share} height={bar} rx={bar / 2} fill={style.colour} />
        </g>
      ))}
    </svg>
  );
}
