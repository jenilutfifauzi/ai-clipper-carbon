# Track controls and magnetic editing in the Advanced Edit

Status: ready-for-agent
Created: 2026-10-15

## Problem Statement

The Advanced Edit's Timeline shows its Tracks, but the owner can't control them as Tracks.

- **Text drifts off its sentence.** Deleting a Segment from the middle moves every later caption earlier, because captions are made from the Words. The Text Layers, Music Clips, Overlays and the hook stay at their second (ADR 0002). A title written for one sentence now sits over another, a whoosh lands after its cut, and a picture-in-picture shows over the wrong moment. The owner has to find and drag each item back by hand. The same happens when trimming, pasting or duplicating Segments, and when trimming the start of a Clip in the clip editor.
- **No way to see or hear one part alone.** To judge the framing without the Text Layers over it, or the speech without the music, the owner has to delete things and undo.
- **Easy to knock what is finished.** Once the Text Layers are placed, dragging a Segment or picking with a rubber band can move or delete them by accident.
- **Cutting across everything takes many steps.** Splitting the video, its title and its music at one moment means picking each and splitting.
- **Concat has all of this:** hide and mute per Track, a view-only lock, a magnetic timeline, ripple delete (Shift+Delete), and split at the playhead across every clip under it.

## Solution

The Advanced Edit gets **Track controls**, a **Magnetic timeline**, **Ripple delete** and **Split all** (see GLOSSARY.md and docs/adr/0004-layers-ripple-with-the-main-track.md).

**Tracks.** The Timeline's rows are grouped by kind: Text, Overlay, Video (the Main Track), Captions, Hook and Music. Text Layers, Overlays and Music Clips are still spread over lanes as their overlaps need, worked out each time.

**Track controls**

| Track | Hide | Mute | Lock |
|---|---|---|---|
| Text | ✓ | – | ✓ |
| Overlay | ✓ | ✓ | ✓ |
| Video | ✓ | ✓ | ✓ |
| Captions | ✓ | – | ✓ |
| Hook | ✓ | – | ✓ |
| Music | – | ✓ | ✓ |

- **Hide** takes the Track off the preview. Its items stay on the Timeline, dimmed. A hidden Video Track shows black under the layers.
- **Mute** silences the Track in the preview: the Clip's own sound (Source and media Segments) for Video, the songs for Music, and the videos' sound for Overlay.
- **Lock** makes the Track view-only by hand. Its items can't be picked, dragged, trimmed, deleted, split or added to, on the Timeline or on the preview.
- **All three live in the editor only.** They are never saved, never undone, and gone on reload. The Clip renders as if none were set, and the agent and the clip editor don't see them.

**The Magnetic timeline**
- **The switch** sits in the Timeline's bar, on the phone's Tracks sheet and on the clip editor's Timeline. It is one preference, remembered by the browser and on by default.
- **While it is on, the layers follow the Main Track.** Text Layers, Music Clips, Overlays and the hook follow when the Main Track gets shorter or longer at one point: deleting, trimming or inserting Segments (paste, duplicate, a drop or "add to clip").
  - Items after the point move with it.
  - Items across a cut lose the part that was cut. A song or video keeps playing from where it was.
  - Items wholly inside a cut are deleted, and a notice says how many. Undo brings them back.
  - The hook is never deleted. It moves to the join and keeps at least its shortest length.
- **Some edits never move layers:** reordering Segments, and adding or changing a Transition.
- **The clip editor's trim** of an uncut Clip follows the same switch and rule.

**Ripple delete (Shift+Delete)** closes the gap whatever the switch says.
- On picked Segments, the layers follow.
- On a picked Text Layer, Music Clip or Overlay, the later items of its Track move up by its length.

**Split all.** With nothing picked, Cmd/Ctrl+B or the Split button splits every Segment, Text Layer, Music Clip and Overlay under the playhead, except on locked Tracks. Hidden Tracks are split too.
- The hook is never split.
- The captions break their lines at the new join, as at every join (ADR 0002).
- With a Pick, Split works on the picked items as today.

