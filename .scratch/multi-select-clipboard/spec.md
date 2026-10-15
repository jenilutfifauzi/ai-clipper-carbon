# Multi-select and clipboard in the Advanced Edit

Status: done
Created: 2026-10-15

## Problem Statement

In the Advanced Edit the owner can pick only one item at a time. Each action works on that one item: delete, duplicate, split, move with the arrow keys, and edits in the inspector.

- Tidying a Clip means repeating the same step for every item. Examples: removing five stray Text Layers, shifting a title and its Music Clip together, or giving six Text Layers the same font.
- There is no way to copy items. An intro is a Segment with its title and a whoosh, or a lower-third that should appear in every Candidate of an episode. The owner has to rebuild it by hand in each Candidate.
- Most of the time, Selection makes several Candidates from one Job, and they want the same treatment. That makes the cost above much higher.
- The reference editor (Concat) has all of this: Shift- and Cmd-click, a rubber band, select all, copy and paste that keep the group's shape, moving a group as one, and editing several titles at once.

## Solution

The Advanced Edit gets a **Pick** of one or more items and a **Clipboard** (see GLOSSARY.md).

**Building a Pick on a desktop**
- **Click:** picks one item.
- **Shift-, Cmd- or Ctrl-click:** adds an item to the Pick or removes it, on the Timeline and on the preview.
- **Dragging on empty lane space:** draws a rubber band. It picks every Segment, Text Layer, Music Clip and Overlay it touches, across tracks. Shift adds to the Pick.
- **Scrubbing** moves to the ruler. A click on empty lane space still moves the playhead and empties the Pick.
- **Cmd+A:** picks every Segment, Text Layer, Music Clip and Overlay.
- **Esc:** empties the Pick.

**Building a Pick on a phone**
- A **Pick** button in the toolbar starts picking mode. In that mode each tap adds or removes an item.
- The bottom bar shows "N picked" with Delete, Duplicate, Copy and Paste.
- A long press still lifts an item to drag it.

**What can be picked together**
- Segments, Text Layers, Music Clips and Overlays mix freely.
- The hook, the captions and a join are always picked alone.

**Acting on the Pick (each action is one undo step)**
- **Delete** removes every picked item. It never empties the Main Track: when every Segment is picked, the first stays.
- **Duplicate** puts a copy of the group right after it, keeping its shape. Picked Segments are copied as a block after the last picked Segment.
- **Split** cuts every picked item the playhead is inside.
- **Dragging, or the arrow keys,** move every picked Text Layer, Music Clip and Overlay by the same time. A Segment dragged is reordered on its own. Trimming works on one item.
- **On the preview,** each picked item is outlined, and dragging one moves every picked item on screen together. The resize corner shows only when one item is picked.

**Copy, cut and paste**
- **Cmd+C copies, Cmd+X cuts, Cmd+V pastes.** The Timeline's bar on a desktop also gets Copy and Paste buttons.
- **The Clipboard** lives in the browser tab. It pastes into this Candidate, another Candidate of this Job, or a Candidate of another Job.
- **Where a paste lands:**
  - Segments are inserted at the join nearest the playhead, in order, with the Transitions between them. The Segments after them move later.
  - Text Layers, Music Clips and Overlays keep their times relative to the group, starting from the same point. When there are no Segments, that point is the playhead.
  - What would run past the Clip's end is trimmed or skipped, and a notice says so.
  - The pasted items become the Pick.
- **Across Candidates and Jobs:**
  - A Source Segment pasted into another Candidate of the same Job brings the caption corrections and Layout choices of its range, unless the Candidate already has its own there.
  - In another Job, Source Segments are skipped with a notice. Media Library items paste anywhere.

**The inspector with several items picked**
- **Text Layers only:** it shows "Editing N layers". Fields where they agree show the shared value, and fields where they differ show "Mixed". A change sets the value on all of them. The words and the position aren't shown.
- **Any other mix:** it shows a summary ("5 items: 2 Segments, 2 Text Layers, 1 Music Clip") with Delete, Duplicate and Copy.

## User Stories

