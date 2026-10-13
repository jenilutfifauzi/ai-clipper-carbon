import { AlertCircle, CheckCircle2, Clock, Hourglass, Loader2 } from "lucide-react";
import type { JobStatus } from "../api";
import { cx } from "../format";

const BADGES: Record<JobStatus, { label: string; tone: string; Icon: typeof Clock }> = {
  queued: { label: "Queued", tone: "text-muted", Icon: Hourglass },
  downloading: { label: "Downloading", tone: "text-accent-text", Icon: Loader2 },
  transcribing: { label: "Transcribing", tone: "text-accent-text", Icon: Loader2 },
  analyzing: { label: "Analyzing", tone: "text-accent-text", Icon: Loader2 },
  review: { label: "Ready for review", tone: "text-success", Icon: CheckCircle2 },
  rendering: { label: "Rendering", tone: "text-accent-text", Icon: Loader2 },
  waiting_quota: { label: "Waiting for quota", tone: "text-waiting", Icon: Clock },
  error: { label: "Failed", tone: "text-danger", Icon: AlertCircle },
};

// An uploaded Job's first stage stores the file and makes its preview copy: it downloads nothing.
const UPLOAD_FIRST_STAGE = "Preparing file";

export function StatusBadge({ status, uploaded = false }: { status: JobStatus; uploaded?: boolean }) {
  const { label, tone, Icon } = BADGES[status];
  return (
    <span className={cx("inline-flex items-center gap-1.5 text-sm font-medium whitespace-nowrap", tone)}>
      <Icon aria-hidden size={16} className={cx(Icon === Loader2 && "motion-safe:animate-spin")} />
      {uploaded && status === "downloading" ? UPLOAD_FIRST_STAGE : label}
    </span>
  );
}
