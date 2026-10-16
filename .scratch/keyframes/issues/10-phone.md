# 10: Keyframes on a phone

**Parent spec:** `spec.md` (user stories 40–41; Solution "On a phone").

**What to build:** on a phone, the Advanced Edit's inspector sheets have the same ‹ ◆ › beside each keyable field, with the same auto-key.
- The sheet shows an Ease picker for the Keyframe at the playhead.
- The ruler shows the picked item's diamonds.
- The Keyframes pane, its Dopesheet and its Curves stay on the desktop.
- Tap targets follow the phone sheet's existing sizes.

**Blocked by:** 06, 08

**Status:** done

- [ ] By hand on a phone, Safari and Chrome:
  - [ ] a Ken Burns on an image Overlay made from the sheet;
  - [ ] an Ease picked for it;
  - [ ] the ruler diamonds tapped to jump.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done**, apart from the check on a real phone (see the end). Built test first where there is something pure to test, at Seams D and E. The rest is wiring in the phone's sheets, the ruler and the Volume Line.

- **The sheets already had the ‹ ◆ › and auto-key.** I checked every sheet with a keyable field. The Edit sheet is the inspector itself, inside the `KeyingContext`. On an Overlay it has the Transform's five fields, plus "Its sound" on a video with sound. On a Music Clip it has Volume. On a video Segment it has the Framing's five fields plus "Its sound". The Transform sheet has the five picture fields of an Overlay's Transform or a video Segment's Framing. Nothing was missing.
- **Tap targets.** `Sheet` (`Chrome.tsx`) carries `data-sheet`. Inside it (Tailwind's `in-data-sheet:`), a `KeyCluster`'s buttons are 32×44 px instead of 28×28: as tall as the sheet's other buttons, and narrow enough for three beside "Rotation" in a 390 px wide half column. The cluster's negative margin is dropped there. The desktop's inspector and Keyframes pane are unchanged: the pane's rows stay 32 px and its clusters 28 px.
- **The Ease picker** is `advanced/KeyEase.tsx`:
  - `SheetEase({mediaById, shown?})` reads `KeyingContext`. It shows the Ease of the picked item's Keyframe at the playhead, or of the next eased one (09's `easedKey`), on the active row (`activeKey`) when that row is keyed, else on the first keyed property. It is labelled with that property ("Scale Ease"). Setting it is one change, through `setItemKeys` and `setEase`.
  - It draws nothing without one keyable item picked with Keyframes. It is off with the playhead outside the item, with a note. Below it, a note says "Of the next Scale Keyframe." when the Ease it shows is the next Keyframe's.
  - `AdvancedEdit` puts it at the head of the phone's Edit sheet, and of its Transform sheet with `shown={PICTURE_KEYS}`. The Transform sheet has no Volume field, so a Segment keyed only in its sound shows no picker there.
  - `EaseSelect` (the presets, plus Custom shown but not pickable) and the property labels (`KEY_FIELDS`, which were `FIELDS`) moved out of `KeyframesPane.tsx` into `KeyEase.tsx`. The pane imports them and is otherwise unchanged. In a sheet the select is 44 px tall at 16 px text, so iOS doesn't zoom on it.
- **Ruler diamonds under a finger** (`KeyMarks` in `AdvancedTimeline.tsx`):
  - With `pointer-coarse:`, a diamond's hit area is the ruler's whole height, 32×28 px instead of 20×16. The diamond itself is drawn where it was.
  - A touch press counts as a tap until it moves the Timeline's tap slop (`TAP_SLOP_PX`, 8 px). Before, it was a drag after 3 px, so a finger's wobble would retime the Keyframes instead of jumping to them. A mouse keeps 3 px.
  - The phone's Timeline already got `keyMarks`, the same as the desktop's.
