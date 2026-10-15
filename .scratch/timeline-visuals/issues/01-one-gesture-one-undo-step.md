# 01: One gesture is one step of undo

**Parent spec:** `spec.md` in this feature folder (user stories 29, 40; Implementation Decisions "Undo: one gesture is one step").

**What to build:** a drag on the Advanced Edit's Timeline (move, trim, and later the Volume Line and fade handles) undoes as one step however long the owner holds it, even with a pause mid-drag. Today a pause of more than 1.5 s splits it into two steps.

- **The merge rule becomes a pure function** of the edit history: the last group and its time, plus the new group and its time, give merge or new step. The history uses it.
- **A group that names one gesture** (the Timeline's drags, unique per gesture) merges for as long as it keeps coming, with no time limit.
- **Other groups,** such as the inspector's sliders per item and field and arrow-key moves, keep the 1500 ms window.
- **No group** never merges, as today.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam E (vitest), worked examples:
  - [x] a gesture group merges across a 2-second pause;
  - [x] a slider group splits after 1500 ms;
  - [x] two different groups never merge;
  - [x] no group never merges.
- [ ] Dragging a Segment's edge slowly, pausing for 2 s while holding, then releasing undoes with one Cmd+Z.
- [ ] Inspector sliders and arrow-key moves undo as before.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-15: done.** Built as specified. The rule is `merges` beside the edit history (`useEditHistory.ts`, tested in `useEditHistory.test.ts`): a group starting `drag:` names one gesture and merges with no time limit; any other group keeps the 1500 ms window. The Timeline's drags were already `drag:<n>`; the preview's stage drags and Overlay drags, also one per gesture, are now `drag:stage-<kind>:<n>` and `drag:overlay:<n>`, so a pause while holding them is one step too. Arrow-key moves and nudges (`key:…`, `stage-nudge:…`) and the inspector's sliders keep the window. Not tried in the browser: the slow trim with a 2 s pause, and sliders and arrow keys undoing as before, are left for the walkthrough (09).
