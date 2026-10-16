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

**Status:** ready-for-agent

- [ ] Seam E (vitest), worked examples:
  - [ ] stepping +1 and −10 at 25, 30 and 60 fps from a time between frames;
  - [ ] clamping at 0 and at the last frame;
  - [ ] End on a 10 s Clip at 30 fps is 9.9667.
- [ ] Seam G: → gives `step-forward`, Shift+→ gives `step-forward-10`, Alt+→ gives `move-forward`, and Alt+Shift+→ gives `move-forward-10`. With a Tab-focused item, ←/→ give nothing.
- [ ] Clicking a Text Layer and pressing → steps the playhead, and the layer stays put. Alt+→ moves it one frame. Three Alt+→ presses undo with one Cmd+Z.
- [ ] Tab to an item, then →, moves it as today.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
