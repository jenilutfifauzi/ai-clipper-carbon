# 09: Fullscreen preview

**Parent spec:** `spec.md` in this feature folder (user stories 64–70; Implementation Decisions "Advanced Edit UI: Fullscreen").

**What to build:** F, or a button in the player bar, puts the whole stage full screen: the video, captions, hook, Text Layers, Overlays and Watermark.

- **The Fullscreen API** is used on the stage's container. On an iPhone, where only a `<video>` can go full screen, a fixed full-window layout is used instead.
- **Controls.** Play/pause, the time and an exit button show while the pointer moves, and hide after about 2 s without movement.
- **Stage editing is off** while full screen: no drags and no inline text.
- **Keys.** Space and the arrows keep working. F or Esc leaves.
- **The table.** The row `fullscreen` appears on the sheet. In the full-screen context, Escape gives `fullscreen-exit`.

**Blocked by:** 01 (keymap table).

**Status:** done

- [x] Seam G: F gives `fullscreen`. Full screen, F and Escape give `fullscreen-exit`. Cmd+F gives nothing.
- [ ] Full screen on a desktop shows the whole Clip with its layers. Controls show and hide. Clicking a layer doesn't pick or move it.
- [ ] On an iPhone, the button fills the window, and the exit button returns.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. Two rows join the table in `keymap.ts`: `fullscreen` (F, only not full screen) and `fullscreen-exit` (F and Escape, only full screen), both in the view group. `pick-none` is now only not full screen, so Escape there leaves full screen instead. Cmd+F stays the browser's. `useShortcuts` passes `fullscreen` in the context and runs both ids. `fullscreen.ts` holds the rest: `fullscreenWay(document)` (tested in `fullscreen.test.ts`) says whether the page can put an element full screen (`fullscreenEnabled`, or Safari's `webkitFullscreenEnabled`) or, on an iPhone, lays it over the whole window instead; `useFullscreen(ref)` enters and leaves either way, and follows `fullscreenchange` (and the webkit one), so leaving by the browser's Esc or its own button keeps the state right; `useControls(on)` shows the controls for 2 s after the pointer moves or taps.

What goes full screen is the player's room in `AdvancedEdit.tsx`: the stage and its player bar on black. The controls are the player bar itself (play/pause, the scrubber, the time, and the fullscreen button, which becomes the leave button full screen). It fades out, and the pointer hides, while the pointer is still; a move or a tap shows it again, and so does the keyboard's focus in it. On a phone it is the same button in the same bar. Over the window, the room is `fixed inset-0` above the page, inside the safe area.

Stage editing is off because the preview gets no `stage` and no `overlays` controls while full screen: nothing on the stage is picked, moved, resized or retyped, and no outlines or handles are drawn. Going full screen or back first blurs what has the focus. That puts down text being retyped on the stage (it saves on blur), and keeps Space playing rather than pressing the button. `ClipPreview` gains only `tools` (the end of the compact player bar) and `hideBar`.

One thing beyond the ticket: full screen, the layout (desktop or phone) stays the one it was entered from, and the room counts as full screen from the asking on. Otherwise a narrow window growing to the screen would swap the layout, take the preview out of the page, and so out of full screen.

Not tried in the browser: the whole Clip with its layers full screen on a desktop (Chrome and Safari), the controls showing and hiding, clicks on a layer doing nothing, and an iPhone filling the window and coming back. These are left for the walkthrough (11).
