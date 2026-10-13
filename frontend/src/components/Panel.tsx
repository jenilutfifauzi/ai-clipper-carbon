import type { ComponentProps } from "react";
import { cx } from "../format";

// A surface holding one section of a page. Ticket 18 turns it into the glass panel.
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-panel border border-border bg-surface p-5 shadow-panel sm:p-6", className)}
      {...props}
    />
  );
}
