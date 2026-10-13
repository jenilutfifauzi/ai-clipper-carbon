import { cx } from "../format";

// A predicted score out of 100 as a ring filled that far, with the number inside.
export function ScoreRing({ score, size = 40, className }: { score: number; size?: number; className?: string }) {
  const stroke = 3;
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;
  const filled = (Math.min(100, Math.max(0, score)) / 100) * length;
  return (
    <span
      role="img"
      aria-label={`Score ${score} out of 100`}
      title="Predicted score"
      className={cx("relative grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg aria-hidden width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={stroke} className="stroke-fill" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${filled} ${length}`}
          className="stroke-accent"
        />
      </svg>
      <span aria-hidden className="text-[13px] leading-none font-semibold tabular-nums">
        {score}
      </span>
    </span>
  );
}
