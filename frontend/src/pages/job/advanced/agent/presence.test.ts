// .scratch/agent-mode/issues/09-presence-timeline.md (ADR 0029): the presence store, driven by the Agent's
// events and by the diffs of its Revisions: its status, the cursor's target, and the pulsing and
// flashing ids, whose timers are its own (fake timers here).
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { FLASH_MS, IDLE_AFTER_MS, presenceStore } from "./presence";
import type { Touched } from "./touched";

const started = { type: "turn_started", turn: "t1", tab: "tab", provider: "deepseek", model: null, prompt: "Hi" } as const;
const toolStarted = { type: "tool_started", turn: "t1", call: "c1", tool: "edit_candidate", summary: "" } as const;
const toolFinished = { type: "tool_finished", turn: "t1", call: "c1", ok: true, revision: 4 } as const;
const finished = { type: "turn_finished", turn: "t1", stop: "end_turn" } as const;

const touched: Touched = {
  items: [
    { kind: "text_layers", id: "t1", how: "added" },
    { kind: "music", id: "m1", how: "removed" },
    { kind: "segments", id: "s2", how: "changed" },
  ],
  flags: ["grade"],
};
const target = { kind: "text_layers", id: "t1", time: 4 } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("presenceStore", () => {
  test("a turn's events go thinking, editing, thinking, then idle a moment after it ends", () => {
    const presence = presenceStore();
    expect(presence.getSnapshot().status).toBe("idle");
    presence.heard(started);
    expect(presence.getSnapshot()).toMatchObject({ status: "thinking", label: "deepseek" });
    presence.heard(toolStarted);
    expect(presence.getSnapshot().status).toBe("editing");
    presence.heard(toolFinished);
    expect(presence.getSnapshot().status).toBe("thinking");
    presence.heard(finished);
    expect(presence.getSnapshot().status).toBe("thinking");
    vi.advanceTimersByTime(IDLE_AFTER_MS);
    expect(presence.getSnapshot().status).toBe("idle");
  });

  test("a new turn before the idle keeps it present", () => {
    const presence = presenceStore();
    presence.heard(started);
    presence.heard(finished);
    presence.heard({ ...started, turn: "t2" });
    vi.advanceTimersByTime(IDLE_AFTER_MS);
    expect(presence.getSnapshot().status).toBe("thinking");
  });

  test("the provider is called by its name once named", () => {
    const presence = presenceStore();
    presence.named({ deepseek: "DeepSeek" });
    presence.heard(started);
    expect(presence.getSnapshot().label).toBe("DeepSeek");
  });

  test("a Revision flashes what it added or changed for FLASH_MS, and the cursor goes to the first", () => {
    const presence = presenceStore();
    presence.revised(touched, target);
    expect([...presence.getSnapshot().flashing]).toEqual(["t1", "s2"]);
    expect(presence.getSnapshot().target).toEqual(target);
    expect(presence.markOf("t1")).toBe("flash");
    expect(presence.markOf("m1")).toBeNull();
    vi.advanceTimersByTime(FLASH_MS - 1);
    expect(presence.markOf("s2")).toBe("flash");
    vi.advanceTimersByTime(1);
    expect(presence.getSnapshot().flashing.size).toBe(0);
    expect(presence.markOf("s2")).toBeNull();
    // The cursor stays where the Agent was.
    expect(presence.getSnapshot().target).toEqual(target);
  });

  test("a Revision touching nothing with a place leaves the cursor where it was", () => {
    const presence = presenceStore();
    presence.revised(touched, target);
    presence.revised({ items: [], flags: ["grade"] }, null);
    expect(presence.getSnapshot().target).toEqual(target);
  });

  test("while a tool runs, the items the last Revision touched pulse", () => {
    const presence = presenceStore();
    presence.heard(started);
    presence.revised(touched, target);
    vi.advanceTimersByTime(FLASH_MS);
    presence.heard(toolStarted);
    expect(presence.markOf("t1")).toBe("pulse");
    expect(presence.markOf("s2")).toBe("pulse");
    presence.heard(toolFinished);
    expect(presence.markOf("t1")).toBeNull();
  });

  test("a flash wins over a pulse", () => {
    const presence = presenceStore();
    presence.revised(touched, target);
    presence.heard(toolStarted);
    expect(presence.markOf("t1")).toBe("flash");
  });

  test("listeners hear each change; a mark that stays the same is the same snapshot", () => {
    const presence = presenceStore();
    const heard = vi.fn();
    const stop = presence.subscribe(heard);
    presence.heard(started);
    expect(heard).toHaveBeenCalledTimes(1);
    const before = presence.getSnapshot();
    expect(presence.getSnapshot()).toBe(before);
    stop();
    presence.heard(toolStarted);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  test("a reconnection with no turn running ends the presence", () => {
    const presence = presenceStore();
    presence.heard(started);
    presence.heard({ type: "ready", running: {} });
    expect(presence.getSnapshot().status).toBe("idle");
  });
});
