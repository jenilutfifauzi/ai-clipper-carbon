import type { ComponentProps } from "react";
import { cx } from "../format";

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-linear-to-b from-accent to-accent-end text-on-accent",
  secondary: "border border-border bg-surface-raised text-text hover:bg-surface",
  danger: "bg-danger text-white",
  ghost: "text-muted hover:bg-surface-raised hover:text-text",
};

// The button look, also for links that act as buttons (such as a download).
export function buttonClass(variant: Variant = "secondary", className?: string): string {
  return cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 font-medium select-none",
    "motion-safe:transition-[background-color,color,transform] motion-safe:duration-150 active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-60",
    VARIANTS[variant],
    className,
  );
}

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} className={buttonClass(variant, className)} {...props} />;
}
