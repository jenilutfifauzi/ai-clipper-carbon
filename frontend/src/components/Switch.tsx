import type { ReactNode } from "react";
import { cx } from "../format";

// An on/off switch: a checkbox with the switch role, drawn as a track and thumb.
export function Switch({
  checked,
  onChange,
  children,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  // The visible label.
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-center gap-3", className)}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "relative h-7 w-12 shrink-0 rounded-full border border-border bg-surface-raised",
          "peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
          "after:absolute after:top-0.5 after:left-0.5 after:size-5.5 after:rounded-full after:bg-white after:shadow",
          "motion-safe:after:transition-transform peer-checked:after:translate-x-5",
        )}
      />
      {children}
    </label>
  );
}
