import { useId, type ReactNode } from "react";
import { cx } from "../format";

// A labelled range input with its value shown beside the label. `marker` goes after the label
// (such as a dot for a value that differs from a default).
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
  marker,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
  marker?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <label htmlFor={id} className="flex items-center gap-1.5 font-medium">
          {label}
          {marker}
        </label>
        <output htmlFor={id} className="text-muted tabular-nums">
          {format(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}
