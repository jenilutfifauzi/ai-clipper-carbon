import type { SavedBy } from "../../../../api";

// The tab the Agent's saves name during a turn (ADR 0028): `agent:<turn>`.
const TURN_TAB = "agent:";

/**
 * How the Advanced Edit takes a new Revision (ADR 0028): the undo group to adopt it under — a
 * Revision the Agent saved for a turn this tab started (`own`), as `agent:<turn>:<revision>` — or
 * null, for every other Revision, which goes through `elsewhere` as before.
 */
export function adoptionGroup(saved: { source: SavedBy; tab: string | null; revision: number }, own: ReadonlySet<string>): string | null {
  if (saved.source !== "agent" || !saved.tab?.startsWith(TURN_TAB)) return null;
  const turn = saved.tab.slice(TURN_TAB.length);
  return own.has(turn) ? `${saved.tab}:${saved.revision}` : null;
}
