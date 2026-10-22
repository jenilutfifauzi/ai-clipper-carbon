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

**Status:** done

- [x] vitest: the picker saves a pending draft before sending the aspect, and sends nothing when the current aspect is picked again.
- [ ] Browser walkthrough (desktop and phone):
  - 9:16 → 16:9 → undo on a Candidate with a Text Layer, an Overlay and a media Segment;
  - the stage shape, the positions and the Revision History are right.
- [x] `npm run typecheck && npm run build` pass.

## Comments

**2026-10-21 (implementation):** `advanced/AspectPicker.tsx` holds the picker and `changeAspect`, the change's steps. `changeAspect` does nothing when the Candidate's aspect is picked again. Otherwise it saves the waiting edits first and then sends the aspect alone.
- **The picker** is a `role="group"` labelled "Canvas aspect", with one button per aspect. Each button has a box of the aspect's shape and its label (9:16, 4:5, 1:1, 16:9), and the Candidate's aspect is `aria-pressed`. Each also has a spoken and hover name (for example "Landscape 16:9 (YouTube, X)").
  - I used buttons, not radios, so that arrowing through them doesn't send a change (and a lossy rescale) for each aspect passed.
  - While a change is being saved, the group is `aria-busy` and the buttons are `aria-disabled`, not `disabled`, so keyboard focus stays where it was.
  - It looks like `Segmented`: a `bg-fill` track with the chosen button `raised`. No new dependencies.
- **AdvancedEdit** puts it above the player in both the desktop and the phone layouts, and hides it in full screen. On a phone the layout keeps its structure, and the player already fits a wide Canvas (02).
  - `pickAspect` is refused while a Take records, as any hand edit is.
  - It flushes the edit history and waits for the save queue, then PATCHes `{aspect, revision}` as "advanced-edit".
  - It takes the answer through `incoming(…, "reshaped")`, a new `Taken` that, like a Restore, takes the new Revision without a notice.
  - A stale-Revision refusal or any other failure shows a notice.
  - The Revision History lists the change as its own step (part "Layout"). Restoring the Revision before it undoes it (04 makes a Restore exact). Other tabs get it through the existing live sync.
- **Canvas before a plan:** `canvas.ts` gained `CANVASES` (the four Canvases and Safe Areas, as canvas.py makes them) and `canvasOf(plan, aspect?)`/`useCanvasOf(plan, aspect?)`, which fall back to the aspect's Canvas. The Advanced Edit passes `candidate.aspect`.
  - Ticket 08's branch adds the same `canvasOf`/`useCanvasOf(plan, aspect)` signature and an `aspect` prop on ClipPreview. Once 08 has merged, the Advanced Edit's ClipPreview should also get `aspect={candidate.aspect}`. This branch doesn't add the prop, to avoid a second copy of it.

Tests: new `advanced/aspectPicker.test.tsx`. It checks that the change flushes before it sends, that picking the same aspect sends nothing, that a failed flush sends nothing, and the picker's labelled, pressed and busy markup (renderToStaticMarkup, as there is no jsdom). `editor/canvas.test.ts` gained the aspect fallback. vitest over `src/pages/job` (1523) passes, and `npm run typecheck` and `npm run build` (1544 tests) pass.

Not done: the browser walkthrough (desktop and phone; second box) wasn't run.
