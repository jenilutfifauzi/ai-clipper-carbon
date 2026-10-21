# 08: The Effects tab

**Parent spec:** `../spec.md` ("Solution", "Effects tab", "Editor actions"); ADR 0014.

**What to build:** a new Effects tab in the Asset Panel, beside the Filters tab and like it.
- **Cards:** Video Effect cards by category, with a search. Each card shows the frame at the playhead with its effect at its defaults, drawn by the same SVG imitation as the preview.
- **Hover:** hovering a card tries the effect on the preview, on the Pick, or on the whole frame with nothing picked. Leaving the card takes it off. Hovering is never saved and never undone.
- **Click:** adds the effect to the Pick's stacks, with the same rules as "Add effect":
  - an item that already has the effect is skipped;
  - a Cutout effect is skipped on a Segment or an Adjustment Layer.
- **Drag onto the Timeline:** makes an Adjustment Layer at the drop point, with a neutral Grade and that effect, as dropping a Look does. A Cutout card can't be dropped there.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] The tab lists every catalogue video effect by category, and the search filters them.
- [ ] Each card shows the playhead frame with its effect.
- [ ] Hovering a card shows the effect on the preview and leaves no change in the Candidate or the undo history.
- [ ] A click adds the effect to the picked items as one step of undo, skipping duplicates and Cutout on Segments.
- [ ] Dropping a card on the Timeline makes an Adjustment Layer carrying the effect.
- [ ] Vitest: the drop action makes the Adjustment Layer, and the click action follows the skipping rules.
