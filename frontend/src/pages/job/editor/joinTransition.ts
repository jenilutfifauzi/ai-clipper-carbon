import type { JoinTransition, Transition } from "../../../api";

/**
 * The Join Transition rule (GLOSSARY): `transitions`, as a change of the Main Track from Segment ids
 * `before` to `after` left them, then a copy of the Style Preset's Join Transition `join` on each join
 * (a pair of adjacent Segments) there after and not before that has no Transition, in Main Track
 * order. The backend's twin is with_join_transition in backend/app/candidates.py; both read
 * backend/tests/fixtures/join_transitions.json.
 */
export function withJoinTransition(before: string[], after: string[], transitions: Transition[], join: JoinTransition | null): Transition[] {
  if (!join) return transitions;
  const old = new Set(before.slice(1).map((second, i) => `${before[i]}\n${second}`));
  const has = new Set(transitions.map((transition) => transition.after));
  const added = after
    .slice(1)
    .flatMap((second, i) => (old.has(`${after[i]}\n${second}`) || has.has(after[i]) ? [] : [{ after: after[i], ...join }]));
  return added.length ? [...transitions, ...added] : transitions;
}
