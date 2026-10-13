import { Check, Circle, Clock, Loader2, X } from "lucide-react";
import type { JobProgress } from "../api";
import { cx } from "../format";
import { STAGES, stageStates, type StageState } from "../stages";
import { ProgressBar } from "./ProgressBar";

const MARKERS: Record<StageState, { Icon: typeof Check; tone: string; spoken: string }> = {
  pending: { Icon: Circle, tone: "text-muted border-border", spoken: "not started" },
  active: { Icon: Loader2, tone: "text-accent-text border-accent", spoken: "in progress" },
  waiting: { Icon: Clock, tone: "text-waiting border-waiting", spoken: "paused" },
  failed: { Icon: X, tone: "text-danger border-danger", spoken: "failed" },
  done: { Icon: Check, tone: "text-on-accent border-accent bg-accent", spoken: "done" },
};

// The Job's stages in order, with the running one's message and percent.
export function StageProgress({ progress, reached }: { progress: JobProgress; reached: number }) {
  const states = stageStates(progress, reached);
  return (
    <ol className="flex flex-col gap-1">
      {STAGES.map((stage, i) => {
        const state = states[i];
        const { Icon, tone, spoken } = MARKERS[state];
        const current = state === "active" || state === "waiting" || state === "failed";
        return (
          <li key={stage.status} aria-current={current ? "step" : undefined} className="flex gap-3 py-2">
            <span
              className={cx("mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border", tone)}
              aria-hidden
            >
              <Icon size={15} strokeWidth={2.5} className={cx(state === "active" && "motion-safe:animate-spin")} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={cx("font-medium", state === "pending" && "text-muted")}>
                {stage.label}
                <span className="sr-only">: {spoken}</span>
              </p>
              {state === "active" && (
                <div className="mt-1.5 flex flex-col gap-2">
                  {progress.message && <p className="text-sm text-muted">{progress.message}</p>}
                  <div className="flex items-center gap-3">
                    <ProgressBar percent={progress.progress} label={`${stage.label} progress`} className="flex-1" />
                    {progress.progress !== null && (
                      <span className="w-12 text-right text-sm text-muted tabular-nums">
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
