import { useId, type CSSProperties } from "react";
import { cx } from "../format";

// A segmented control: one choice of a few, as a group of radio buttons. The selected segment is a
// raised thumb that springs to the choice.
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
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  return (
    <fieldset className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <div
        className="relative isolate flex rounded-control bg-fill p-1"
        style={{ "--count": options.length, "--index": index } as CSSProperties}
      >
        <span
          aria-hidden
          className={cx(
            "raised absolute inset-y-1 left-1 -z-10 w-[calc((100%-0.5rem)/var(--count))] rounded-[10px]",
            "translate-x-[calc(var(--index)*100%)] motion-safe:transition-transform motion-safe:duration-[380ms] motion-safe:ease-spring",
          )}
        />
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
                "flex min-h-9 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[10px] px-2 text-sm font-medium whitespace-nowrap text-muted select-none sm:px-3",
                "hover:text-text peer-checked:text-text",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
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
