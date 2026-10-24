// .scratch/agent-mode/issues/08 (ADR 0028): which Revisions the Advanced Edit adopts as undo steps.
// A Revision the Agent saved for a turn this tab started is adopted, with a group of its own; every
// other goes through `elsewhere`.
import { describe, expect, test } from "vitest";
import { adoptionGroup } from "./adoption";

const own = new Set(["t1"]);

describe("adoptionGroup", () => {
  test("the Agent's Revision for a turn this tab started is adopted, grouped by turn and Revision", () => {
    expect(adoptionGroup({ source: "agent", tab: "agent:t1", revision: 7 }, own)).toBe("agent:t1:7");
  });

  test("the Agent's Revision for another tab's turn goes elsewhere", () => {
    expect(adoptionGroup({ source: "agent", tab: "agent:t2", revision: 7 }, own)).toBeNull();
  });

  test("a Revision from any other source goes elsewhere, whatever its tab says", () => {
    expect(adoptionGroup({ source: "advanced-edit", tab: "agent:t1", revision: 7 }, own)).toBeNull();
    expect(adoptionGroup({ source: "restore", tab: "agent:t1", revision: 7 }, own)).toBeNull();
    expect(adoptionGroup({ source: "unknown", tab: null, revision: 7 }, own)).toBeNull();
  });

  test("an Agent Revision without a turn's tab goes elsewhere", () => {
    expect(adoptionGroup({ source: "agent", tab: null, revision: 7 }, own)).toBeNull();
    expect(adoptionGroup({ source: "agent", tab: "t1", revision: 7 }, own)).toBeNull();
  });
});
