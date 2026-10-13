import { cx } from "../format";

// A thin bar: filled to `percent`, or a sweeping stripe while the percent is unknown (null).
export function ProgressBar({ percent, label, className }: { percent: number | null; label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
      className={cx("relative h-1.5 overflow-hidden rounded-full bg-surface-raised", className)}
    >
      {percent === null ? (
        <div className="absolute inset-y-0 w-2/5 rounded-full bg-accent motion-safe:animate-[sweep_1.4s_ease-in-out_infinite]" />
      ) : (
        <div
          className="h-full rounded-full bg-accent motion-safe:transition-[width] motion-safe:duration-500"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      )}
    </div>
  );
}
