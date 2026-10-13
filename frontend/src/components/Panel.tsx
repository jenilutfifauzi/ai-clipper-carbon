import type { ComponentProps } from "react";
import { cx } from "../format";

// The glass panel holding one section of a page.
export function Panel({ className, ...props }: ComponentProps<"section">) {
  return <section className={cx("glass rounded-panel p-5 sm:p-6", className)} {...props} />;
}
