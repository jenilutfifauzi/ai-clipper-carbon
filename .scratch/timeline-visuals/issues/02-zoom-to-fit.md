# 02: Zoom to fit

**Parent spec:** `spec.md` in this feature folder (user stories 42–47; Implementation Decisions "A new pure module for the Timeline's view (Seam E)", Fit; "Gestures", Fit).

**What to build:** a Fit button beside the Timeline's zoom buttons, on the desktop and on the phone, and Shift+Z on the desktop.
- With a Pick, it zooms so that what is picked fills the Timeline, and scrolls to it.
- With nothing picked, it goes back to 1× at the start.

- **Seam E: a pure Timeline-view module** with no React and no canvas. Whichever of tickets 01, 02 or 03 lands first creates it. It holds Fit, a function of:
  - **inputs:** the Pick, the edits, the Clip's duration and the Timeline's width;
  - **output:** a zoom and a scroll.
- **The span to fit:**
  - for picked items, the hull of what is picked, in Timeline time;
  - for the hook, its span;
  - for the captions, the whole Clip;
  - for a join, a point: centred at the current zoom.
- **The zoom** is the span with a 5% margin on each side, clamped to 1×…40×. The scroll centres the span. With nothing picked, the zoom is 1× and the scroll 0.
- **The button** has an accessible name and a tooltip naming the shortcut. Shift+Z is ignored while typing in a field.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam E (vitest):
  - one picked item;
  - several picked items;
  - nothing picked (1×, scroll 0);
  - a Pick too short to fill the Timeline (40×, centred);
  - a picked join (current zoom, centred).
- [ ] On a desktop and at phone width, Fit with a Pick shows exactly that Pick with a small margin. Fit with none shows the whole Clip.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
