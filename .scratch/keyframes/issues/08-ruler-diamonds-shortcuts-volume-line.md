# 08: Diamonds on the ruler, K [ ], and keying the Volume Line

**Parent spec:** `spec.md` (user stories 14, 21, 25–26; Solution "Diamonds on the ruler", "The Volume Line follows the curve", "Shortcuts").

**What to build:** the owner sees where the picked item changes without opening a pane, and keys from the keyboard and the Timeline.
- **Ruler diamonds.** While the Pick is one keyed item, the ruler's floor shows a diamond per instant, every property together.
  - A click moves the playhead there.
  - A drag moves every Keyframe at that instant, snapped to frames and never past a neighbour, as one step of undo.
- **Shortcuts.**
  - K toggles a Keyframe at the playhead on the active row: the property last touched, else the first keyed one, else Scale (Volume for a Music Clip).
  - [ and ] move the playhead to the item's previous and next Keyframe.
  - They are in the keymap table and the shortcuts sheet.
- **The Volume Line.** Dragging it on an item with volume Keyframes writes a volume Keyframe at the playhead. Outside the item the drag is off.

**Blocked by:** 06

**Status:** done

- [x] Seam E: the ruler diamonds of one picked item, one per instant across properties, merged within half a frame, at their Timeline times.
- [x] Seam D: moving every Keyframe at an instant moves every property's together, snapped to frames, never past a neighbour.
- [x] Seam G: K, [ and ] resolve to their commands, and not while typing in a field.
- [x] By hand: dragging a ruler diamond retimes a move; dragging the Volume Line on a keyed Music Clip adds a Keyframe.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built test first at Seams D, E and G, plus the items' layer in `advanced/keying.test.ts` and the commands in `advanced/commands.test.ts`.

- **Seam D, the pure action:** `moveKeysAt(keys, from, to, grid: KeyGrid)` in `frontend/src/pages/job/editor/keyframes.ts` (tested in `editor/keyActions.test.ts`). Every property's Keyframe within half a frame of `from` (by `keyAt`) goes to one time, with its value and Ease: within the item and at least `KEY_GAP_SECS` from each moved Keyframe's own neighbours, on the Clip's frames. It uses the same snapping rule as 09's `moveKey`, now one private `onGrid(to, low, high, grid)` that both call. The time is kept to the millisecond. It returns `{keys, at}`: the same `keys` object when nothing moves, and null when no Keyframe is at `from`.
- **On the items:** `advanced/keying.ts` gained:
  - `moveItemKeys(scene, ref, from, to, fps)`, in Timeline time. It returns an `Outcome` plus `at`, the scene's own edits when nothing moved, and null when nothing is at `from` or the Track is locked. It doesn't change `withKeyed`: it passes the first keyed property's constant back as it was.
  - `pickedKeyed(pick)`: the one picked Overlay, Music Clip or Segment as a `KeyedRef`. A Source Segment has no `keyedItem`, so nothing is shown for it.
  - `keyAround(item, time, direction)`: the Timeline time of the item's Keyframe before or after `time`, any property, beyond half a frame (`keysAround` over all of them).
- **Seam E:** `keyMarks({start, keys})` in `advanced/timelineView.ts` gives the instants in Timeline time, sorted. A Keyframe within half a frame of an instant's first one joins that instant, the same rule `keyAt` uses for a drag.
- **The ruler:** `AdvancedTimeline` takes `keyMarks?: KeyMarksOf` (`{marks, onMove(from, to, group)}`). `KeyMarks` draws accent diamonds on the ruler's floor, for marks within the Clip, with a 20×16 px hit area. A press that moves less than 3 px is a click and seeks to the mark. Anything longer is a drag, which calls `onMove(grabbedMark, grabbedMark + dx/pps, "drag:keys:<n>")`.
  - The press is captured by the diamonds' zero-height row, not by a diamond. A diamond can be drawn again, or merge with another, mid-drag without losing the press.
  - `AdvancedEdit.moveKeys` is held from the render it was grabbed in, so every move starts from the edits as they were at the grab. Dragging back to the start puts the Keyframes back. A drag only enters the history once it moves something, so a drag that moves nothing leaves no undo step.
