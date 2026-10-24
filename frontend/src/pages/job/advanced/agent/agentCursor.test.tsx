// .scratch/agent-mode/issues/09-presence-timeline.md: the Agent's cursor on the Timeline, read from a
// seeded presence store. No jsdom: the markup is checked with renderToStaticMarkup.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { AgentCursor } from "./AgentCursor";
import { IDLE, PresenceContext, presenceStore, type PresenceState } from "./presence";

const drawn = (state: PresenceState) =>
  renderToStaticMarkup(createElement(PresenceContext.Provider, { value: presenceStore(state) }, createElement(AgentCursor, { pps: 10 })));

describe("AgentCursor", () => {
  test("draws nothing while the Agent is idle", () => {
    expect(drawn(IDLE)).toBe("");
  });

  test("names the provider, thinking between tool calls", () => {
    expect(drawn({ ...IDLE, status: "thinking", label: "DeepSeek" })).toContain("DeepSeek · thinking…");
  });

  test("names the provider alone while editing, at its target's time", () => {
    const html = drawn({ ...IDLE, status: "editing", label: "DeepSeek", target: { kind: "text_layers", id: "t1", time: 4 } });
    expect(html).toContain("DeepSeek");
    expect(html).not.toContain("thinking");
    expect(html).toContain("translate3d(40px");
  });
});
