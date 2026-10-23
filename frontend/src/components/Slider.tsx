import { useId, type ReactNode } from "react";
import { cx } from "../format";
import { INLINE_LABEL, useInline } from "./inspectorLayout";

// A labelled range input with its value shown beside the label. `marker` goes after the label
// (such as a dot for a value that differs from a default), and `after` after the value (such as a
// Keyframe cluster). In the Inspector (inspectorLayout.ts) it is one inline row, label, track, value;
// with an `after` the track keeps the full width under its row, as the cluster takes the room.
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
  const inline = useInline();
  const track = (
    <input
      id={id}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value))}
      className={
        inline && !after
          ? "h-7 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50 in-data-sheet:h-11"
          : "h-7 w-full cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50 in-data-sheet:h-11"
      }
    />
  );
  if (inline && !after) {
    return (
      <div className={cx("flex min-h-9 min-w-0 items-center gap-2", className)}>
        <label htmlFor={id} className={INLINE_LABEL}>
          <span className="min-w-0 truncate">{label}</span>
          {marker}
        </label>
        {track}
        <output htmlFor={id} className="min-w-[4ch] shrink-0 text-right text-sm text-muted tabular-nums">
          {format(value)}
        </output>
      </div>
    );
  }
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
      {track}
    </div>
  );
}
