import type { ComponentProps } from "react";
import { cx } from "../format";

type Variant = "primary" | "secondary" | "danger" | "ghost";
// Sizes are a prop, not class overrides: Tailwind orders same-property utilities by value, so a
// `px-3` passed in would lose to the base `px-4`.
type Size = "md" | "sm" | "xs" | "icon";

const VARIANTS: Record<Variant, string> = {
  // The orange call to action.
  primary:
    "bg-linear-to-b from-accent to-accent-end text-on-accent shadow-accent inset-shadow-[0_1px_0_rgb(255_255_255/0.3)] hover:brightness-105",
  // Glass: a raised translucent control, without a blur of its own (it sits on a glass panel).
  secondary: "raised text-text hover:bg-fill",
  danger: "bg-danger text-white shadow-raised hover:brightness-110",
  ghost: "text-muted hover:bg-fill hover:text-text",
};

const SIZES: Record<Size, string> = {
  md: "min-h-11 gap-2 rounded-control px-4",
  sm: "min-h-10 gap-2 rounded-control px-3 text-sm",
  xs: "min-h-9 gap-1.5 rounded-[10px] px-2 text-sm",
  // A 44 px circle around an icon; give it an aria-label.
  icon: "size-11 shrink-0 rounded-full",
};

// The button look, also for links that act as buttons (such as a download).
export function buttonClass(variant: Variant = "secondary", size: Size = "md", className?: string): string {
  return cx(
    "inline-flex items-center justify-center font-medium select-none",
    "motion-safe:transition-[background-color,color,filter,scale] motion-safe:duration-150 motion-safe:ease-out active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}
