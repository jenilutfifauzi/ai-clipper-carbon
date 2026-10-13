import { useId } from "react";
import { cx } from "../format";

// A segmented control: one choice of a few, as a group of radio buttons.
export function Segmented<T extends string>({
  legend,
  options,
  value,
  onChange,
  className,
}: {
  legend: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset className={cx("flex flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div className="flex rounded-control border border-border bg-surface p-1">
        {options.map((option) => (
          <label key={option.value} className="flex min-w-0 flex-1">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cx(
                "flex min-h-9 flex-1 cursor-pointer items-center justify-center rounded-[10px] px-3 text-sm font-medium whitespace-nowrap text-muted select-none",
                "hover:text-text peer-checked:bg-surface-raised peer-checked:text-text peer-checked:shadow-sm",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                "motion-safe:transition-colors",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
