# 06: Diamonds in the inspector, and auto-key

**Parent spec:** `spec.md` (user stories 16–20, 22–24; Solution "Editing", "Only one item"; Implementation Decisions "One sampling module, twice", "Editor actions").

**What to build:** the owner can key a picture or a sound where they already edit it.
- **The diamonds.** A ‹ ◆ › cluster sits beside X, Y, Scale, Rotation, Opacity and Volume in the Advanced Edit's inspector, for every keyable item that exists by then: Overlays and Music Clips, plus media Segments and Manual Scenes if 04 and 05 are in.
  - The diamond is filled when there is a Keyframe at the playhead, outlined when there are Keyframes elsewhere, and grey when the property is constant.
  - Clicking it adds a Keyframe with the value shown, so nothing moves, or removes the one there.
  - ‹ and › move the playhead between that property's Keyframes.
- **Auto-key.** Once a property is keyed, every change writes a Keyframe at the playhead: a field, a Grips drag, Fit and Fill.
- **Reset** clears the Transform's Keyframes.
- **Removing the last Keyframe** leaves the constant at the value at the playhead.
- **When the controls are off.** They are off outside the item. In a multi-item Pick, a field keyed on any picked item is disabled, with a note.

- **The frontend's Keyframe actions** (pure): set, remove and toggle at a time, with the half-frame replace and the inherited Ease; clear a property, or all.
- **Every Keyframe edit is one change of the edits:** one step of undo, saved and merged like any other. A locked Track refuses them.

**Blocked by:** 01, 03

**Status:** done

- [x] Seam D:
  - [x] toggle adds a Keyframe with the value at the playhead and the Ease of the one before; again removes it;
  - [x] removing the last Keyframe sets the constant to the value at the playhead;
  - [x] on a keyed property a Transform change writes a Keyframe at the playhead, and on an unkeyed one it changes the constant;
  - [x] a Keyframe set within half a frame of another replaces it;
  - [x] Reset clears the Transform's Keyframes;
  - [x] a locked Track refuses a Keyframe edit.
- [x] By hand: keying a slide-in of an Overlay by moving the playhead and dragging the picture, and undoing it step by step.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built at Seam D test first, in the frontend's `editor/keyActions.test.ts` (the pure actions) and `advanced/keying.test.ts` (on the items of the edits), plus a case in `stagePicture.test.ts`.

