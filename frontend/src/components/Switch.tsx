import type { ReactNode } from "react";
import { cx } from "../format";
import { useInline } from "./inspectorLayout";

// An on/off switch: a checkbox with the switch role, drawn as a track and a thumb that springs
// across. Its label is `children`, or the element `labelledBy` names. Disabled, it can't be turned.
// In the Inspector (inspectorLayout.ts) its own label goes left and the switch right; one labelled
// from elsewhere sits in its owner's row as it is.
export function Switch({
  checked,
  onChange,
  children,
  labelledBy,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  labelledBy?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inline = useInline() && !labelledBy;
  return (
    <label
      className={cx(
        inline ? "flex min-h-9 flex-row-reverse items-center justify-between gap-3 text-sm font-medium" : "flex min-h-11 items-center gap-3",
        disabled ? "opacity-50" : "cursor-pointer",
        className,
      )}
    >
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-labelledby={labelledBy}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className={cx(
          "relative h-7.5 w-12.5 shrink-0 rounded-full bg-fill",
          "peer-checked:bg-linear-to-b peer-checked:from-accent peer-checked:to-accent-end",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
          "after:absolute after:top-0.5 after:left-0.5 after:size-6.5 after:rounded-full after:bg-white",
          "after:shadow-[0_0_0_0.5px_rgb(0_0_0/0.06),0_3px_8px_rgb(0_0_0/0.2)] peer-checked:after:translate-x-5",
          "motion-safe:after:transition-transform motion-safe:after:duration-[380ms] motion-safe:after:ease-spring",
        )}
      />
      {children}
    </label>
  );
}