1. As the owner, I want to Shift-click a second Text Layer on the Timeline, so that both are picked.
2. As the owner, I want to Cmd- or Ctrl-click an item to add it to the Pick or remove it, so that I can build a Pick from items far apart.
3. As the owner, I want a plain click to pick only the clicked item, so that I can leave a Pick quickly.
4. As the owner, I want to drag a rubber band over empty lane space, so that I can pick every item it touches in one gesture.
5. As the owner, I want the rubber band to span several tracks, so that I can pick a title, its Music Clip and the Segment under them together.
6. As the owner, I want the rubber band to pick items that it only partly touches, so that I needn't cover an item end to end.
7. As the owner, I want Shift while dragging a rubber band to add to the Pick, so that I can extend it.
8. As the owner, I want to scrub by dragging on the ruler, so that I can still scrub now that lane space draws a rubber band.
9. As the owner, I want a click on empty lane space to move the playhead and empty the Pick, so that clicking away works as it does elsewhere.
10. As the owner, I want Cmd+A to pick every Segment, Text Layer, Music Clip and Overlay, so that I can act on the whole Clip.
11. As the owner, I want Esc to empty the Pick, so that keys like Delete can't touch items I forgot were picked.
12. As the owner, I want picking the hook, the captions or a join to replace the Pick, so that their own panels stay simple.
13. As the owner, I want to see every picked item highlighted on the Timeline, so that I know what an action will touch.
14. As the owner, I want Delete to remove every picked item in one undo step, so that one Cmd+Z brings them all back.
15. As the owner, I want Delete never to leave the Main Track empty, so that the Clip keeps a picture. The first Segment stays, picked, and a notice says why.
16. As the owner, I want Cmd+D to duplicate the picked group right after itself, so that I can repeat a sequence.
17. As the owner, I want duplicated Segments to land as a block after the last picked Segment, so that their order is kept.
18. As the owner, I want the duplicates to become the Pick, so that I can move them at once.
19. As the owner, I want Cmd+B to split every picked item the playhead is inside, so that I can cut a title and its music at the same moment.
20. As the owner, I want the right-hand parts after a split to become the Pick, so that I can act on them next.
21. As the owner, I want dragging one picked Text Layer to move every picked Text Layer, Music Clip and Overlay by the same amount, so that a group keeps its timing.
22. As the owner, I want a group drag to stop at the Clip's start and end, so that no item leaves the Clip.
23. As the owner, I want the arrow keys to move every picked layer item, so that I can nudge a group precisely.
24. As the owner, I want dragging a picked Segment to reorder only that Segment, so that the Main Track's order changes as it always has.
25. As the owner, I want trimming to stay a single-item gesture, so that dragging an edge never resizes items I didn't grab.
26. As the owner, I want each picked Text Layer and Overlay on screen to be outlined on the preview, so that I see which ones are picked.
27. As the owner, I want dragging one picked item on the preview to move every picked item on screen, so that a title and its sticker stay aligned.
28. As the owner, I want the preview's resize corner only when one item is picked, so that resizing is never ambiguous.
29. As the owner, I want Shift- or Cmd-click on the preview to add an item to the Pick or remove it, so that I can pick on the picture as well as on the Timeline.
30. As the owner, I want Cmd+C to copy the Pick, so that I can paste it elsewhere.
31. As the owner, I want Cmd+X to copy and remove the Pick in one undo step, so that I can move items through the Clipboard.
32. As the owner, I want Cmd+V to paste the Clipboard's group with the same spacing between its items, so that a sequence I built stays intact.
33. As the owner, I want pasted Segments inserted at the join nearest the playhead, so that the Main Track stays back to back and no Segment is cut.
34. As the owner, I want the Transitions between pasted Segments to come with them, so that a copied sequence looks the same.
35. As the owner, I want pasted layer items placed from the same point as pasted Segments, keeping their offsets, so that a title stays over its Segment.
36. As the owner, I want a Clipboard without Segments pasted at the playhead, so that I control where it lands.
37. As the owner, I want items that would run past the Clip's end trimmed, or skipped when they would start past it, with a notice, so that a paste never makes invalid items.
38. As the owner, I want the pasted items to become the Pick, so that I can nudge them right away.
39. As the owner, I want a paste to be one undo step, so that one Cmd+Z takes it back.
40. As the owner, I want to copy items in one Candidate and paste them into another Candidate of the same Job, so that each Clip of an episode gets the same intro or lower-third.
41. As the owner, I want Source Segments pasted into another Candidate to bring their range's Word Edits and Layout Overrides, so that my caption corrections and framing come with them.
42. As the owner, I want the target Candidate's own Word Edits and Layout Overrides to win where it has some, so that a paste never undoes corrections there.
43. As the owner, I want to paste Text Layers, Music Clips, Overlays and media Segments into a Candidate of another Job, so that branding carries across episodes.
44. As the owner, I want Source Segments skipped when I paste into another Job, with a notice, so that I never get a Segment of a video that Job doesn't have.
45. As the owner, I want the Clipboard to stay while I move between Candidates and Jobs in the same tab, so that I can copy once and paste many times.
46. As the owner, I want the Paste button and Cmd+V disabled while the Clipboard is empty, so that I can tell there is nothing to paste.
47. As the owner, I want Copy and Paste buttons in the Timeline's bar next to Split, Duplicate and Delete, so that I can find them without knowing the keys.
48. As the owner, I want the inspector to show "Editing N layers" when only Text Layers are picked, so that I can restyle them together.
49. As the owner, I want fields where the picked Text Layers differ to show "Mixed", so that I don't overwrite values by accident.
50. As the owner, I want a change in the multi-layer inspector to apply the same value to every picked Text Layer, so that they match.
51. As the owner, I want the words and the position hidden in the multi-layer inspector, so that I can't give every layer the same text or stack them by mistake.
52. As the owner, I want a mixed Pick to show a summary of what is picked with Delete, Duplicate and Copy, so that the inspector stays useful.
53. As the owner on a phone, I want a Pick button in the toolbar that starts picking mode, so that I can pick several items without a keyboard.
54. As the owner on a phone, I want each tap in picking mode to add an item to the Pick or remove it, so that building a Pick is easy.
55. As the owner on a phone, I want the bottom bar to show "N picked" with Delete, Duplicate, Copy and Paste, so that I can act on the Pick.
56. As the owner on a phone, I want Paste in picking mode whenever the Clipboard holds something, so that I can paste with nothing picked.
57. As the owner on a phone, I want a long press to keep lifting an item to drag it, so that what I already know still works.
58. As the owner on a phone, I want a Done button that leaves picking mode, so that taps pick one item again.
59. As the owner, I want undo and redo to keep picked any items that still exist, so that the Pick doesn't vanish with every undo.
60. As the owner, I want items removed by the agent or another tab to drop out of the Pick, so that no action targets an item that's gone.
61. As the agent, I want nothing in the MCP tools to change, so that my edits through `merge_candidate_items` keep working while the owner uses the Pick.

