import { useId, type ReactNode } from "react";
import { cx } from "../format";

/**
 * Nine places on a frame, as a 3x3 group of radio buttons (the arrow keys move between them), each
 * drawn as a dot where it puts the thing. `value` null checks none: it was placed some other way.
 */
export function AnchorGrid<T extends string>({
  legend,
  options,
  value,
  onChange,
  marker,
  className,
}: {
  legend: string;
  // In rows, from the top-left corner.
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
  marker?: ReactNode;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">
        {legend} {marker}
      </legend>
      {/* 9:16, like the frame it places things on. */}
      <div className="grid aspect-[9/16] w-24 grid-cols-3 grid-rows-3 gap-1 rounded-control bg-fill p-1.5">
        {options.map((option, i) => (
          <label key={option.value} className="flex min-h-0 min-w-0" title={option.label}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              aria-label={option.label}
              className="peer sr-only"
            />
            <span
              className={cx(
                "group flex flex-1 cursor-pointer rounded-[7px] p-1.5 select-none",
                ["items-start", "items-center", "items-end"][Math.floor(i / 3)],
                ["justify-start", "justify-center", "justify-end"][i % 3],
                "hover:bg-border/60 peer-checked:bg-accent/15",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus",
                "motion-safe:transition-colors",
              )}
            >
              <span
                aria-hidden
                className={cx("size-2 rounded-full", value === option.value ? "bg-accent" : "bg-muted/50 group-hover:bg-muted")}
              />
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
