# 09: Detach and Reattach

**Parent spec:** `spec.md` in this feature folder (user stories 24–32, 58, 61, 64; Solution "Detach and Reattach"; Implementation Decisions "Model", "API rules", "Editor actions", "Inspector", "MCP"); ADR 0016; GLOSSARY "Detach".

**What to build:** on the desktop, the owner Detaches a Segment's sound from its context menu or inspector. The sound moves onto a Music Clip that is heard exactly as before, and the Segment is Muted. That sound can then be slid for a J-cut or an L-cut. Reattach, from either side, puts things back. The agent does the same with ordinary edits. (The phone comes in 14.)

- **Model and API.**
  - `detached_from` (a Segment id or null) on Music Clip.
  - It must name a Segment of the Candidate when it is added or changed.
  - One that already carried it in the current Revision keeps it after the Segment is gone.
- **Detach** (an editor action, one undo step, on each picked Segment that allows it):
  - A new Music Clip of the Segment's sound: the Source's for a Source Segment, the video's for a media Segment.
  - It starts where the Segment's sound starts on the Timeline (a Transition's overlap included) and is as long.
  - It copies the range, Speed, pitch, Reverse, volume, fades and volume Keyframes (same `at`), sets `detached_from`, and doesn't duck.
  - The Segment is Muted. The Pick moves to the new Music Clips.
- **Detach is not offered** on a Freeze frame, a Muted Segment, a video Segment without sound, or a Segment that already has a Detached sound.
- **Reattach** is offered on the Segment and on any Music Clip Detached from it, while the Segment exists. It deletes every Music Clip Detached from that Segment and unmutes it, as one undo step. Nothing is copied back.
- **Split:**
  - a Muted Segment's tail stays Muted;
  - both parts of a split Detached sound keep `detached_from`.
- **Clipboard.** `detached_from` is dropped when pasting into another Candidate.
- **Inspector.**
  - A Segment shows Detach audio or Reattach audio.
  - A Detached Music Clip shows "Detached from Segment N" with Reattach.
- **MCP.**
  - The instructions spell out Detach: add a Music Clip with `detached_from`, the Segment's range and fields, then set the Segment's `muted`.
  - They spell out Reattach: remove those Music Clips, then clear `muted`.
  - A `detached_from` naming no Segment is refused.

**Blocked by:** 02, 04, 06, 08.

**Status:** done

- [x] Detaching a Source Segment at 1.5× with fades and volume Keyframes renders the same sound as before the Detach (within tolerance, tone), now from a Music Clip, and the Segment is Muted.
- [x] Moving the Detached sound 1 s later is heard 1 s later in the render.
- [x] Detach on a Segment with a Transition at its start covers the overlap.
- [x] Reattach after the Detached sound was split removes both parts and unmutes the Segment, as one undo step.
- [x] Detach is not offered on a Freeze frame, a Muted Segment or a silent video Segment.
- [x] The API and MCP refuse a new `detached_from` naming no Segment, and keep a stored one whose Segment was deleted.
- [x] Editor action tests cover Detach over a Transition, Reattach and split.

## Comments

**2026-10-18: done.** Built test first in `backend/tests/test_detach.py` and `frontend/src/pages/job/advanced/detach.test.ts`.