## User Stories

**Tracks**
1. As an owner, I want the Timeline's rows grouped into Tracks by kind with one header each, so that I can tell which controls act on what.
2. As an owner, I want the Track header to show its hide, mute and lock buttons only where they mean something, so that I don't wonder what muting captions would do.
3. As an owner, I want a Track's state visible in its header at a glance (on, hidden, muted, locked), so that I don't forget I hid something.
4. As an owner on a phone, I want a Tracks sheet from the toolbar listing the six Tracks with their buttons and the Magnetic switch, so that I can control them without a header column.

**Hide**
5. As an owner, I want to hide the Text Track, so that I can judge the framing without titles over it.
6. As an owner, I want to hide the Overlay Track, so that I can see the speaker under a picture-in-picture.
7. As an owner, I want to hide the Video Track and see black under the layers, so that I can place Text Layers and Overlays against a plain background.
8. As an owner, I want to hide the Captions Track, so that I can see the frame without captions.
9. As an owner, I want to hide the Hook Track, so that I can watch the opening without the hook over it.
10. As an owner, I want a hidden Track's items dimmed on the Timeline but still there, so that I know they exist and still render.
11. As an owner, I want hidden items not clickable on the preview, so that I don't pick something I can't see.
12. As an owner, I want hiding never to change the rendered Clip, so that I never get a Clip without its titles because I forgot to unhide.
13. As an owner, I want the header's tooltip to say a hidden Track still renders, so that the difference from Concat is clear.

**Mute**
14. As an owner, I want to mute the Music Track, so that I can hear the speech clearly while placing cuts.
15. As an owner, I want to mute the Video Track, so that I can judge the music alone.
16. As an owner, I want to mute the Overlay Track, so that an Overlay video's sound doesn't distract me.
17. As an owner, I want muting never to change the rendered Clip's sound, so that the volumes I set are what ships.

**Lock**
18. As an owner, I want to lock the Text Track once titles are placed, so that a stray drag or rubber band can't move or delete them.
19. As an owner, I want locked items to ignore clicks, rubber bands and Cmd+A, so that nothing on a locked Track enters the Pick.
20. As an owner, I want items to drop out of the Pick when I lock their Track, so that no action touches them afterwards.
21. As an owner, I want a locked Video Track's Segments and joins unpickable and undraggable, so that the cut stays as it is.
22. As an owner, I want a locked Captions Track to refuse caption edits and drags on the preview, so that finished captions stay finished.
23. As an owner, I want a locked Hook Track to refuse moving, resizing and retyping the hook, so that the opening stays fixed.
24. As an owner, I want drops and "add" buttons aimed at a locked Track refused with a notice, so that I know why nothing happened.
25. As an owner, I want pasted items of a locked Track left out with a notice, so that a paste doesn't slip past the lock.
26. As an owner, I want a locked Track's items still to follow the Main Track while magnetic, so that locked titles stay over their sentences.
27. As an owner, I want the agent's changes to still reach a locked Track, so that the lock only guards my own hands.

