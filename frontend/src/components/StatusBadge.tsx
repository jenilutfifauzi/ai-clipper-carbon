import { AlertCircle, CheckCircle2, Clock, Hourglass, Loader2 } from "lucide-react";
import type { JobStatus } from "../api";
import { cx } from "../format";

const BADGES: Record<JobStatus, { label: string; tone: string; Icon: typeof Clock }> = {
  queued: { label: "Queued", tone: "text-muted", Icon: Hourglass },
  downloading: { label: "Downloading", tone: "text-accent-text", Icon: Loader2 },
  transcribing: { label: "Transcribing", tone: "text-accent-text", Icon: Loader2 },
  analyzing: { label: "Analyzing", tone: "text-accent-text", Icon: Loader2 },
  review: { label: "Ready for review", tone: "text-success", Icon: CheckCircle2 },
  waiting_quota: { label: "Waiting for quota", tone: "text-waiting", Icon: Clock },
  error: { label: "Failed", tone: "text-danger", Icon: AlertCircle },
};

export function StatusBadge({ status }: { status: JobStatus }) {
  const { label, tone, Icon } = BADGES[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap", tone)}>
      <Icon aria-hidden size={16} className={cx(Icon === Loader2 && "motion-safe:animate-spin")} />
      {label}
    </span>
  );
}
