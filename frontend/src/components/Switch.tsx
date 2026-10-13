import type { ReactNode } from "react";
import { cx } from "../format";

// An on/off switch: a checkbox with the switch role, drawn as a track and a thumb that springs
// across. Its label is `children`, or the element `labelledBy` names.
export function Switch({
  checked,
  onChange,
  children,
  labelledBy,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  labelledBy?: string;
  className?: string;
}) {
  return (
    <label className={cx("flex min-h-11 cursor-pointer items-center gap-3", className)}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
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