**What was built:**
- **Model.** `MusicClip.detached_from: ItemId | None = None`, after `muted`. Stored Candidates read as Detached from nothing.
- **API** (`review.update`, so PATCH, `/preview-plan`'s draft, Restore and both MCP edit tools). `_check_detached` refuses a Music Clip whose `detached_from` names no Segment of the Candidate's Main Track after the change ("Music Clip x is Detached from Segment z, which the clip doesn't have"), unless that clip (by id) carried the same value in the current Revision. So a saved one outlives its Segment, and can still be moved. An uncut Clip's one Segment is `main`, as the editor names it.
- **Editor actions** (`actions.ts`, each one change):
  - `canDetach`: not a Freeze frame, not Muted, not a video without sound, and nothing Detached from it yet.
  - `detach(scene, ids, track, sounded)`: a Music Clip per Segment, from the planned Main Track (`track`, snapped to Words and overlapping at Transitions), so it starts where the Segment's sound starts and is as long, a Transition's overlap included. Its `media` is the Segment's (null for the Source), `offset` its planned range's start, and it copies Speed, pitch, Reverse, volume, fades (fitted) and the volume Keyframes (same `at`, re-anchored within it). It is appended, so `trackLanes` puts it on the first Music lane free there. The Segments are Muted and the new Music Clips picked.
  - `canReattach` / `reattach(scene, id)`: offered while the Segment exists and some Music Clip names it. It deletes them all and unmutes the Segment, which is then picked.
  - `detacher` wires both for the UI; Detach from a picked Segment acts on every picked Segment.
  - Split already copied `muted` and `detached_from` (spread); the tests pin it.
  - `stillDetached`: a new Music Clip (a split's tail, a duplicate, a paste) keeps `detached_from` only while its Segment is in the Candidate, else gets `null`, since the API refuses a new back-reference to a missing Segment. The Clipboard drops it pasting into another Candidate (or Job).
- **Context menu** (new `ItemMenu.tsx`). `TimelineItem` takes `menu` entries. A right-click, or the menu key, picks the item (unless it is already picked) and opens a `popover="auto"` `role="menu"` at the pointer, kept in the window. It has light dismiss and Escape, arrow keys, Home and End, and the focus goes back to the item on close. `TrackHandlers.menu(item)` gives Segments "Detach audio" / "Reattach audio" and a Detached Music Clip "Reattach audio".
- **Inspector.** A Segment shows a "Detach audio" or "Reattach audio" button under its Muted switch, whichever is offered. A Detached Music Clip whose Segment is there shows "Detached from Segment N" with "Reattach".
- **MCP.** One instructions paragraph for Detach and Reattach. It says to add the Music Clip and set `muted` in one `merge_candidate_items` call, from the dry run's `segments`. The new field passes through both tools from the model. The tool list stays within 69 000 bytes.

**Decided differently / worth knowing:**
- **Detach and `muted` must be one edit for a lone unmuted Segment.** `review.update` folds a lone, as-filmed, unmuted Segment into `start`/`end`, so its id becomes `main`. A Music Clip naming its old id would then be refused. The instructions say to do both in one merge.
- **No `duck` yet.** Ticket 10 adds the field and the −12 dB default for new Music Clips of a Media Library item. **When merging 10, `detach` must set `duck: null`** on a Detached video sound, or the server's default will duck it. A Music Clip of the Source never ducks anyway.
- **Context menu shared with 12.** Ticket 12 needs "Save sound as WAV" on the same menus. It can add its entry in `itemMenu` (`AdvancedEdit.tsx`) through `TrackHandlers.menu`, and pass `menu` to the Overlay's `TimelineItem` too.
- **The inspector's buttons show on the phone's sheets too** (the Inspector is shared). Ticket 14 owns the phone's design of it.
- **Not checked by hand in a browser.** No backend with a reviewed Job was running for this worktree. Typecheck, build and the action tests cover the wiring; ticket 15's walkthrough covers the J-cut by hand.
- **Tests:**
  - `test_detach.py` (5):
    - the model default;
    - API refusals (added, changed, a new one after its Segment is gone) and the outliving one, PATCH and draft;
    - Detach and Reattach of an uncut Clip's `main`;
    - MCP Detach, refusal, Reattach, the Segment removed and the clip moved;
    - three real renders over the sweeping Source with a steady song as the measure. A Source Segment at 1.5× with fades and volume Keyframes, then Detached: the same level within 1 dB at four moments, through its fade in, the Keyframe dip and its fade out. Moved 1 s later: the same, 1 s later, and >20 dB down where it was.
  - `detach.test.ts` (13):
    - Detach copying everything and Muting, over Transitions at both ends;
    - a video's in Reverse;
    - planned range and Keyframes within it;
    - not offered (Freeze frame, Muted, silent video, already Detached), and a mixed Pick;
    - Reattach after a split and a move, others kept, nothing copied back, not offered once the Segment is gone;
    - a Muted Segment's tail Muted;
    - split and duplicate of an orphaned Detached sound;
    - the Clipboard into another Candidate and into the same one.
