# 11: Freeze frame in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 24–28; Solution "Freeze frame", "The Timeline", "Editing"; Implementation Decisions "The Advanced Edit"); ADR 0009, ADR 0004, ADR 0008.

**What to build:** on the desktop, the owner freezes the frame at the playhead with Freeze frame (Shift+F) and sets how long it holds.

- **The action,** among the item tools and on Shift+F, on the Segment under the playhead when it is at least 0.3 s from its edges on the Timeline (and not itself a Freeze frame):
  - split there into head, a 1 s Freeze frame of the frame shown at the playhead (at any Speed, in Reverse), and tail;
  - ripple an insertion of 1 s at the playhead (the layers after it follow while the Magnetic timeline is on);
  - a Transition after the Segment stays after the tail; none inside;
  - Keyframes re-anchored on head and tail; for a video, the Framing's values at that frame become the Freeze frame's constants;
  - the new Freeze frame is picked. One step of undo.
- **Its length:** dragging either edge changes `hold` (the frame stays), and the inspector shows a Duration field instead of the Speed section. Ripple follows the Magnetic timeline.
- **The Timeline:** its Filmstrip repeats its frame; no Waveform; a badge ❚❚ with its hold.
- **Shortcuts sheet** lists Shift+F; F stays full screen.

**Blocked by:** 05, 10.

**Status:** done

- [x] Shift+F at 3 s into a 6 s Segment gives 3 s, 1 s held, 3 s; a Text Layer at 5 s moves to 6 s with the Magnetic timeline on.
- [x] On a 2× Segment the held frame is the Source frame shown at the playhead.
- [x] On a keyed media Segment, the Freeze frame's Framing equals the picture shown at the playhead.
- [x] Dragging the Freeze frame's right edge to 2.5 s sets `hold` 2.5 and ripples by 1.5 s; the Duration field shows 2.5.
- [x] Shift+F within 0.3 s of a Segment's edge, or on a Freeze frame, does nothing.
- [x] Undo removes the Freeze frame and restores the Segment and the rippled items in one step.

## Comments

**2026-10-17: done.** All frontend, `pages/job/advanced/`; no backend change.

**What was built:**
- `actions.ts`: `freezeFrame(scene, at, {longest})`, `canFreezeAt`, `FREEZE_SECS` (1), and `freezer(scene, now, apply, limits)` (`{canFreeze, freeze}`, like `splitter`). It acts on the Segment under the playhead, picked or not (none on a locked Video Track). The cut is split's (`playedSourceAt`, then `scene.gap` between Words for the Source). The held frame is `playedSourceAt` at the playhead, to the millisecond, unsnapped. Head and tail go through `rekeyed` (in Reverse the head is the later part of the range: `{cut, end}`, the tail `{start, cut}`). A video's Freeze frame gets `framing.transform` from `shownTransform` at the playhead's seconds into the Segment, with no Keyframes (a turn past ±360° is folded within it), and keeps `media` and `volume`. A Transition `after` the Segment is moved to the tail's id. The insertion is rippled at the cut's Timeline time (`playedTimeAt`), through `rippledIf` as `insertSegment` does. Past the longest clip it is refused with a notice. The Freeze frame is picked; it is one `history.set`.
- `setHold(scene, id, secs, {longest})`: the inspector's Duration. It is a change at the Segment's end, rippled like a Speed change. setSpeed's ripple-at-end is now the shared `rippledAtEnd`.
- `split`'s `inside` refuses a Freeze frame, so it is neither split nor Split-all'd, and Freeze frame isn't offered on one.
- Trim (`MainTrack.tsx` `draggedSegments` → `draggedHold`): either edge of a Freeze frame changes `hold` by as far as the edge went out. It is at least 0.1 s (`MEDIA_MIN_SECS`, also the Timeline item's `minSecs` for it) and no longer than keeps the Main Track within the longest clip. `dragSegment` ripples it as any trim.
- Inspector (`SegmentFields`): a Freeze frame shows `HoldFields` (`SpeedFields.tsx`: the "Freeze frame" group, its Duration typed in seconds and set on blur or Enter, so a shortening ripple isn't made at every keystroke) in place of the Speed section. Its hint reads "Holds <its frame's time> of the episode · 1.0 s". It has no sound controls (no KeyedVolume, nor the Source sliders). The Framing fields (and so picture Keyframes) stay for a video's.
- Keymap: `freeze-frame`, Shift+F, in the Editing group of the sheet (F stays full screen; `commands.ts` `more.freeze`, false where none can be made). The item tools have a Freeze frame button (Snowflake icon) after Split, enabled while `canFreeze` at the playhead.
- Timeline (`Tracks.tsx`): `paceAlong(shown)` gives the Filmstrip a speed of 0 for a Freeze frame, so every tile shows its one frame. It has no Waveform (Source or video) and no Volume Line. It gets a `HoldBadge` ("❚❚ 1 s") beside 05's `SpeedBadge`, and ", held 1 s" in its accessible name.

**Tests:** `advanced/freezeFrame.test.ts` (13): the 6 s case with a Text Layer at 5 s → 6 s (Magnetic on and off) and the pick; a Source cut between Words; 2× (the Source frame at the playhead, head and tail 3 s at 2×); Reverse; a keyed video (scale and x sampled, the volume key dropped, head and tail re-keyed); a Transition moved after the tail; the refusals (edges, a Freeze frame, a locked Track, the longest clip); the edits untouched for undo; the right edge to 2.5 s (hold 2.5, the layer rippled 1.5 s), the left edge, 0.1 s and the longest; the Duration; the Filmstrip's repeated frame; Shift+F, F and the sheet. Full `npx vitest run` 590 passed, `tsc` clean, after merging main (09).

**Decided differently, or for later:**
- **The Source cut isn't at the frame.** As in Split, the head ends (and the tail starts) in the silence between Words nearest the frame, while the held frame is the one shown at the playhead. One of the two parts therefore plays through the frame, which is what ticket 10's planner frames the Freeze frame from. The ripple is at the cut, so the Clip is exactly 1 s longer.
- **A keyed Manual Layout Override isn't sampled** into the held Source Segment (10's note). Overrides are matched by Source time, and the held frame's time is inside the head or the tail too: an override written there would reframe them as well. So a keyed Manual Scene's Freeze frame shows the override's unkeyed Framing.
- **A Freeze frame's Keyframes on a left-edge drag** stay at their seconds from its start (the frame doesn't move, so there is nothing to keep them on).
- **Not checked in the browser** (no Job with a running backend in this worktree). The UI is typechecked and the actions tested.
- **08 (Reverse trim/split):** `freezeFrame` builds its reversed head and tail itself, from `segment.start`/`end` (a reversed media Segment isn't snapped). Split's forward-only `first`/`second` is untouched.
- **12 (phone):** use `freezer` (from `AdvancedEdit`'s `freezes`) for the toolbar's Freeze frame beside Split. `HoldFields` works in the inspector sheet as it is.

**Review fixes (2026-10-17): the cut is at the playhead, a Source Segment's too** (the owner decided, overturning "The Source cut isn't at the frame" above). `freezeFrame` cuts at `playedSourceAt` at the playhead, to the millisecond, for the Source as for a video: the head ends and the tail starts on the held frame (the Freeze frame's `start`), so the Clip gets 1 s longer exactly at the playhead with nothing played twice or skipped. The backend (review fix F1) leaves a Source Segment's end unsnapped where it touches a held Segment of that Source time. `freezeFrame.test.ts`: the Source case now cuts at 103.25 although `gap` gives another time, and a reversed 2× Source Segment's head and tail meet at the held frame. Split still cuts between Words.
