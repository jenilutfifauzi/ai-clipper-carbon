import { mediaUrl, type AgentUi } from "../../../../../api";
import { CandidateSummary, Thumbnail } from "../../../CandidateList";
import type { AgentUiHost } from "./GenerativeUi";

/**
 * Where a frame save_frame saved (its path on this Mac, in the Job's directory) is served; null for a
 * path outside the Job's directory.
 */
export function frameUrl(jobId: string, path: string): string | null {
  const marker = `/${jobId}/`;
  const at = path.lastIndexOf(marker);
  return at === -1 ? null : mediaUrl(jobId, path.slice(at + marker.length));
}

/**
 * The Candidate as the editor holds it now, drawn as its row in the Candidate list with its hook
 * beneath: the spec carries none of it, so it is never stale. The Agent's note under it, and a frame
 * it saved in place of the still. Nothing outside the Advanced Edit, which has no Candidate to show.
 */
export function CandidateCard({ ui, host }: { ui: Extract<AgentUi, { kind: "candidate" }>; host: AgentUiHost | null }) {
  if (!host?.candidate) return null;
  const { value: candidate, name } = host.candidate;
  const still = ui.frame ? (frameUrl(host.jobId, ui.frame) ?? undefined) : undefined;
  return (
    <div data-agent-ui="candidate" className="@container flex flex-col gap-1.5 rounded-lg border border-border p-2">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
        <Thumbnail jobId={host.jobId} candidate={candidate} still={still} />
        <CandidateSummary candidate={candidate} name={name} />
      </div>
      {candidate.hook_text && <p className="text-sm text-pretty">{candidate.hook_text}</p>}
      {ui.note && <p className="text-xs text-pretty text-muted">{ui.note}</p>}
    </div>
  );
}
