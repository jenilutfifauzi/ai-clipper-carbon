# 09: Fullscreen preview

**Parent spec:** `spec.md` in this feature folder (user stories 64–70; Implementation Decisions "Advanced Edit UI: Fullscreen").

**What to build:** F, or a button in the player bar, puts the whole stage full screen: the video, captions, hook, Text Layers, Overlays and Watermark.

- **The Fullscreen API** is used on the stage's container. On an iPhone, where only a `<video>` can go full screen, a fixed full-window layout is used instead.
- **Controls.** Play/pause, the time and an exit button show while the pointer moves, and hide after about 2 s without movement.
- **Stage editing is off** while full screen: no drags and no inline text.
- **Keys.** Space and the arrows keep working. F or Esc leaves.
- **The table.** The row `fullscreen` appears on the sheet. In the full-screen context, Escape gives `fullscreen-exit`.

**Blocked by:** 01 (keymap table).

**Status:** ready-for-agent

- [ ] Seam G: F gives `fullscreen`. Full screen, F and Escape give `fullscreen-exit`. Cmd+F gives nothing.
- [ ] Full screen on a desktop shows the whole Clip with its layers. Controls show and hide. Clicking a layer doesn't pick or move it.
- [ ] On an iPhone, the button fills the window, and the exit button returns.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
