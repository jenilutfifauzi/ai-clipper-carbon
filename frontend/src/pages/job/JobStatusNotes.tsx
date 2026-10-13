import { AlertCircle, AlertTriangle, Clock, RotateCcw } from "lucide-react";
import type { JobProgress, JobWarning } from "../../api";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { formatTime } from "../../format";
import { stageLabel, stageNoun } from "../../stages";

// The Job failed: where, why, and a retry from that stage.
export function ErrorNote({
  progress,
  uploaded,
  retrying,
  retryError,
  onRetry,
}: {
  progress: JobProgress;
  uploaded: boolean;
  retrying: boolean;
  retryError: string | null;
  onRetry: () => void;
}) {
  return (
    <section role="alert" className="flex flex-col gap-3 rounded-panel border border-danger/40 bg-danger-surface p-5 backdrop-blur-[28px] backdrop-saturate-[1.8] sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold text-danger">
        <AlertCircle aria-hidden size={18} />
        Failed during {stageNoun(progress.stage, uploaded)}
      </h2>
      <p className="break-words whitespace-pre-wrap select-text">{progress.error}</p>
      {retryError && <p className="text-sm text-danger">{retryError}</p>}
      <Button variant="primary" onClick={onRetry} disabled={retrying} className="self-start">
        <RotateCcw aria-hidden size={18} />
        {retrying ? "Retrying…" : `Retry from ${stageNoun(progress.stage, uploaded)}`}
      </Button>
    </section>
  );
}

// The LLM's quota is used up (or it stays busy): the Job resumes by itself.
export function WaitingNote({ progress }: { progress: JobProgress }) {
  return (
    <section className="flex flex-col gap-2 rounded-panel border border-waiting/40 bg-waiting-surface p-5 backdrop-blur-[28px] backdrop-saturate-[1.8] sm:p-6">
      <h2 className="flex items-center gap-2 font-semibold text-waiting">
        <Clock aria-hidden size={18} />
        Paused: waiting for the LLM
        {progress.retry_at && <span className="font-normal"> until {formatTime(progress.retry_at)}</span>}
      </h2>
      <p className="text-sm">
        The Job resumes by itself and keeps the Windows already scored. Other Jobs can run meanwhile.
      </p>
      {progress.message && <p className="text-sm break-words text-muted">{progress.message}</p>}
    </section>
  );
}

export function Warnings({ warnings, uploaded }: { warnings: JobWarning[]; uploaded: boolean }) {
  return (
    <Panel aria-labelledby="warnings-heading" className="flex flex-col gap-2">
      <h2 id="warnings-heading" className="flex items-center gap-2 font-semibold">
        <AlertTriangle aria-hidden size={18} className="text-accent-text" />
        Warnings
      </h2>
      <ul className="flex flex-col gap-1.5 text-sm">
        {warnings.map((warning, i) => (
          <li key={i} className="break-words">
            <span className="text-muted">{stageLabel(warning.stage, uploaded)}:</span> {warning.message}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
