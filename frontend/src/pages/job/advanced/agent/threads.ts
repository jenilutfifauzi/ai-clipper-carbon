import { useCallback, useEffect, useState } from "react";
import { api, type AgentThread } from "../../../../api";

/**
 * A Candidate's Agent Threads (ADR 0030): its chats with the Agent, listed most recently used first,
 * and the one this browser has open, remembered per Candidate.
 */

const storageKey = (jobId: string, candidateId: string) => `agent-thread:${jobId}:${candidateId}`;

/** The Thread this browser last had open on the Candidate; null when none is, or storage is unavailable. */
export function rememberedThread(jobId: string, candidateId: string): string | null {
  try {
    return localStorage.getItem(storageKey(jobId, candidateId));
  } catch {
    return null;
  }
}

export function rememberThread(jobId: string, candidateId: string, thread: string): void {
  try {
    localStorage.setItem(storageKey(jobId, candidateId), thread);
  } catch {
    // Not remembered; still open.
  }
}

/** The Thread to show: `chosen` while it is listed, else the newest. */
export function pickThread(threads: AgentThread[], chosen: string | null): AgentThread | null {
  return threads.find((thread) => thread.id === chosen) ?? threads[0] ?? null;
}

/** The Threads whose title holds `query`, any case; all of them for an empty one. */
export function matchingThreads(threads: AgentThread[], query: string): AgentThread[] {
  const words = query.trim().toLowerCase();
  return words ? threads.filter((thread) => thread.title.toLowerCase().includes(words)) : threads;
}

export interface AgentThreads {
  // Most recently used first; null until listed.
  threads: AgentThread[] | null;
  // The one open; null until listed.
  active: AgentThread | null;
  // What failed last (listing, making, renaming or deleting).
  error: string | null;
  select: (thread: string) => void;
  // Makes a Thread and opens it.
  create: () => Promise<void>;
  rename: (thread: string, title: string) => Promise<void>;
  // The newest opens in place of a deleted open one; a fresh one is made when none is left.
  remove: (thread: string) => Promise<void>;
  // Lists them again: a finished turn reorders them, and titles a new one. Stable.
  refresh: () => void;
}

/** The Candidate's Threads, listed now and on `refresh`. One per editor, beside its Agent stream. */
export function useAgentThreads(jobId: string, candidateId: string): AgentThreads {
  const [threads, setThreads] = useState<AgentThread[] | null>(null);
  const [chosen, setChosen] = useState(() => rememberedThread(jobId, candidateId));
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.agentThreads(jobId, candidateId).then(
      (listed) => {
        setThreads(listed);
        setError(null);
      },
      (reason) => setError(reason instanceof Error ? reason.message : "Couldn't list the chats"),
    );
  }, [jobId, candidateId]);
  useEffect(refresh, [refresh]);

  const select = useCallback(
    (thread: string) => {
      setChosen(thread);
      rememberThread(jobId, candidateId, thread);
    },
    [jobId, candidateId],
  );

  const failed = (what: string) => (reason: unknown) => setError(reason instanceof Error ? reason.message : `Couldn't ${what}`);
  const create = () =>
    api.createAgentThread(jobId, candidateId).then((made) => {
      setThreads((listed) => [made, ...(listed ?? [])]);
      select(made.id);
      setError(null);
    }, failed("start a chat"));
  const rename = (thread: string, title: string) =>
    api.renameAgentThread(jobId, candidateId, thread, title).then((renamed) => {
      setThreads((listed) => listed?.map((each) => (each.id === thread ? renamed : each)) ?? null);
      setError(null);
    }, failed("rename the chat"));
  const remove = (thread: string) => api.deleteAgentThread(jobId, candidateId, thread).then(refresh, failed("delete the chat"));

  return { threads, active: threads && pickThread(threads, chosen), error, select, create, rename, remove, refresh };
}
