import { useId, type ReactNode } from "react";
import { cx } from "../format";

// A labelled range input with its value shown beside the label. `marker` goes after the label
// (such as a dot for a value that differs from a default), and `after` after the value (such as a
// Keyframe cluster).
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  format = String,
  onChange,
  marker,
  after,
  disabled,
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
  after?: ReactNode;
  disabled?: boolean;
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
        <output htmlFor={id} className="ml-auto text-muted tabular-nums">
          {format(value)}
        </output>
        {after}
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-7 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50 in-data-sheet:h-11"
      />
    </div>
  );
}
