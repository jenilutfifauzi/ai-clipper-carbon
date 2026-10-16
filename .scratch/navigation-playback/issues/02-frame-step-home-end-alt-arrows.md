# 02: Frame step, Home/End, and Alt+arrows move the Pick

**Parent spec:** `spec.md` in this feature folder (user stories 1–9, 15–20; Implementation Decisions "Navigation math: Frame grid", "Advanced Edit UI: Focus").

**What to build:** ←/→ belong to the playhead, as in Concat.

- **Frame step.**
  - ← and → step one frame of the Clip; with Shift, ten frames.
  - A frame is 1/fps, where fps is the Preview Plan's (30 until a plan arrives).
  - The playhead lands on the frame grid, `(round(t·fps)+n)/fps`. Stepping pauses playback.
  - It is clamped to 0 and to the last frame (`duration − 1/fps`).
- **Home and End.** Home goes to 0. End goes to the last frame.
- **Moving the Pick.**
  - Moving the picked Text Layers, Music Clips and Overlays moves from bare arrows to Alt+←/→: one frame, or ten with Alt+Shift.
  - A run of presses keeps its undo group, so it undoes as one step.
- **Focus.**
  - Pointer-down on a Timeline item no longer gives it the keyboard focus, so ←/→ keep stepping after a click.
  - An item reached with Tab keeps its own arrows: move, Shift trims its end, Alt ×10.
- **The Timeline follows the playhead.**
  - The playhead's rounding on the Timeline uses the Clip's fps instead of 1/30 s.
  - The Timeline scrolls to keep the playhead in view after a step or a jump.
- **The table.** The new rows (`step-back`, `step-forward`, their ×10 forms, `move-back`, `move-forward` and their ×10 forms, `start`, `end`) appear on the sheet.

**Blocked by:** 01 (keymap table).

**Status:** done

- [x] Seam E (vitest), worked examples:
  - [x] stepping +1 and −10 at 25, 30 and 60 fps from a time between frames;
  - [x] clamping at 0 and at the last frame;
  - [x] End on a 10 s Clip at 30 fps is 9.9667.
- [x] Seam G: → gives `step-forward`, Shift+→ gives `step-forward-10`, Alt+→ gives `move-forward`, and Alt+Shift+→ gives `move-forward-10`. With a Tab-focused item, ←/→ give nothing.
- [ ] Clicking a Text Layer and pressing → steps the playhead, and the layer stays put. Alt+→ moves it one frame. Three Alt+→ presses undo with one Cmd+Z.
- [ ] Tab to an item, then →, moves it as today.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. The frame grid is a small pure module beside the Timeline-view one, `frontend/src/pages/job/advanced/playhead.ts` (tested in `playhead.test.ts`), kept apart so that the zoom and Edit Point tickets can extend `timelineView.ts` without meeting it: `onFrame(time, fps)` puts a time on its nearest frame, `stepFrames(time, frames, { fps, duration })` steps from the nearest frame and clamps to 0 and the last frame, `lastFrame(duration, fps)` is that last frame, and `revealScroll(x, { scroll, width })` is the scroll that shows the playhead. `DEFAULT_FPS` is 30. The table's new rows are `step-back`, `step-forward`, `step-back-10`, `step-forward-10`, `start` and `end`, under navigation; `move-back`, `move-forward` and their ×10 forms moved to Alt and Alt+Shift, a frame and ten frames, and keep their undo group (`key:move`). The Advanced Edit takes fps from the Preview Plan (`preview?.plan.fps`, 30 until one arrives) for the steps, the moves and the Timeline's playhead, which is now drawn on the Clip's frames. A step pauses first; Home and End only seek, so that Home while playing plays on from the start.

Two choices the spec left open. The last frame is the last one wholly in the Clip, `(floor(duration·fps) − 1)/fps`: the spec's `duration − 1/fps` for a Clip that ends on a frame (9.9667 for 10 s at 30 fps), and still on the grid for one that ends between frames (10.01 s at 30 fps gives 9.9667 too). And the Timeline follows any playhead that moves while paused and lands out of view, with no call from the keys: it scrolls just far enough to bring it 48 px inside the edge it went past. A time that stays the same (an edit re-seeking it) leaves the view where the owner scrolled it, playback doesn't scroll it, and a pause after playing off screen brings it back.

Pressing on the Timeline (its items, its join diamonds, its caption lines, its buttons and the zoom buttons above it) no longer gives the focus: a `mousedown` there on a button or `role=button` is prevented, and whatever had the focus is blurred, as a press elsewhere would. Tab still reaches every item, which keeps its own arrows (0.1 s, Shift its end, Alt ×10) as before.

Not tried in the browser: clicking a Text Layer then →, Alt+→ and its undo, and Tab then →, are left for the walkthrough (11). Also worth a look there: Alt+← with nothing picked is left to the browser, as every shortcut that can't run is, which on Windows and Linux is Back; and in Firefox a prevented `mousedown` drops the `:active` grabbing cursor on items.