- **The pure Keyframe actions** are appended to `frontend/src/pages/job/editor/keyframes.ts`: `KEY_GAP_SECS`, `MAX_KEYS`, `PICTURE_KEYS` and `PictureKey`; `keyAt(keys, at)` (the nearest within half a frame, or -1), `keysAround(keys, at)` (where ‹ and › go), `keyState(keys, at)` ("here", "elsewhere", "constant"); `setKey(keys, prop, at, value)`, `removeKey(keys, at)`; and on a whole `Keys` map with the property's constant, `toggleKey(keys, prop, at, constant)` and `writeKey(keys, prop, at, value, constant)` (auto-key), each giving `{keys, constant}`; `clearKeys(keys, props?)`; for a Transform, `shownTransform(transform, keys, at)` (keyed fields at the playhead, held to their ranges) and `writtenTransform(transform, keys, next, at, shown?)` (a keyed field that differs from `shown` writes a Keyframe; every other field is its constant; `at` null drops a keyed field's change). Times are the item's own seconds; `setKey` rounds them to the millisecond (a hundredth, as the edits round, would put frames 30 ms apart) and holds the value to its range.
- **On the items of the edits:** `frontend/src/pages/job/advanced/keying.ts`: `KeyedRef` (`overlay` or `music` for now), `KeyScene` (edits, Pick, locked Tracks), `keyedItem(edits, ref)` (span, keys, each property's constant), `keyTime(item, time)` (the playhead minus the item's start, to the millisecond; null outside `0..secs`), `toggleItemKey`, `writeItemKey` and `writeItemTransform` (each an `Outcome`, null on a locked Track, for an item that isn't there, or for a keyed property with the playhead outside), `resetOverlay(overlay, defaults)` and `stageTransform(overlay, time)` (the Grips' Transform: keyed fields at the playhead, tidied as the stage tidies).
- **The cluster** is `advanced/KeyCluster.tsx`: `<KeyCluster item={ref} property label />` reads a `KeyingContext` (edits, Pick, locked Tracks, playback, `onEdits`) that `AdvancedEdit` provides around the inspector and the phone's Transform sheet; without it, it draws nothing. ‹ and › seek to `start + at`; the diamond is filled (accent) on a Keyframe, outlined (accent) between them, grey on a constant; all three are off outside the item. `useKeyTime(playback)` is the time it all goes by: the playhead while paused, the last paused time while playing, as `ClipPreview.useKeyedTime` does for the Grips, so a frame doesn't draw the inspector again.
- **Fields.** `TransformFields` takes `keyed?: {item, keys, inside}`: a cluster beside X, Y, Scale, Rotation (`NumberField` gained `cluster` and `disabled`) and Opacity (`Slider` gained `after` and `disabled`); keyed fields, and Fit and Fill when x, y or scale is keyed, are off with the playhead outside, with a note. `Overlays.tsx` has `OverlayTransform` (used by `OverlayFields` and by `TransformPanel`, so the phone sheet auto-keys too): it shows `shownTransform` at the key time, writes `writtenTransform`, and its Reset is `resetOverlay` (the Transform's Keyframes go, the sound's stay). An Overlay video's "Its sound" and a Music Clip's Volume show the value at the playhead with their own cluster, and auto-key (`writeKey`, and `writeItemKey` through the inspector's `volumeOf`).
- **One step of undo each.** A diamond click is a change without a group. An auto-keying field's group gets `@<at>` (`keyedGroup` in `Overlays.tsx`, and the Music volume in `Inspector.tsx`), so typing or sliding at one time is one step but a Keyframe at another time, within the history's 1.5 s, is its own. A Grips drag is one gesture as before.
- **The stage.** `StageControls.overlays.transformOf(id, time)` and `onTransform(id, transform, group, time)` take the time the stage's pictures are sampled at (`keyedAt ?? playback.time`), so a gesture is made from where the picture is drawn and keyed there. `AdvancedEdit` answers with `stageTransform` and `writeItemTransform` (from the tidied shown Transform, so a turn doesn't write an x Keyframe for the rounding of x); Crop mode's `onCrop` goes through `writeItemTransform` at the playhead. `heldPicture` drops a picture's motion, so a keyed picture held by a Grip is drawn where the drag puts it, not where its motion would.
- **Multi-item Pick.** No inspector shows a keyable field for several items (several Text Layers have none; anything else is `PickSummary`), so there is nothing to disable; `PickSummary` says "Some of them have Keyframes: pick one alone to change its keyed fields." when a picked Overlay or Music Clip is keyed.

Choices:
- **A Keyframe set closer than a frame to another replaces it**, not only within half a frame: the Candidate refuses two closer than a frame (less half a millisecond), and at 50 fps the next frame is 0.02 s away. The new one takes the playhead's time and the replaced one's Ease (replacing isn't adding, so a Custom Ease survives an auto-key); a new one takes the Ease of the one before.
- **Keyed fields are off outside the item**, rather than writing at its nearer end as Concat's `place_in` does: a Keyframe isn't written where it can't be seen. Unkeyed fields still change their constants there.
- **The inspector freezes while playing** at the last paused time, as the Grips do.
- **A 101st Keyframe is silently not added** (`setKey` returns the list as it is).
- **Moving several picked Overlays together** (`nudge`) still moves only their constants: a keyed one's x and y don't follow. Keyframes on several items at once are out of scope.
- **The Transform's Rotation field keeps its ±360° range**; a Keyframe may hold ±3600° (set by the agent).

By hand: driven by the agent in a browser (ego-browser) on the built frontend, against this worktree's backend on a copy of one Job (port 8001, a scratch DATA_DIR), with an image added to its Media Library. On an image Overlay: the X diamond at 0 s added a Keyframe at its value (nothing moved); ‹ and › went to 0 s and 2.3 s; a drag of the picture at 2.3 s wrote x at 2.273 s; typing 700 into X at 1.3 s wrote one at 1.274 s, and one Undo took exactly that one back; removing the first and then the last X Keyframe left x's constant at 452 (the value there), and two Undos brought them back one at a time; Reset dropped the x and scale Keyframes and Undo brought them back; past the Overlay, X and Fit and Fill were off with the note, and Y stayed on. On a Music Clip: the Volume diamond added a Keyframe, the slider at another time wrote a second, and outside the song the slider was off. Not tried: the phone's Transform sheet in a phone layout (it uses the same `OverlayTransform`), a video Overlay's keyed sound, and hearing or seeing the result in a rendered Clip.
