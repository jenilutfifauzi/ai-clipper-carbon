# 09: The Keyframes pane

**Parent spec:** `spec.md` (user stories 9–10, 27–32; Solution "The Keyframes pane"; Implementation Decisions "The bottom tabs").

**What to build:** on the desktop, the bottom of the Advanced Edit has two tabs, Timeline and Keyframes. The browser remembers the choice.

With no single item picked, the Keyframes pane says "Pick one item to edit its Keyframes". With one item, it has:
- **A tool strip:**
  - Dopesheet / Curves;
  - ‹ ◆ › for the active row;
  - the Ease of the Keyframe at the playhead, or of the next eased one: Linear, Ease in, Ease out, Ease in-out, or Custom;
  - Clear all Keyframes.
- **A row per keyable property,** with its value field and its own ‹ ◆ ›. Clicking a row makes it the active row, the one K acts on.
- **A ruler in the item's own seconds.** Clicking or dragging it moves the playhead.
- **The Dopesheet:** a lane per row. Diamonds are clicked to jump and dragged to retime, snapped to frames and never past a neighbour.
- **The Curves:** each keyed row's curve, faint and scaled to its own range, and the active row's drawn bold with its range's labels.
  - A Keyframe's dot drags in time and value.
  - Two Ease handles per span; dragging one makes the Ease Custom.
- **The playhead,** drawn over both views.

