# 08: Skim

**Parent spec:** `spec.md` in this feature folder (user stories 55–63; Implementation Decisions "`Playback` with two decks: Skim"); GLOSSARY "Skim".

**What to build:** with Skim on and the preview paused, the preview shows the frame under the pointer as it moves over the Advanced Edit's Timeline. The playhead stays where it is.

- **Switching it on.** S, or a Skim button beside the zoom buttons, turns it on and off. The browser remembers it, like the Magnetic timeline. It is desktop only.
- **`Playback.skim(time | null)`**, used only while paused:
  - With a time, it seeks the parked deck there and shows it instead of the live deck. `time` and the live deck stay put.
  - With `null`, it shows the live deck again and re-parks.

  It is ignored while playing.
- **A "shown time."** `usePlayback` subscribers can select it, so that the plan-drawn layers (captions, hook, Text Layers, Overlays) and the followers render at the skimmed time.
- **The Timeline** draws a thin line at the pointer while skimming.
- **Dragging is unaffected.** Dragging an item or the playhead works as before.
- **Skim sound.** A second switch beside the button is off by default and remembered. When on, each new position plays the parked deck's sound for about 80 ms, throttled.
- **The table.** The row `skim` appears on the sheet.

**Blocked by:** 01 (keymap table), 05 (two decks).

**Status:** ready-for-agent

- [ ] Seam F (vitest):
  - [ ] skimming to 7 s while paused seeks the parked deck there, and `time` stays put;
  - [ ] skimming to `null` shows the live deck and re-parks;
  - [ ] skimming while playing does nothing.
- [ ] Skimming the whole Timeline shows the frame, captions and layers under the pointer. Leaving the Timeline shows the playhead's frame at once.
- [ ] Skim sound plays short snippets when on, and nothing when off. Both switches survive a reload.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
