import { useEffect, useRef, useState } from "react";
import { api, ApiError, candidateEventsUrl, TAB_ID, type Candidate, type CandidateEvent, type EditSource, type SavedBy } from "../../../api";
import { reloadFonts } from "../../../fonts";

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
 * `lost` is true until it has, and the `ready` that follows catches up. Faces imported or deleted
 * anywhere are listed again for the font pickers.
 */
export function useCandidateEvents(jobId: string, handlers: CandidateEventHandlers): { lost: boolean } {
  const latest = useRef(handlers);
  latest.current = handlers;
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const source = new EventSource(candidateEventsUrl(jobId));
    source.onopen = () => setLost(false);
    source.onerror = () => {
      setLost(true);
      // Closed for good (an answer that isn't a stream, such as a 404): it doesn't reconnect.
      if (source.readyState !== EventSource.CLOSED) return;
      api.getJob(jobId).then(
        () => {},
        (reason) => {
          if (reason instanceof ApiError && reason.status === 404) {
            setLost(false);
            latest.current.onDeleted();
          }
        },
      );
    };
    source.addEventListener("ready", (event) => latest.current.onReady(JSON.parse(event.data).candidates));
    source.addEventListener("candidate", (event) => {
      const saved: CandidateEvent = JSON.parse(event.data);
      if (saved.tab !== TAB_ID) latest.current.onCandidate(saved);
    });
    source.addEventListener("removed", (event) => latest.current.onRemoved(JSON.parse(event.data).id));
    source.addEventListener("fonts", () => void reloadFonts().catch(() => {}));
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
  unknown: "Elsewhere",
  original: "Original",
};

// Who saved a change, as an editor shows it: the same editor as this one, in another tab, is that tab.
export function savedByLabel(source: SavedBy, tab: string | null, here: EditSource): string {
  return source === here && tab !== TAB_ID ? "Another tab" : SAVED_BY[source];
}

// What a notice of a change from elsewhere says.
export function changedText(source: SavedBy, parts: string[], here: EditSource): string {
  const what = parts.length ? parts.join(", ") : "this clip";
  return source === "unknown" ? `Changed elsewhere: ${what}` : `${savedByLabel(source, null, here)} changed ${what}`;
}
