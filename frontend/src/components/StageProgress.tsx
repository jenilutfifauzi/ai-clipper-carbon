import { Check, Circle, Clock, Loader2, X } from "lucide-react";
import type { JobProgress } from "../api";
import { cx } from "../format";
import { STAGES, stageLabel, stageStates, type StageState } from "../stages";
import { ProgressBar } from "./ProgressBar";

const MARKERS: Record<StageState, { Icon: typeof Check; tone: string; spoken: string }> = {
  pending: { Icon: Circle, tone: "bg-fill text-muted", spoken: "not started" },
  active: { Icon: Loader2, tone: "bg-surface-raised text-accent-text ring-2 ring-accent", spoken: "in progress" },
  waiting: { Icon: Clock, tone: "bg-waiting-surface text-waiting ring-2 ring-waiting", spoken: "paused" },
  failed: { Icon: X, tone: "bg-danger-surface text-danger ring-2 ring-danger", spoken: "failed" },
  done: { Icon: Check, tone: "bg-linear-to-b from-accent to-accent-end text-on-accent shadow-accent", spoken: "done" },
};

// The Job's stages in order, joined by a rail, with the running one's message and percent. With no
// stage running (in review), they sit in one compact row. For an uploaded Job, the first stage
// takes the stored file (and makes its preview copy) rather than downloading.
export function StageProgress({
  progress,
  reached,
  uploaded = false,
}: {
  progress: JobProgress;
  reached: number;
  uploaded?: boolean;
}) {
  const states = stageStates(progress, reached);
  const settled = states.every((state) => state === "done" || state === "pending");
  return (
    <ol className={cx("flex", settled ? "flex-wrap gap-x-6 gap-y-3" : "flex-col")}>
      {STAGES.map((stage, i) => {
        const state = states[i];
        const { Icon, tone, spoken } = MARKERS[state];
        const current = state === "active" || state === "waiting" || state === "failed";
        const label = stageLabel(stage.status, uploaded);
        const last = i === STAGES.length - 1;
        return (
          <li
            key={stage.status}
            aria-current={current ? "step" : undefined}
            className={cx("relative flex gap-3.5", settled ? "items-center gap-2.5" : "pb-4 last:pb-0")}
          >
            {!last && !settled && (
              <span
                aria-hidden
                className={cx(
                  "absolute top-8 bottom-0 left-[13px] w-0.5 rounded-full",
                  state === "done" ? "bg-accent/60" : "bg-fill",
                )}
              />
            )}
            <span className={cx("relative grid size-7 shrink-0 place-items-center rounded-full", tone)} aria-hidden>
              <Icon
                size={state === "pending" ? 8 : 15}
                strokeWidth={state === "pending" ? 0 : 2.75}
                fill={state === "pending" ? "currentColor" : "none"}
                className={cx(state === "active" && "motion-safe:animate-spin")}
              />
            </span>
            <div className={cx("min-w-0 flex-1", !settled && "pt-0.5")}>
              <p className={cx("font-medium", state === "pending" && "text-muted")}>
                {label}
                <span className="sr-only">: {spoken}</span>
              </p>
              {state === "active" && (
                <div className="mt-1.5 flex flex-col gap-2">
                  {progress.message && <p className="text-sm break-words text-muted">{progress.message}</p>}
                  <div className="flex items-center gap-3">
                    <ProgressBar percent={progress.progress} label={`${label} progress`} className="flex-1" />
                    {progress.progress !== null && (
                      <span className="w-11 text-right text-sm text-muted tabular-nums">
                        {Math.round(progress.progress)}%
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