## Implementation Decisions

**Pick: a new state model.** It replaces the single picked item in the Advanced Edit. It is one of:
- a non-empty set of timed items, each a Segment, Text Layer, Music Clip or Overlay named by kind and id;
- the hook alone;
- the captions alone;
- a join alone;
- nothing.

Helpers on it: add/remove (toggle), replace, prune against the edits (drop ids no longer present), the stage ids picked, and the kinds picked.

**Pick is never saved and never enters the undo history.** After every change of the edits (undo, redo, a merge of a newer Revision, a change from elsewhere), the Pick is pruned to the ids that still exist.

**One module for actions on a Pick** (Seam D). It extends today's single-item actions. It is pure: given the edits, the Pick, the playhead, the Main Track as played, the Clip's duration and the Word gap function, it returns `{ edits, pick, notice? }` or nothing. Its operations:
- **Remove.** Keeps one Segment if all are picked.
- **Duplicate.**
  - Layer items are shifted by the group's span when that fits before the Clip's end. Otherwise each is placed aside, as single duplicates are today.
  - Segments are duplicated as a block, in Main Track order, after the last picked Segment.
- **Split at the playhead.** Each picked item the playhead is inside is cut by its kind's rule. Source Segments are cut in the silence between Words. The tails become the Pick.
- **Move by a time delta.**
  - It moves layer items only.
  - The delta is clamped so that the whole group stays inside the Clip.
- **Select all.**
- **Copy.**
- **Cut:** copy, then remove.
- **Paste.**

Each operation gives one change of the edits, so each is one undo step.

