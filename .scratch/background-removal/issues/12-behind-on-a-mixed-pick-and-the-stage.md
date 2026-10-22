# 12: Behind on a mixed Pick, and Behind Overlays on the stage

**Parent spec:** `../spec.md` (User Stories 7–9, 35); ADR 0015. From the branch's code review (2026-10-22).

**What to build:**
- **The "Behind the Main Track" switch works on a Pick of several Overlays** (shared field, Mixed when they differ, one step of undo). It is refused with a notice for any that sit on a locked Track. This applies on the desktop and in the phone's sheet.
- **Behind Overlays can be picked, moved, scaled and rotated on the preview stage** with their Grips and Smart Guides, like any Overlay. Because they are drawn under the Segment's picture, decide how a click reaches them (for example, where they show through the cut, or when the Behind Track is the only one with an item under the pointer) and document the choice in the ticket's Comments.

**Blocked by:** 10

**Status:** done

- [x] vitest: the switch on a mixed Pick (all, Mixed, locked refusal, one undo step).
- [x] vitest: `stagePictures` (or its successor) lists Behind Overlays, and dragging one moves it.
- [x] Walkthrough in the browser, desktop and phone width.

## Comments

**2026-10-22, done.**

- **The switch on a Pick of several Overlays** (actions.ts):
  - `sharedBehind({edits, pick})` gives true, false, "mixed", or null when no Overlay is picked.
  - `setBehind({edits, pick, locked}, behind)` now acts on every picked Overlay, not on one id. It is one change, keeps the Pick, and drops the field on the way back over the Main Track.
  - It is refused, with "The Behind/Overlay Track is locked.", when any Overlay that would move goes onto or comes off a locked Track. `unlockedPick` already keeps items on a locked Track out of the Pick, so in practice the refusal is about the Track they would move onto.
  - `BehindSwitch` takes `"mixed"`: off, marked Mixed, like the Remove background switch. The Inspector shows it for one Overlay and, after the Blend Mode, for a Pick of several that holds an Overlay. The phone's sheet renders the same Inspector.
- **How a click reaches a Behind Overlay on the stage** (`editor/behindStage.ts`, `editor/stagePictures.ts`, StageEdit):
  - A press reaches a Behind Overlay **where the Segment's picture doesn't show**:
    - off the picture: a Manual or media picture that doesn't cover the frame, or a Split's gap (a Blur fill isn't the picture);
    - or where it is cut out and its Matte has taken it away.
    - Anywhere the speaker shows, the press picks the Segment as before.
  - The Segment's picture handle covers the frame, so the Behind Overlays' handles sit **under** it. A press on the frame asks `through(point)` for the topmost Behind Overlay showing at the playhead whose picture holds the point, where the Segment's picture doesn't show. If there is one, the press (and its moves, lift and second finger) goes to that Overlay's handlers: it is picked and dragged with its Grips and Smart Guides like any Overlay.
  - "Shows" comes from the plan's numbers. `pictureSpot` turns the point into a share of the item's frame: the Scene's picture is un-turned, un-flipped and uncropped, or a panel's area is mapped through its crop path at that time.
  - Where the Segment has Background removal, `cutAlpha` reads that spot's alpha off the cut canvas shown now. That is a canvas with `data-cut-picture` ("source" for the Source's slots, "segment:<id>" for a media Segment's), under a `data-cut` group, and visible by `checkVisibility`. Kept means alpha ≥ 0.5. Until the Matte is drawn, the picture counts as whole.
  - **A picked Behind Overlay's handle is lifted over the frame**, so it can be dragged even where the speaker covers it. A click without a drag on it where the Segment's picture shows (`coveredBy`) picks the Segment, so a full-frame B-roll never traps the Pick.
  - With the Video Track hidden or locked, there is no Segment handle, and Behind Overlays are picked by their boxes directly.
  - Moving one goes through the Overlays' stage controls (`writeItemTransform`, auto-key). Its Track's lock is now checked per Overlay: `transformOf` gives nothing for an Overlay on a locked Overlay Track or a locked Behind Track. `drawnPlan`, the keyed-time sampling (`overlaysAt(plan, t, plan.behind)`, `hasKeyedPictures`) and the Smart Guides' `picturesAt` include the Behind Overlays.
  - `stagePictures` moved out of ClipPreview.tsx into `editor/stagePictures.ts` (with `behindId`), so a test can import it without a DOM.
- **A bug found in the walkthrough, fixed:** since 06, a video Behind Overlay inside a cut-out Segment was invisible. Its `CutVideo` read the Segment's `group-data-[cut]/cut`, which matches any ancestor, so the video was hidden and its empty canvas shown. `CutVideo` now reads only its own group's flag (`[[data-cut]>&]`).
- **Tests:** `advanced/behindTrack.test.ts` (shared/Mixed, all on and off as one change with the others untouched, locked refusals both ways, Mixed markup, `writeItemTransform` moves a Behind Overlay and respects the Behind lock) and `editor/behindStage.test.ts` (`pictureSpot` on a picture, flipped, cropped, turned, on Split panels by path time, Blur fill excluded; `segmentShows` with and without a cut; `reachedBehind` topmost, timing and covered; `stagePictures` lists Behind Overlays under the picture before the Overlays, none on a locked Track; `through` and `coveredBy`; dragging one calls its Overlay's `onTransform`). Typecheck clean.
- **Walkthrough** (ego-browser, scratch copy of the walk06 data, backend from this worktree on :8023, Vite on :5193; both stopped and the temporary Vite config deleted):
  - Desktop 1440×1000, a cut-out Track-Layout Segment (teal Background) with a video Behind Overlay:
    - a click on the speaker picks the Segment; a click on the B-roll where the speaker is cut away picks the Behind Overlay, with its Grips; a click on teal outside the B-roll picks the Segment;
    - a drag from a spot where it shows through moved it (300,520 → 464,646), and one Undo put it back;
    - a duplicate switched over the Main Track, then a Pick of both shows "Behind the Main Track" Mixed; switched on, both go Behind (the speaker draws over both), and one Undo brings back Mixed;
    - with the Behind Track locked, the switch shows "The Behind Track is locked."
  - Phone 390×844 (touch emulation): a tap on the B-roll through the cut picks the Behind Overlay (Grips and the Overlay toolbar). A tap on the speaker then picks the Segment.
  - Not checked: a Pick of several Overlays in the phone's sheet (the same Inspector), and a real iPhone.
