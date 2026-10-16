# 08: Diamonds on the ruler, K [ ], and keying the Volume Line

**Parent spec:** `spec.md` (user stories 14, 21, 25–26; Solution "Diamonds on the ruler", "The Volume Line follows the curve", "Shortcuts").

**What to build:** the owner sees where the picked item changes without opening a pane, and keys from the keyboard and the Timeline.
- **Ruler diamonds.** While the Pick is one keyed item, the ruler's floor shows a diamond per instant, every property together.
  - A click moves the playhead there.
  - A drag moves every Keyframe at that instant, snapped to frames and never past a neighbour, as one step of undo.
- **Shortcuts.**
  - K toggles a Keyframe at the playhead on the active row: the property last touched, else the first keyed one, else Scale (Volume for a Music Clip).
  - [ and ] move the playhead to the item's previous and next Keyframe.
  - They are in the keymap table and the shortcuts sheet.
- **The Volume Line.** Dragging it on an item with volume Keyframes writes a volume Keyframe at the playhead. Outside the item the drag is off.

**Blocked by:** 06

**Status:** ready-for-agent

- [ ] Seam E: the ruler diamonds of one picked item, one per instant across properties, merged within half a frame, at their Timeline times.
- [ ] Seam D: moving every Keyframe at an instant moves every property's together, snapped to frames, never past a neighbour.
- [ ] Seam G: K, [ and ] resolve to their commands, and not while typing in a field.
- [ ] By hand: dragging a ruler diamond retimes a move; dragging the Volume Line on a keyed Music Clip adds a Keyframe.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