**Magnetic timeline**
28. As an owner, I want a Magnetic switch in the Timeline's bar, so that I can choose whether layers follow the Main Track.
29. As an owner, I want the switch on by default, so that my titles stay over their sentences without my learning a setting.
30. As an owner, I want the switch remembered by my browser across Candidates and Jobs, so that I set it once.
31. As an owner, I want deleting a Segment to move later Text Layers, Music Clips, Overlays and the hook up by the time it took, so that each stays over the moment it was made for.
32. As an owner, I want trimming a Segment's edge shorter to move the later layers up by the trimmed time, so that trimming doesn't drift them.
33. As an owner, I want trimming a Segment's edge longer to move the later layers back, so that extending a cut doesn't drift them either.
34. As an owner, I want inserting a Segment (paste, duplicate, a drop or "add to clip") to move the later layers back by its length, so that they keep their moments.
35. As an owner, I want a layer crossing a cut to lose only the part that was cut, so that a title over two sentences keeps its part over the one I kept.
36. As an owner, I want a song crossing a cut to keep playing from where it was, so that the music doesn't jump.
37. As an owner, I want layers wholly inside a deleted stretch removed, with a notice saying how many, so that I don't keep titles for words that are gone.
38. As an owner, I want undo to bring back the whole ripple (the Segment and every layer it moved or removed) in one step, so that a mistake costs one Cmd+Z.
39. As an owner, I want the hook never deleted by a ripple, but moved to the join and kept at least its shortest length, so that my Clip always has its hook.
40. As an owner, I want layers left in place when I reorder Segments, so that a reorder never rearranges my titles by surprise.
41. As an owner, I want layers left in place when I add or change a Transition, so that tuning a join doesn't move my titles.
42. As an owner, I want a layer that a ripple shortens below the shortest item length removed and counted in the notice, so that no sliver of a title is left behind.
43. As an owner, I want deleting several Segments at once to move the layers by the right amount at each point, so that a group delete behaves like deleting them one by one.
44. As an owner, I want the switch off to keep today's behaviour, where layers stay at their seconds, so that I can rearrange the cut under fixed layers.
45. As an owner, I want trimming a Segment by dragging to ripple live while I drag and undo as one step, so that I see where the layers will go.
46. As an owner, I want pasted layers placed by the paste rules, without being moved again by the Segments they come with, so that a pasted group keeps its shape.
47. As an owner, I want the clip editor's trim of an uncut Clip to move the Text Layers, Music Clips, Overlays and the hook the same way, so that trimming the start there doesn't drift them.
48. As an owner, I want the same Magnetic switch shown on the clip editor's Timeline, so that I know which rule its trim follows.
49. As an owner, I want a ripple saved as one Revision, merged like any other edit when someone else saved meanwhile, so that rippling doesn't break the shared editing.

**Ripple delete**
50. As an owner, I want Shift+Delete on picked Segments to move the layers up even with the switch off, so that I can ripple once without changing my preference.
51. As an owner, I want Shift+Delete on a Text Layer to move the later Text Layers up by its length, so that I can close a gap in a sequence of titles.
52. As an owner, I want Shift+Delete on a Music Clip or an Overlay to close its Track the same way, so that a sequence of songs or pictures closes up.
53. As an owner, I want Shift+Delete on a mixed Pick to close each Track for its own items and make the layers follow the Segments, as one undo step, so that one key tidies everything.
54. As an owner, I want items overlapping a deleted layer left where they are, so that Shift+Delete never piles items on top of one another.
55. As an owner, I want Shift+Delete on the hook, the captions or a join to do what Delete does, so that the key is never surprising.
56. As an owner on a phone, I want a ripple delete in the picked items' bar, so that I can do it without a keyboard.

**Split all**
57. As an owner, I want Cmd/Ctrl+B with nothing picked to split every Segment, Text Layer, Music Clip and Overlay under the playhead, so that I can cut across the whole Clip in one key.
58. As an owner, I want the Split button in the Timeline's bar and the phone's toolbar enabled with nothing picked when something is under the playhead, so that split all works without a keyboard.
59. As an owner, I want split all to skip locked Tracks, so that a lock protects against it.
60. As an owner, I want split all to split hidden Tracks too, so that hiding is only about seeing.
61. As an owner, I want split all to leave the hook whole, so that the hook stays one item.
62. As an owner, I want the captions to break their lines at the new join, as they do at every join, so that the rule is the same as a single split.
63. As an owner, I want the second parts picked after a split all, so that I can delete or move them straight away.
64. As an owner, I want a split all to be one undo step, so that I can take it back at once.
65. As an owner, I want a Source Segment split in the silence between Words, as a single split does, so that no Word is given to both parts.

