# 01: One gesture is one step of undo

**Parent spec:** `spec.md` in this feature folder (user stories 29, 40; Implementation Decisions "Undo: one gesture is one step").

**What to build:** a drag on the Advanced Edit's Timeline (move, trim, and later the Volume Line and fade handles) undoes as one step however long the owner holds it, even with a pause mid-drag. Today a pause of more than 1.5 s splits it into two steps.

- **The merge rule becomes a pure function** of the edit history: the last group and its time, plus the new group and its time, give merge or new step. The history uses it.
- **A group that names one gesture** (the Timeline's drags, unique per gesture) merges for as long as it keeps coming, with no time limit.
- **Other groups,** such as the inspector's sliders per item and field and arrow-key moves, keep the 1500 ms window.
- **No group** never merges, as today.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam E (vitest), worked examples:
  - a gesture group merges across a 2-second pause;
  - a slider group splits after 1500 ms;
  - two different groups never merge;
  - no group never merges.
- [ ] Dragging a Segment's edge slowly, pausing for 2 s while holding, then releasing undoes with one Cmd+Z.
- [ ] Inspector sliders and arrow-key moves undo as before.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
