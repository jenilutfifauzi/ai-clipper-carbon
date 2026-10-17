import { ChevronDown } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "../format";

// A labelled native select, in the inset field look.
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  marker,
  className,
  optionStyle,
  disabled,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  marker?: ReactNode;
  className?: string;
  // The style of the shown value, such as its font.
  optionStyle?: (value: T) => CSSProperties | undefined;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {marker}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
          style={optionStyle?.(value)}
          className="min-h-10 w-full appearance-none enabled:cursor-pointer disabled:opacity-60 rounded-[10px] border border-border bg-fill py-2 pr-9 pl-3 text-base"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}