**The agent**
66. As an agent, I want the MCP instructions to say that removing or trimming Segments, or changing `start`/`end`, leaves the layers in Timeline time, so that I move them myself when they should follow.
67. As an agent, I want my edits applied exactly as I send them, with no ripple added by the server, so that what I send is what is saved.

## Implementation Decisions

**No model, backend or Render Plan change.** Candidates store nothing new. Track state is editor state, and rippling produces ordinary edits of Timeline times. The planner, the renderer, the Preview Plan and the Revision merge are unchanged. The one backend change is the MCP server's instructions text. ADR 0004 records the decision. It amends ADR 0002's "cutting the Main Track leaves them where they are", for the editors only.

**Track state (editor only).**
- It is a value held by the Advanced Edit, beside the Pick, and is neither saved nor undone. Its shape:
  - the Tracks hidden: a subset of text, overlay, video, captions and hook;
  - the Tracks muted: a subset of overlay, video and music;
  - the Tracks locked: any subset of the six.
- Reloading or reopening the Advanced Edit starts with every Track on.
- **The Magnetic preference** is a boolean in the browser's local storage, read once and written on change, true when absent or unreadable. Every read and write is guarded, so that a blocked storage still gives the default. The Advanced Edit and the clip editor read the same key.

**Hide and mute reach the preview only.**
- The preview layers already draw from the plan and the edits: Segments, Overlays, captions, the hook, Text Layers, music and the Clip's sound.
- Each gets a "hidden" or "muted" input from the Track state.
- Hidden stage items can't be picked on the preview.
- The Render Plan request is unchanged, so the preview's layout and timings stay identical to the render.

**Lock is enforced at the Pick and the gestures.**
- **The Pick:** click, toggle, band and select all skip locked kinds. A Track locked while items of it are picked drops them from the Pick, as pruning does.
- **The Timeline:** items on locked Tracks don't drag, trim or take drops.
- **The stage:** the stage handles of a locked hook and of locked captions (drag, resize, inline text) are disabled.
- **Adding and pasting:** adding to a locked Track (asset panel drop, add buttons) is refused with a notice. A paste leaves out the Clipboard items of locked Tracks, with a notice. The video Track's lock covers Segments and joins.
- **Ripple ignores locks:** locked items still follow the Main Track.

**One pure ripple rule in the actions module (Seam D).**
- It takes the edits, the Clip's duration and a list of **Main Track changes** in Timeline time, each either a removal of span [a, b) or an insertion of length L at t. It returns the edits with Text Layers, Music Clips, Overlays and the hook moved, plus a count of the items removed.
- Changes are applied from the latest to the earliest, so that earlier times stay valid.
- **A removal of [a, b)**, per item spanning [s, e):
  - **e ≤ a:** unchanged.
  - **s ≥ b:** moved up by b − a.
  - **s < a < e:** loses the overlap with [a, b). A song's or video's offset is unchanged, so it plays on from where it was.
  - **a ≤ s < b < e:** starts at a and ends at e − (b − a). A song's or video's offset is advanced by b − s.
  - **a ≤ s and e ≤ b:** deleted, and counted.
  - **Too short:** an item left shorter than the shortest item length is deleted, and counted.
  - **The hook:** the same, except that it is never deleted. Wholly inside, it moves to start at a. It is never shorter than its minimum.
- **An insertion of L at t:** items with s ≥ t move back by L. Items across t stay as they are.
- **Measuring the change.** A Main Track action measures its change from the Main Track as the editor plays it before and after (Segments snapped to Words, shortened at Transitions). The span's length is the difference in the played Clip's length, placed at the edited Segment's played start (a deletion or an insertion) or at the trimmed edge. So a Segment that takes its Transitions with it ripples by what the Clip actually lost.
- **The notice** counts the layers removed, by kind.