Each drag, and Clear all, is one step of undo. The tab bar is minimal, so that `workspace-layout` (roadmap #22) can absorb it later.

**Blocked by:** 06

**Status:** done

- [x] Seam D:
  - [x] setting an Ease by preset stores its four numbers, and a handle drag stores Custom ones, `x` kept within 0..1;
  - [x] Clear all removes every property's Keyframes;
  - [x] a dopesheet drag moves one Keyframe, snapped, never past a neighbour.
- [x] The Curves' drawing of a span matches the sampling module at a few points: a pure test of the curve path against the shared Ease vectors.
- [x] By hand: an overshoot made with the Ease handles plays the same in the preview and the Clip.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built test first at Seam D (`editor/keyActions.test.ts`, `advanced/keying.test.ts`) and in a new pure test of the Curves (`advanced/curves.test.ts`).

- **The pure actions** are appended to `frontend/src/pages/job/editor/keyframes.ts`: `EASE_PRESETS` (name, label, Ease), `EaseName`, `easeName(ease)` (a preset within 0.005 of each number, as `ease_name`, else "custom"), `tidyEase` (as `tidy_ease`: x to 0..1, y to −2..3, Linear when not finite), `setEase(keys, index, ease)`, `handleEase(ease, 1 | 2, x, y)` (a handle dragged to shares of its span: a Custom Ease, tidied, to a thousandth), `easedKey(keys, at)` (the Keyframe at the playhead, else the next one; never the first, whose Ease is unused; -1), `KeyGrid {fps, start, secs}` and `moveKey(keys, index, to, grid, value?)` (onto the nearest frame **of the Clip** — `start + at` on the Timeline's frame grid, so the playhead can stop on it — held a frame inside its neighbours and within its item, a frame where there is one; with `{prop, value}` the value too, held to the property's range). `RANGES` is now exported as `KEY_RANGES`.
- **On the item** (`advanced/keying.ts`): `keyableOf(ref, media?)` (the pane's rows: the five picture fields, plus `volume` for a video Overlay with sound; `volume` for a Music Clip), `activeKey(rows, keys, touched)` (the active row: the property last touched, else the first keyed one, else Scale, else the first row — Volume for a Music Clip), `setItemKeys(scene, ref, prop, list)` (a property's list replaced, one change; null on a locked Track) and `clearItemKeys(scene, ref, time)` (Clear all). `withKeyed` now keeps a rotation constant within ±360° (`% 360`), since a Keyframe may hold ±3600° and the Transform refuses more than 360: removing the last rotation Keyframe at 720° used to write a constant the Candidate refuses.
- **The Curves' geometry** is `advanced/curves.ts` (pure): `Plot {secs, low, high}`, `plotPoint`, `plotValue`, `plotTime`, `curvePath(keys, plot)` (an SVG path in the unit square: held to the first Keyframe, one cubic per span whose control points are the Ease's handles scaled to the span, held after the last; Concat's `marks_and_curve`), `easeHandles(keys, index, plot)` and `handleShares(keys, index, plot, point)` (y null on a flat span: the Ease keeps its y), `curveRange(prop, keys)` (the curve's own range, overshoot sampled 24 times a span, 15% room each side, a flat one a band of a twentieth of the property's range). The test walks the path's cubics by bisection and checks each shared Ease vector against `valueAt` within 1e-4.
- **The active row is shared state** in `KeyingContext` (`advanced/KeyCluster.tsx`): `Keying` gains `touched?: KeyProperty | null` and `onTouch?(prop)`, and `onEdits` takes an optional `group`. `AdvancedEdit` keeps `touched` in a `useState` and passes `onEdits: (next, group) => history.set(next, group)`. Every `KeyCluster` (inspector, pane, phone sheet) calls `onTouch` on its ‹, ◆ and ›; a pane row, lane, dot or handle pressed does too. **Ticket 08's K resolves `activeKey(keyableOf(ref, media), keys, keying.touched)`** — the same row the pane shows.
- **The tabs** are `advanced/BottomTabs.tsx`: `useBottomTab()` (a `rememberedSwitch("ai-clipper-keyframes-pane")`, so storage is wrapped as Magnetic's and Skim's are), `BottomTabs` (a bare `tablist` of two `tab`s) and `bottomPanelId`. On the desktop the bottom section holds the tab bar, the Timeline (kept mounted and hidden under the pane, so its zoom and scroll survive) and the pane; it grows from 36 to 44 dvh while the Keyframes tab is open (the rows and the Curves need the room). The phone is unchanged.
- **The pane** is `advanced/KeyframesPane.tsx`: `KeyframesPane({keying, fps, mediaById})`, the empty state "Pick one item to edit its Keyframes" unless the Pick is exactly one Overlay or Music Clip (04 and 05 add their kinds to `KeyedRef`, `keyedItem`, `keyableOf` and the `ref` built at the top of `KeyframesPane`). Tool strip: Dopesheet / Curves, the active row's `KeyCluster`, the Ease select (presets, and Custom shown but not pickable; "None" and off when no Keyframe eases in at or after the playhead), Clear all Keyframes. Rows: name, a value field at the playhead (auto-keys through `writeItemKey`, grouped by `keyedGroup`), the row's `KeyCluster`. A ruler in the item's seconds (press or drag seeks). The Dopesheet's diamonds and the Curves' dots and handles are buttons dragged by pointer capture; each drag is one `drag:keyframes:<n>` group, so one step of undo, computed from the list as it was when pressed. A press on a diamond or dot takes the playhead to it and the playhead follows the drag; a press that moves less than 3 px is a click and writes nothing. In the Curves the dragged row's plot is held still for the drag, the dot's value held to it and rounded to a thousandth of its range. The playhead (live, on frames) is drawn over the ruler and both views, and not drawn outside the item.

Choices:
- **"Off outside the item"**: the Ease select, Clear all and a keyed row's field are off while the playhead is outside the item, with a note; drags aren't, because pressing a Keyframe brings the playhead to it first.
- **Clear all leaves each constant at its value at the playhead** (at the item's nearer end outside it), as removing the last Keyframe does, so that nothing jumps where the owner is looking.
- **Snapped to the Clip's frames**, not to whole frames of the item's own seconds: an item starts on a hundredth, not always on a frame.
- **"Its own range"** is the curve's own values (with overshoot), not the property's whole range: a Ken Burns from 100% to 115% would be flat over 5%..800%.
- **‹ and › in the strip** are the active row's (the spec), not Concat's "any property" (that is 08's [ and ]).
- **A handle over its dot**: a Linear span's handles sit on its dots; the handles are drawn over the dots, with a smaller hit area, so both can be taken.

By hand: driven by the agent in a browser (ego-browser, 1428×730) on the built frontend against this worktree's backend on a copy of one Job (port 8001, a scratch DATA_DIR), with a video Overlay keyed in `x` (200 → 800, Ease in-out) and `scale` through the API. Empty state shown with nothing picked; picking the Overlay showed six rows (Volume too); a diamond dragged from 3 s went to 4.00 s with the playhead following, and one Undo put it back at 3.00 s; the first Ease handle dragged above the span's end made the Ease Custom (`[0.494, 1.171, 0.58, 1]`, x within 0..1) and the X field read 803.8 px at 2.5 s, past 800; Ease out from the select stored `[0, 0, 0.58, 1]`; Clear all left `keys: {}` with X at its value at the playhead, and one Undo brought them all back; a Curves dot dragged moved in time and value as one step; typing 300 into X at 1.5 s wrote a Keyframe there; the Keyframes tab was still open after a reload. **The overshoot in the Clip**: with a 10 px green border on the Overlay, the rendered Clip's frames put its left and top edges at (402, 316), (504, 256) and (498, 158) at 3.0, 3.5 and 4.5 s, against (402.9, 316.0), (501.4, 258.8) and (500.2, 160.3) from the samples the preview draws (the pane's 803.8 px and 56.2% at 4.5 s) — within 2–3 px, the frames being a frame's seek apart. Not tried: a Music Clip's single Volume row, and the pane with the Overlay Track locked (a locked item can't be picked).
