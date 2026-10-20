import { useEffect, useState } from "react";
import { api, type CandidateChange, type PreviewPlan } from "../../../api";

// A draft is planned once it has stopped changing for this long.
const PLAN_AFTER_MS = 250;

/**
 * The Candidate's Preview Plan for `draft` (its edits, saved or not), planned by the backend
 * (docs/adr/0001-backend-plans-frontend-draws.md) once the draft settles. The last plan stays
 * while the next is on its way. `refresh` plans again when it changes, e.g. after a preparation.
 * `planned` is the draft the plan shown was made of (what its Effected copies are asked for with).
 */
export function usePreviewPlan(jobId: string, candidateId: string, draft: CandidateChange, refresh: unknown) {
  const [preview, setPreview] = useState<PreviewPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [planned, setPlanned] = useState<CandidateChange | null>(null);
  const key = JSON.stringify(draft);

  useEffect(() => {
    const controller = new AbortController();
    const wait = setTimeout(() => {
      api.previewPlan(jobId, candidateId, JSON.parse(key) as CandidateChange, controller.signal).then(
        (plan) => {
          setPreview(plan);
          setPlanned(JSON.parse(key) as CandidateChange);
          setError(null);
        },
        (reason: Error) => {
          if (reason.name !== "AbortError") setError(reason.message);
        },
      );
    }, PLAN_AFTER_MS);
    return () => {
      clearTimeout(wait);
      controller.abort();
    };
  }, [jobId, candidateId, key, refresh]);

  // Another Candidate's plan isn't shown while this one's comes.
  useEffect(() => setPreview(null), [candidateId]);
  return { preview, error, planned };
}
