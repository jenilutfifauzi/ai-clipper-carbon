import { describe, expect, it } from "vitest";
import type { JobProgress, JobStatus } from "./api";
import { stageIndex, stageStates } from "./stages";

function progress(status: JobStatus, stage: JobStatus | null): JobProgress {
  return { status, stage, progress: null, message: null, error: null, warnings: [], retry_at: null };
}

describe("stageStates", () => {
  it("marks the stage a stopped Job stopped in, after the ones it finished", () => {
    expect(stageStates(progress("stopped", "analyzing"), stageIndex("analyzing"))).toEqual([
      "done", "done", "stopped", "pending", "pending",
    ]);
  });

  it("keeps the finished stages of a Job stopped in the queue", () => {
    expect(stageStates(progress("stopped", null), stageIndex("analyzing"))).toEqual([
      "done", "done", "pending", "pending", "pending",
    ]);
  });
});
