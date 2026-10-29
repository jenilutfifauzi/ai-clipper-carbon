import type { AgentUi } from "../../../../api";
import type { AgentTurnView } from "./agentStream";

type Choices = Extract<AgentUi, { kind: "choices" }>;

/**
 * The choices waiting for the owner: the last `choices` Agent UI of the Thread's latest turn, once
 * that turn has finished; null while it runs, when it offered none, and so once a turn follows it.
 */
export function openChoices(turns: AgentTurnView[]): { call: string; ui: Choices } | null {
  const last = turns.at(-1);
  if (!last || last.stop === null) return null;
  for (const part of [...last.parts].reverse()) {
    if (part.type === "tool" && part.ui?.kind === "choices") return { call: part.call, ui: part.ui };
  }
  return null;
}

/** What a key does in the pop up: highlight a row, send an option, go to "Something else…", or close. */
export type ChoiceAction = { active: number } | { send: number } | { other: true } | { close: true };

/**
 * The pop up's keys, Claude Code's: the digit of an option sends it (the one after the last goes to
 * "Something else…", the row at `count`); ↑ and ↓ move the highlight round the rows; Enter sends the
 * highlighted option, or goes to "Something else…"; Escape closes. Null for any other key.
 */
export function choiceKey({ active, count }: { active: number; count: number }, key: string): ChoiceAction | null {
  const rows = count + 1;
  if (/^[1-9]$/.test(key)) {
    const index = Number(key) - 1;
    return index < count ? { send: index } : index === count ? { other: true } : null;
  }
  switch (key) {
    case "ArrowDown":
      return { active: (active + 1) % rows };
    case "ArrowUp":
      return { active: (active - 1 + rows) % rows };
    case "Enter":
      return active < count ? { send: active } : { other: true };
    case "Escape":
      return { close: true };
    default:
      return null;
  }
}