- **Seam G:** keymap rows `key-toggle` (K, editing), `key-previous` ([) and `key-next` (]) (navigation), so they appear in the shortcuts sheet. `commandsOf` takes `more.keyframes: {toggle, around} | null`.
  - [ and ] pause and seek exactly to the Keyframe, not to the frame grid, so that the ‹ ◆ › show it as "here". With no Keyframe that way, the playhead stays.
  - With no keyable single item picked, all three return false and are left to the browser. K outside the item does the same.
  - Cmd+[ and Cmd+] stay the browser's.
- **The active row is 09's, merged:** `Keying.touched?: KeyProperty | null` and `onTouch?(property)`, held in `AdvancedEdit`. Clusters and pane rows set it.
  - K keys `activeKey(keyRows(edits, ref, mediaById), keyed.keys, touched)`.
  - `keyRows(edits, ref, mediaById)` is new in `keying.ts`: `keyableOf` with the item's Media Library item looked up. The Keyframes pane now uses it and `pickedKeyed` too, instead of its own copies.
  - `useTouch()` in `KeyCluster.tsx` is new. It returns `(property) => void`, which `TransformFields`' picture fields and an Overlay's "Its sound" slider call as they change, so typing in a field touches its row too, not only its cluster.
- **The Volume Line:** `Tracks.tsx`'s `VolumeLine` takes `keyed?: {heard, start, playback}` instead of `line`/`secs`. `KeyedVolumeLine` draws the polyline as before.
  - On a picked item of an unlocked Track, with the playhead inside what is heard, it adds a knob on the line at the playhead (`useKeyTime`, so it stays put while playing). Dragging the knob changes the volume, starting from the keyed value there (`valueAt`, without the fades), through `onVolume`. Outside the item there is no knob.
  - `AdvancedEdit`'s `onVolume` now sends a Music Clip through `writeItemKey` at `playback.time`: a Keyframe at the playhead once it has volume Keyframes, else the constant. A Segment still goes through `setVolume`.
- **Merged with 04 (keyed media Segments):** the ruler diamonds, K and [ ] work on a picked video Segment too. `moveItemKeys` and `AdvancedEdit`'s keyed calls pass the planned `track`, the same one `KeyingContext` carries.
  - **Left over:** a media Segment's Volume Line still draws its constant and sets it, even when the Segment has volume Keyframes. The fix is to pass `keyed` to its `VolumeLine` (a `Heard` with no fades and its `keys.volume`, from `segmentSpan`'s start) and send `segment` through `writeItemKey` in `onVolume`.

Choices:
- **Ruler diamonds show, and work, with the playhead outside the item.** The spec's "off while the playhead is outside it" covers the inspector's diamonds and the pane. A ruler diamond is how the playhead gets *into* the item, and a drag doesn't depend on the playhead.
- **"Never past a neighbour" means each moved property's own neighbours.** An instant can be dragged onto another property's instant, and their diamonds then merge, as in Concat.
- **K at a time off the frame grid** (after a ruler click) keys at the playhead's millisecond, as the inspector's diamond does.

By hand, driven in a browser (ego-browser) on the built frontend, against this worktree's backend on port 8008 with a scratch copy of the Job used for 06 (the Source is 25 fps):
- With the keyed logo Overlay picked, diamonds showed at 0 s and 2.273 s.
- Clicking the second diamond moved the playhead to 0:02.3. [ took it to 0:00.0 and ] back to 0:02.3.
- Dragging that diamond about 35 px right moved both x and scale from 2.273 s to 2.84 s, a 25 fps frame, in the saved Candidate. One Cmd+Z put both back at 2.273 s.
- Dragging it far left stopped both at 0.04 s, one frame after x's Keyframe at 0 s.
- At 1 s with nothing touched, K added an x Keyframe (the first keyed property), and K again removed it. After typing 10 into Rotation, K added a rotation Keyframe.
- On the keyed Music Clip at 3 s, the Volume Line had a knob at the playhead. Dragging it 17 px down wrote a volume Keyframe of 0.52 at 1.761 s of the clip, between its two others, and the inspector showed 52%. With the playhead at 0:20.0, outside the clip, there was no knob.

After merging 09, on a fresh copy of the data: K at 1 s added an x Keyframe (its active row with nothing touched), and dragging the last diamond moved x and scale together to 2.76 s.

Not tried: the phone layout (the ruler diamonds are the same component), a touch drag, a video Overlay's keyed sound, and hearing the result.
