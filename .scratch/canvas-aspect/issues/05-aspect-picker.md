# 05: The aspect picker in the Advanced Edit

**Parent spec:** `../spec.md` (Implementation Decisions "Frontend": the aspect picker; User Stories 5–9, 55–57).

**What to build:** above the Advanced Edit's player, a small segmented control with a shape icon and label per aspect (9:16, 4:5, 1:1, 16:9). It shows the Candidate's aspect and changes it.
- **Choosing an aspect:**
  1. saves the pending draft, if any;
  2. sends the aspect edit;
  3. loads the returned Revision, so the stage takes the new shape with the rescaled positions.
- **Undo** restores the earlier Revision, with the old aspect and positions.
- **The Revision History** lists the change as its own step.
- **Another tab** with the same Candidate gets the new Revision through live sync.
- **On a phone,** the layout keeps its structure, and the player shrinks to fit a wide Canvas.
- The picker is keyboard reachable and labelled.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] vitest: the picker saves a pending draft before sending the aspect, and sends nothing when the current aspect is picked again.
- [ ] Browser walkthrough (desktop and phone):
  - 9:16 → 16:9 → undo on a Candidate with a Text Layer, an Overlay and a media Segment;
  - the stage shape, the positions and the Revision History are right.
- [ ] `npm run typecheck && npm run build` pass.
