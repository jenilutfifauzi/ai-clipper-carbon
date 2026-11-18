import { useEffect, useState } from "react";
import { api, type Job, type Machine } from "./api";

// This machine (backend/app/machine.py; ADR 0033), asked once for the page: null where every Job's
// media are on it, and when it couldn't be asked.
let asked: Promise<Machine | null> | null = null;

/** This machine, null until it is known. */
export function useMachine(): Machine | null {
  const [machine, setMachine] = useState<Machine | null>(null);
  useEffect(() => {
    let shown = true;
    void (asked ??= api.machine().catch(() => null)).then((known) => {
      if (shown) setMachine(known);
    });
    return () => {
      shown = false;
    };
  }, []);
  return machine;
}

/** The name of the machine that has the Job's media, when that is another than `machine`; null when they are here. */
export function elsewhere(job: Pick<Job, "host">, machine: Machine | null): string | null {
  return job.host && machine && job.host.id !== machine.id ? job.host.name : null;
}
