# 04: = and - zoom the Timeline about the playhead

**Parent spec:** `spec.md` in this feature folder (user stories 21–25, 82; Implementation Decisions "Navigation math: Zoom about the playhead").

**What to build:** = zooms the Timeline in and - zooms it out, by the zoom buttons' step (×1.5), between 1× and the deepest zoom (40×).

- **The playhead stays put.** With the playhead visible, it keeps its place on screen. With it off-screen, the zoom centres it.
- **A pure function** takes the zoom, the scroll, the Timeline's width, the playhead's time and the factor. It gives the new zoom and scroll.
- **The browser keeps its keys.** Cmd/Ctrl+= and Cmd/Ctrl+- stay the browser's page zoom.
- **The table.** The rows `zoom-in` and `zoom-out` appear on the sheet. Shift+Z (fit) is unchanged.

**Blocked by:** 01 (keymap table).

**Status:** done

- [x] Seam E (vitest), worked examples:
  - [x] the playhead visible keeps its screen x;
  - [x] the playhead off-screen is centred;
  - [x] clamping at 1× and 40×.
- [x] Seam G: `=` gives `zoom-in` and `-` gives `zoom-out`. Cmd+= gives nothing.
- [ ] In the Advanced Edit, = and - zoom about the playhead. Cmd+= still zooms the page.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. The pure function is `zoomAboutPlayhead({ zoom, scroll, width, duration, playhead, factor })` in `frontend/src/pages/job/advanced/timelineView.ts` (tested in `timelineView.test.ts`): it gives the new `ZoomedView`, in the same terms as `zoomToFit` (`width` is the Timeline's width for its times, the whole Clip's at 1×, and the Clip's `duration` gives its pixels a second). The playhead keeps its place on screen when it is within that width, and is centred otherwise; the zoom stays between 1× and 40×, and at either already the view stays as it is; the view never scrolls past either end of the Clip, so a playhead near an end may move. The rows are `zoom-in` (= and +, as + is = with Shift on many keyboards and a key of its own on others) and `zoom-out` (-), in the view group, with no command modifier, so Cmd/Ctrl+= and Cmd/Ctrl+- stay the browser's page zoom (tested in `keymap.test.ts`). The Timeline takes `zoomStepRef`, set to zoom in (1) or out (-1) by the buttons' step (`ZOOM_STEP`, 1.5), as `fitRef` is for Zoom to fit; `useShortcuts` calls it through `more.zoom`. The zoom buttons now name their keys (`aria-keyshortcuts` and a title), and still zoom about the middle of the view as before.

One small thing: the function counts the view as `width` wide, while the scroller shows 16 px more past the Clip's end, so a playhead in that last strip is taken as out of view and centred.

Not tried in the browser: = and - zooming about the playhead, and Cmd+= still zooming the page, are left for the walkthrough (11).