**The Clipboard** is held in module memory, outside React state, so that it outlives the Advanced Edit. It is lost on reload. It holds:
- the Job id it was copied from;
- the copied Segments, in Main Track order, with the Transitions between pairs that were next to each other;
- the copied Text Layers, Music Clips and Overlays, with their times relative to the group's start, which is the earliest picked item's start in Timeline time with Segments as played;
- for each Source Segment, the copying Candidate's Word Edits and Layout Overrides whose `at` lies inside its range.

**Paste rules.**
- **New ids.** Every pasted item gets a new id. Transitions are remapped to the new Segment ids.
- **The anchor.**
  - With Segments in the Clipboard, the anchor is the join nearest the playhead, the Clip's start and end included. The Segments are inserted there.
  - Without Segments, the anchor is the playhead.
  - Layer items start at anchor + their offset.
- **The Clip's end** is taken after the insert:
  - an item that starts at or past it is skipped;
  - an item that crosses it is trimmed to end there, and kept only if it still lasts at least the shortest item length;
  - the notice counts what was trimmed and skipped.
- **Another Job:** Source Segments are skipped (notice), and so are their Transitions. Media Segments and layer items are pasted.
- **Another Candidate of the same Job:** the carried Word Edits and Layout Overrides are added.
  - A Word Edit is skipped when the target already has one on the same Word, by the Job's Transcript.
  - A Layout Override is skipped when the target already has one inside that pasted range of the Source.
- **The same Candidate:** nothing extra is carried, because those edits already apply to any Segment showing their time (ADR 0002).
- **Layer items after an inserted Segment don't move.** This is the same as inserting or duplicating a Segment today. Rippling layers belongs to `track-controls`.

**The Advanced Edit's edits** gain `layout_overrides`, so that a paste can add them and undo can take them back. The merge of a newer Revision (ADR 0003) already treats Layout Overrides as a list keyed by `at`.

**Timeline gestures.**
- **Item clicks:**
  - a plain click picks only the item;
  - Shift, Cmd or Ctrl toggles the item;
  - on the hook, the captions or a join, any click replaces the Pick.
- **Empty lane space (mouse):**
  - a press that moves past the tap slop draws a rubber band, applied on release by overlap across the rows it spans, skipping the hook, captions and joins; Shift adds to the Pick;
  - a press without movement seeks and empties the Pick.
- **The ruler:** seeks and scrubs as today.
- **Touch:** the tracks behave as today (a swipe scrolls), with no rubber band.
- **Dragging a picked layer item** moves the whole picked layer group by the dragged item's snapped delta, as one gesture group. Dragging a Segment reorders it alone and makes the Pick that Segment. Trimming an edge makes the Pick that item.

