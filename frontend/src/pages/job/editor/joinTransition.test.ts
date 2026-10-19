// The Join Transition rule, on the cases the backend's tests read too
// (backend/tests/fixtures/join_transitions.json), so that the two can't drift.
import { describe, expect, test } from "vitest";
import type { JoinTransition, Transition } from "../../../api";
import cases from "../../../../../backend/tests/fixtures/join_transitions.json";
import { withJoinTransition } from "./joinTransition";

describe("every new join without a Transition gets the Join Transition", () => {
  for (const { name, before, after, transitions, expected, ...rest } of cases.cases) {
    const join = ("join" in rest ? rest.join : cases.join) as JoinTransition | null;
    test(`${name}: as the shared cases say`, () => {
      expect(withJoinTransition(before, after, transitions as Transition[], join)).toEqual(expected);
    });
  }
});
