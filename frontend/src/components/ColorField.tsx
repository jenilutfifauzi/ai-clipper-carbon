import { useId, useState, type ReactNode } from "react";
import { cx } from "../format";
import { INLINE_LABEL, useInline } from "./inspectorLayout";

const HEX = /^#[0-9a-f]{6}$/i;

// A colour: the system picker in a swatch, and its #RRGGBB code, editable. A code is taken once it
// is a whole colour. `after` goes beside the code (a key colour's eyedropper). In the Inspector
// (inspectorLayout.ts) the label goes left of the swatch and code.
export function ColorField({
  label,
  value,
  onChange,
  marker,
  className,
  after,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  marker?: ReactNode;
  className?: string;
  after?: ReactNode;
}) {
  const id = useId();
  const [typed, setTyped] = useState<string | null>(null);
  const inline = useInline();
  return (
    <div className={cx(inline ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={`${id}-code`} className={inline ? INLINE_LABEL : "flex items-center gap-1.5 text-sm font-medium"}>
        {inline ? <span className="min-w-0 truncate">{label}</span> : label}
        {marker}
      </label>
      <div className={inline ? "flex min-w-0 flex-1 items-center gap-2" : "flex items-center gap-2"}>
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
          aria-label={`${label}: code`}
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
        {after}
      </div>
    </div>
  );
}
