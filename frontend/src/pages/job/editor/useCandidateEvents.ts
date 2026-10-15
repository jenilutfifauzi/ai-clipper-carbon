import { useEffect, useRef, useState } from "react";
import { candidateEventsUrl, TAB_ID, type Candidate, type CandidateEvent, type EditSource, type SavedBy } from "../../../api";

export interface CandidateEventHandlers {
  // On (re)connecting: the Candidates as they are now, to catch up with what was saved meanwhile.
  onReady: (candidates: Candidate[]) => void;
  // A new Revision saved by another editor or tab: this tab's own saves aren't passed on.
  onCandidate: (event: CandidateEvent) => void;
  onRemoved: (id: string) => void;
  onDeleted: () => void;
}

/**
 * The Job's Candidates as other editors save them (ADR 0003). EventSource reconnects by itself;
 * `lost` is true until it has, and the `ready` that follows catches up.
 */
export function useCandidateEvents(jobId: string, handlers: CandidateEventHandlers): { lost: boolean } {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const source = new EventSource(candidateEventsUrl(jobId));
    source.onopen = () => setLost(false);
    source.onerror = () => setLost(true);
    source.addEventListener("ready", (event) => latest.current.onReady(JSON.parse(event.data).candidates));
    source.addEventListener("candidate", (event) => {
      const saved: CandidateEvent = JSON.parse(event.data);
      if (saved.tab !== TAB_ID) latest.current.onCandidate(saved);
    });
    source.addEventListener("removed", (event) => latest.current.onRemoved(JSON.parse(event.data).id));
    source.addEventListener("deleted", () => {
      source.close();
      setLost(false);
      latest.current.onDeleted();
    });
    return () => source.close();
  }, [jobId]);

  return { lost };
}

const SAVED_BY: Record<SavedBy, string> = {
  "advanced-edit": "Advanced Edit",
  "clip-editor": "Clip editor",
  agent: "Agent",
  restore: "Restore",
  unknown: "Unknown",
};

// Who saved a change, as an editor shows it: the same editor as this one is another tab of it.
export function savedByLabel(source: SavedBy, here: EditSource): string {
  return source === here ? "Another tab" : SAVED_BY[source];
}

// What a notice of a change from elsewhere says.
export function changedText(source: SavedBy, parts: string[], here: EditSource): string {
  const who = savedByLabel(source, here);
  return parts.length ? `${who} changed ${parts.join(", ")}` : `${who} changed this clip`;
}