**Keyboard.**
- New keys: Cmd/Ctrl+A, C, X and V, and Esc.
- These keys act on the Pick: Delete, Cmd+D and Cmd+B, and the arrows (move the picked layer group; Alt moves further).
- Shift+arrows (change an item's end) only work with one item picked.
- Typing in fields is left alone, as today.

**Stage (the preview).** It takes a set of picked stage ids instead of one.
- Every picked item that is on screen is outlined.
- Dragging a picked item moves every picked stage item by the same offset, as one gesture group.
- The corner resize shows only with one item picked.
- Shift-, Cmd- or Ctrl-click toggles.
- Overlays follow the same rules.

**Inspector.**
- **Text Layers only:** the multi-layer panel. Its fields are font, size, colour, outline and its colour, box with its colour and opacity, align, and the in/out animations with their length. Each field shows the shared value or "Mixed", and setting it writes that value to every picked Text Layer.
- **A mixed Pick, or several of another kind:** a summary with counts by kind and the Delete, Duplicate and Copy buttons.

**Desktop Timeline bar.**
- Copy and Paste are added beside Split, Duplicate and Delete.
- Split is enabled when the playhead is inside any picked item.

**Phone.**
- A Pick toggle in the toolbar starts picking mode, where a tap toggles an item.
- The bottom bar shows "N picked" with Delete, Duplicate, Copy, Paste (enabled while the Clipboard holds something) and Done.
- A long press still lifts an item to drag it.

**No backend, model or MCP changes.** The agent already edits many items at once through `merge_candidate_items` and `remove_candidate_items`. No ADR is needed: every decision here lives in the editor and is cheap to change. None contradicts ADRs 0001–0003.

**Vocabulary:** Pick and Clipboard are now in GLOSSARY.md. "Selection" and "selected" keep their meanings: the AI's choice of Candidates, and a Candidate chosen for rendering.

## Testing Decisions

A good test checks behaviour at a public boundary: what goes in and what comes back. It survives a refactor of the internals, and its expected values come from worked examples, not from recomputing them the way the code does.

**One new seam, agreed with the owner.**

**Seam D: the module for actions on a Pick and the Clipboard (vitest, pure)**
- Prior art: Seam C's merge tests in the clip editor, which build small Candidates' edits from helpers and assert whole results.
- Cases:
  - **Remove.** It removes items of mixed kinds in one change. With every Segment picked, the first stays and a notice is given.
  - **Duplicate.**
    - A layer group is shifted by its span when that fits, and placed aside when it doesn't.
    - Picked Segments are copied as a block after the last picked one, in order.
    - The copies are the new Pick.
  - **Split.** Only the picked items under the playhead are cut. A Source Segment is cut in the silence between Words. The tails are the new Pick.
  - **Move.** Layer items move by one delta. Segments don't move. The delta is clamped at the Clip's start and end, keeping the group's shape.
  - **Select all.** Picks every Segment, Text Layer, Music Clip and Overlay, and nothing else.
  - **Copy, then paste at a playhead with no Segments.** The offsets are kept, the ids are new, and the pasted items are the Pick.
  - **Paste with Segments.**
    - They are inserted at the nearest join: at the Clip's start, between two Segments, and at the end.
    - Transitions between copied neighbours are remapped. One into a Segment that wasn't copied is dropped.
    - The layers are placed from the join.
  - **Paste past the end.** An item that crosses the end is trimmed. One that starts past it is skipped. One left too short is skipped. The notice counts both.
  - **Paste into another Job.** Source Segments and their Transitions are skipped with a notice. Media Segments and layer items are kept.
  - **Paste into another Candidate of the same Job.**
    - The Word Edits and Layout Overrides of the pasted ranges are added.
    - Ones the target already has on the same Word, or inside the range, are kept as the target's.
    - Pasting into the same Candidate adds none.
  - **Cut.** Equals copy plus remove, in one change.
  - **Pruning.** It keeps the ids that still exist, and empties the Pick when none do.

**Not automated: a browser walkthrough** at the end of the work, on a desktop and on a phone. The repo has no React component tests, and adding them is out of scope. The walkthrough covers:
- the rubber band and scrubbing on the ruler;
- Shift- and Cmd-click on the Timeline and the preview;
- a group drag on the Timeline and on the preview;
- the multi-layer inspector, with "Mixed";
- copy and paste between two Candidates of one Job and into another Job;
- the phone's picking mode;
- undo of each group action.

**The checks to run:**
- `npm run typecheck`
- `npm test`
- `npm run build`

## Out of Scope

- **Persisting the Clipboard,** or using the system clipboard. It isn't kept across reloads or tabs.
- **Range selection with Shift,** that is, every item between two clicks.
- **A context menu** (right-click).
- **A rubber band on touch screens.**
- **Locked tracks, and "split all at the playhead" with nothing picked.** These belong to `track-controls`. Select all will skip locked tracks once they exist.
- **Rippling layer items** when Segments are inserted or removed. This belongs to `track-controls`.
- **Group bounding box, group scale and group rotation** on the preview.
- **Editing shared fields of several Music Clips or Overlays** in the inspector.
- **Picking the hook or the captions with other items.**
- **MCP tools for the Clipboard.**

## Further Notes

- **Concat's behaviour was studied for parity**, never its code. Where this spec differs from Concat:
  - The inspector shows "Mixed" instead of the first item's values.
  - A paste inserts Segments at the join nearest the playhead instead of sliding items into gaps. The Main Track is always back to back, and layers are laned automatically, so items never collide.
- **This is item 1 of `.scratch/advanced-edit-v2/roadmap.md`.** `track-controls` (item 2) builds on the Pick for locked tracks and "split all", and `templates` (item 21) may reuse the Clipboard's group shape.