**Actions that ripple when the Magnetic preference is on, or when forced.** The actions module's context gains `magnetic` and `locked`. The Main Track actions in it ripple, each as one change and one undo step:
- **remove;**
- **duplicate** (of Segments, after the last picked one);
- **paste with Segments.** Pasted layers are placed by the paste rules after the existing layers have been moved, and are not moved again.
- **insert Segment** (drop, "add to clip"): moved from the Advanced Edit component into the actions module.
- **trim Segment edge:** also moved from the component into the actions module. It is computed from the drag's origin each step, so that a drag ripples live and undoes as one gesture group.

Reorder (dragging a Segment to another place) and Transition edits never ripple.

**Ripple delete.** It is an action in the module, bound to Shift+Delete and Shift+Backspace and to a button in the phone's picked items' bar. It is remove with the ripple forced:
- **Picked layer items** first close their Track. For each kind, every item of that kind starting at or after a deleted item's end moves up by its length. Deleted spans are taken from the latest to the earliest, and items overlapping a deleted item stay.
- **Picked Segments** then ripple the layers.
- **The hook, the captions or a join** alone: same as Delete.

**Split all.** It is an action in the module: with an empty Pick, split every Segment, Text Layer, Music Clip and Overlay whose span holds the playhead, by today's per-kind split rules, skipping locked kinds. The tails become the Pick, as one change.
- Cmd/Ctrl+B and the Split buttons call split all when the Pick is empty, and split when it isn't.
- The Split button is enabled when either can apply.

**The clip editor's trim.**
- Trimming an uncut Clip's start from s to s′ is, in Timeline time:
  - a removal of [0, s′ − s) when s′ > s;
  - an insertion of s − s′ at 0 when s′ < s.
- Trimming the end from e to e′ is:
  - a removal of [e′ − s, e − s) when e′ < e;
  - an insertion at the old end, which moves nothing, when e′ > e.
- The trim's save carries the rippled Text Layers, Music Clips, Overlays and `hook_start`/`hook_secs` with the new range, as one save and one Revision.
- It follows the Magnetic preference, and the clip editor's Timeline shows the same switch.

**Track headers (desktop).**
- Each Track's first row carries its label and its hide, mute and lock buttons, by the matrix in the Solution. The Captions and Hook rows get headers like the others.
- The buttons have accessible names and pressed states.
- A hidden Track's items are dimmed. A locked Track shows a lock and the default cursor.
- The Magnetic switch sits in the Timeline's bar beside Split, with a tooltip: "Deleting, trimming or inserting Segments moves the layers with them".

**Phone.**
- The toolbar gains a **Tracks** button. It opens a bottom sheet listing the six Tracks with their buttons, and the Magnetic switch.
- The picked items' bar gains **Ripple delete**.
- The Split button works with nothing picked.

**MCP.** The server's instructions gain one point under Edits: removing or trimming Segments, or changing `start`/`end`, leaves Text Layers, Music Clips, Overlays and the hook where they are in Timeline time. The editors move them while their Magnetic timeline is on, so an agent moves them itself when they should follow. The tools are unchanged.

**Vocabulary.** Track, Magnetic timeline, Ripple delete and Split all are in GLOSSARY.md. "Lane" is a layout word for the rows of a Track, not a domain term.

## Testing Decisions

A good test checks behaviour at a public boundary: what goes in and what comes back. It survives a refactor of the internals, and its expected values come from worked examples, not from recomputing them the way the code does.

**One seam, agreed with the owner: Seam D extended** (the pure module for actions on a Pick, vitest). No new seam.
- Prior art: the existing tests of the actions module and the Clipboard, which build small edits from helpers (`layer`, `music`, `segment`, `edits`) and a played Main Track, and assert whole outcomes. They also follow Seam C's merge tests in the clip editor.
- **Ripple on remove (magnetic on)**, with a three-Segment Clip and layers before, across, inside and after the middle Segment:
  - the before layer is unchanged;
  - the after layer moves up by the Segment's played length;
  - the across-start and across-end layers are shortened, with a song's offset advanced only when its start was cut;
  - the inside layer is deleted and the notice counts it;
  - the hook inside the cut moves to the join;
  - a layer left shorter than the minimum is deleted.
