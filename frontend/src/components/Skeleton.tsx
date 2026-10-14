import { cx } from "../format";

// A placeholder block the size of what it stands in for, so that nothing moves when that arrives.
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block rounded-control bg-fill motion-safe:animate-pulse", className)} />;
}
