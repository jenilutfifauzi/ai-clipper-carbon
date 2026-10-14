import { useId, useState, type ReactNode } from "react";
import { cx } from "../format";

const HEX = /^#[0-9a-f]{6}$/i;

// A colour: the system picker in a swatch, and its #RRGGBB code, editable. A code is taken once it
// is a whole colour.
export function ColorField({
  label,
  value,
  onChange,
  marker,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  marker?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  return (
    <div className={cx("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={`${id}-code`} className="flex items-center gap-1.5 text-sm font-medium">
        {label}
        {marker}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value.toLowerCase()}
          onChange={(event) => {
            setTyped(null);
            onChange(event.target.value.toUpperCase());
          }}
          aria-label={`${label}: pick`}
          className="size-10 shrink-0 cursor-pointer rounded-[10px] border border-border bg-fill p-1"
        />
        <input
          id={`${id}-code`}
          value={typed ?? value}
          maxLength={7}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            const code = event.target.value.trim();
            setTyped(code);
            if (HEX.test(code)) onChange(code.toUpperCase());
          }}
          onBlur={() => setTyped(null)}
          className={cx(
            "min-h-10 w-full min-w-0 rounded-[10px] border bg-fill px-3 font-mono text-base uppercase tabular-nums",
            typed !== null && !HEX.test(typed) ? "border-accent" : "border-border",
          )}
        />
      </div>
    </div>
  );
}