- **The Keyframes pane, its Dopesheet and its Curves stay desktop-only.** The phone layout never renders `BottomTabs` or `KeyframesPane`.
- **A keyed media Segment's Volume Line follows its curve** (the gap left by 04 and 08):
  - Seam E: `segmentHeard(segment, shown)` in `timelineView.ts` gives a `Heard` from the Segment's volume and `keys.volume`, with no fades, over what is drawn of it. That runs from `shown.start`, where `segmentSpan` starts it, to where a Transition cuts it short.
  - `Tracks.tsx` passes `keyed` to its `VolumeLine` once it has volume Keyframes, so it draws the polyline with 08's knob at the playhead. Its Waveform's gain follows the same curve, as a Music Clip's does.
  - `AdvancedEdit`'s `onVolume` now sends both kinds through `writeItemKey({...scene, track}, …)`. It writes a Keyframe once the sound is keyed, and the constant otherwise. `setVolume` is no longer used there.
  - Seam D (`keyedSegments.test.ts`): an unkeyed Segment's drag sets its volume; a keyed one writes a Keyframe at the playhead, measured from where a Transition into it starts it; nothing is written outside it.

Choices:
- **The phone's Ease picker acts on the active row, not on every property at the instant.** The Keyframes pane's Ease does the same, and so does `easedKey`. Its label names the property. Touching a field or a cluster switches it. On a phone a Ken Burns of Scale and X takes two picks, one per property.
- **Sizes scoped to the sheet, not to `pointer-coarse`, for the clusters.** On a touch laptop the pane's 32 px rows would overlap 44 px clusters. The ruler has no sheet to scope to, so its diamonds use `pointer-coarse:`, as the stage's Grips do.
- **The picker heads the sheet and isn't sticky.** The sheets' glass is translucent, so a sticky header would show the fields scrolling under it.

By hand: driven by the agent in ego-browser's Chromium with device emulation (390×844, mobile, touch: `(pointer: coarse)` matched and the phone layout showed). Built frontend, served by this worktree's backend on port 8010 with a scratch copy of the Job used for 08. Its Overlays were cleared, and a video Segment with volume Keyframes (1 → 0.3) was added through the API.
- **A Ken Burns made from the sheet.** The logo image was added from the Media sheet and its Transform sheet opened. At 0 s, Scale's ◆ keyed 50% and X's ◆ keyed 540 px. At 2.5 s, typing 80 into Scale and 400 into X auto-keyed both. Saved: `scale` 0.5 → 0.8 and `x` 540 → 400, both from 0 to 2.5 s.
- **An Ease picked for it.** The sheet's picker read "X Ease: Linear". Ease out stored `[0, 0, 0.58, 1]` on x's Keyframe at 2.5 s. After typing into Scale it read "Scale Ease", and Ease in-out stored `[0.42, 0, 0.58, 1]` on scale's. Custom was listed but off. The select measured 160×44 px at 16 px text, and the cluster buttons 32×44.
- **The ruler diamonds tapped**, with CDP touch events:
  - A tap 6 px off the 2.5 s diamond's centre moved the playhead to 2.5 s.
  - A tap on the 0 s diamond that wobbled 5 px moved it to 0 s and moved no Keyframe.
  - A 30 px touch drag of the last diamond moved x's and scale's Keyframes together, held at the Overlay's end (3 s).
- **The Segment.** Its Volume Line drew the curve. A 18 px touch drag of its knob at 11.5 s wrote a volume Keyframe of 0.38 at 1.65 s of the Segment (from the planned start) and left its constant at 1.
- **The sheets.** The Segment's Edit sheet had the five Framing clusters plus "Its sound", headed by "Volume Ease". Its Transform sheet had the five, with no picker. The Music Clip's Edit sheet had Volume's cluster and "Volume Ease".
- **The desktop** (1428 px): the Keyframes pane's Ease select was still 32 px at 14 px text, and its clusters 28 px.

Not checked: **Safari and Chrome on a real phone.** That needs a device, which this environment doesn't have. Emulated Chromium is not iOS Safari: its select picker, its touch and its 16 px zoom rule are only approximated here. That is left to ticket 11's phone line. Also not checked: a pinch on the stage writing Keyframes (the same `writeItemTransform` as the desktop's Grips) and hearing the keyed Segment's sound.
