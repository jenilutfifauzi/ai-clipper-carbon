import { ChevronDown } from "lucide-react";
import { useId, type CSSProperties, type ReactNode } from "react";
import { cx } from "../format";
import { INLINE_LABEL, useInline } from "./inspectorLayout";

// A labelled native select, in the inset field look. In the Inspector (inspectorLayout.ts) the
// label goes left of the select.
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
  const inline = useInline();
  return (
    <div className={cx(inline ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className={inline ? INLINE_LABEL : "flex items-center gap-1.5 text-sm font-medium"}>
        {inline ? <span className="min-w-0 truncate">{label}</span> : label}
        {marker}
      </label>
      <div className={inline ? "relative min-w-0 flex-1" : "relative"}>
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

