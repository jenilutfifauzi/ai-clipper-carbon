import { useCallback, useEffect, useState } from "react";
import { jobEventsUrl, type JobProgress, type JobStatus } from "../api";

// How a Job's event stream ended: settled in review or error, or the Job was deleted.
export type StreamEnd = Extract<JobStatus, "review" | "error"> | "deleted";

/**
 * The Job's live progress from its server-sent events. The stream ends once the Job settles in
 * review or error; `reconnect()` opens it again, e.g. after a retry. When the connection drops,
 * EventSource reconnects by itself; `lost` is true until it has.
 */
export function useJobEvents(jobId: string) {
  const [progress, setProgress] = useState<JobProgress | null>(null);
  const [ended, setEnded] = useState<StreamEnd | null>(null);
  const [lost, setLost] = useState(false);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const source = new EventSource(jobEventsUrl(jobId));
    setEnded(null);
    source.onopen = () => setLost(false);
    source.onerror = () => setLost(true);
    source.addEventListener("job", (event) => setProgress(JSON.parse(event.data)));
    source.addEventListener("end", (event) => {
      source.close();
      setLost(false);
      setEnded(JSON.parse(event.data));
    });
    return () => source.close();
  }, [jobId, session]);

  const reconnect = useCallback(() => setSession((n) => n + 1), []);
  return { progress, ended, lost, reconnect };
}
