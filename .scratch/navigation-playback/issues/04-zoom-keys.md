# 04: = and - zoom the Timeline about the playhead

**Parent spec:** `spec.md` in this feature folder (user stories 21–25, 82; Implementation Decisions "Navigation math: Zoom about the playhead").

**What to build:** = zooms the Timeline in and - zooms it out, by the zoom buttons' step (×1.5), between 1× and the deepest zoom (40×).

- **The playhead stays put.** With the playhead visible, it keeps its place on screen. With it off-screen, the zoom centres it.
- **A pure function** takes the zoom, the scroll, the Timeline's width, the playhead's time and the factor. It gives the new zoom and scroll.
- **The browser keeps its keys.** Cmd/Ctrl+= and Cmd/Ctrl+- stay the browser's page zoom.
- **The table.** The rows `zoom-in` and `zoom-out` appear on the sheet. Shift+Z (fit) is unchanged.

**Blocked by:** 01 (keymap table).

**Status:** ready-for-agent

- [ ] Seam E (vitest), worked examples:
  - [ ] the playhead visible keeps its screen x;
  - [ ] the playhead off-screen is centred;
  - [ ] clamping at 1× and 40×.
- [ ] Seam G: `=` gives `zoom-in` and `-` gives `zoom-out`. Cmd+= gives nothing.
- [ ] In the Advanced Edit, = and - zoom about the playhead. Cmd+= still zooms the page.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