- **Magnetic off:** the same remove leaves every layer as it is (today's behaviour).
- **Several Segments removed at once:** the layers move as if the Segments were removed one at a time from the latest.
- **A Segment with a Transition removed:** the layers move by the Clip's actual loss.
- **Trim a Segment's edge, shorter and longer:** the later layers move up and back. A drag's steps from one origin give the same result as one step.
- **Insert (drop or "add to clip") and duplicate Segments:** the later layers move back. Layers across the point stay.
- **Paste with Segments:** the existing layers after the join move back. The pasted layers land at their paste offsets, unmoved.
- **Reorder:** no layer moves.
- **Ripple delete:**
  - with the switch off, the layers still follow picked Segments;
  - a Text Layer's Track closes, others of its kind after it move up, and an overlapping one stays;
  - other kinds are untouched;
  - a mixed Pick does both in one outcome;
  - the hook alone behaves like Delete.
- **Split all:**
  - with an empty Pick, every un-locked Segment, Text Layer, Music Clip and Overlay under the playhead is cut;
  - a Source Segment is cut in the silence between Words;
  - the hook is untouched;
  - locked kinds are skipped, hidden ones are not;
  - the tails are the Pick.
- **Lock in the Pick:** click, toggle, band and select all skip locked kinds. Locking prunes the Pick. Paste leaves out locked kinds with a notice.
- **The clip editor's trim ripple:** start later, start earlier, end earlier and end later each give the expected layer times and hook. This is a function of the same module, called from the clip editor.

**Not automated: a browser walkthrough** at the end of the work, on a desktop and on a phone. The repo has no React component tests, and adding them is out of scope. The walkthrough covers:
- hiding and muting each Track in the preview, with the render unchanged (render one Clip with a Track hidden and see it whole);
- locking each Track against clicks, drags, drops and the stage handles;
- the Magnetic switch remembered across a reload and shared with the clip editor;
- a live ripple while dragging a Segment's edge, and its undo;
- Shift+Delete;
- split all from the keyboard, the bar and the phone's toolbar;
- the phone's Tracks sheet.

**The checks to run:**
- `npm run typecheck`
- `npm test`
- `npm run build`
- the backend's tests, for the MCP instructions change

## Out of Scope

- **Persisted lanes, moving items between lanes by hand, and empty lanes.** Lanes stay worked out each time. A manual stacking order (z-order) would be its own feature.
- **Saving hide, mute or lock in the Candidate, or excluding hidden or muted Tracks from the render.**
- **Per-lane controls,** and solo.
- **Ripple in the backend or the MCP tools** (a `ripple` flag). The rule stays in one place, the editor's actions module.
- **Layers following a reorder of Segments** (connected clips), and anchoring layers to the Source's timeline. Both are rejected in ADR 0004.
- **Layers moving with Transitions.**
- **A gap in the Main Track,** so a non-magnetic Main Track. The Main Track stays back to back (ADR 0002).
- **Locks that bind the agent or the clip editor.**
- **Splitting the hook.**

## Further Notes

- **Concat's behaviour was studied for parity, never its code.** Where this spec differs from Concat:
  - Hide and mute are preview-only, because render-affecting flags risk a Clip shipped without its titles.
  - The Magnetic timeline makes layers follow the Main Track, instead of closing gaps within each Track. Gaps between Text Layers are on purpose, and the Main Track has none.
  - Shift+Delete on a layer item closes its Track, which is Concat's ripple delete.
- **Behaviour change:** with the switch on by default, deleting a Segment now moves (and may delete) layers. The multi-select spec's paste rule "layer items after an inserted Segment don't move" is superseded while the switch is on.
- **This is item 2 of `.scratch/advanced-edit-v2/roadmap.md`.** It builds on the Pick and actions module of `multi-select-clipboard`.
