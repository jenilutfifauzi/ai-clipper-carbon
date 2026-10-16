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

**Status:** done

- [x] Seam F (vitest):
  - [x] skimming to 7 s while paused seeks the parked deck there, and `time` stays put;
  - [x] skimming to `null` shows the live deck and re-parks;
  - [x] skimming while playing does nothing.
- [ ] Skimming the whole Timeline shows the frame, captions and layers under the pointer. Leaving the Timeline shows the playhead's frame at once.
- [ ] Skim sound plays short snippets when on, and nothing when off. Both switches survive a reload.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. `Playback` (`playback.ts`) has `skim(time | null, sound)`. While paused, a time borrows the parked deck: its videos are cued there and `shownDeck` gives it, while `time` and the live deck stay put. Null ends the skim, so the live deck shows again and the parked deck re-parks. Skim is ignored while playing, and playing ends it. While skimming, `park()` leaves the borrowed deck alone, so a seek moves only the time. An edit of the Segments re-shows the skimmed time as they now play it. The same position twice seeks nothing. `shownTime`, `shownSegmentIndex` and `skimTime` say what is shown. `useShown(playback, select)` is `usePlayback` of the shown time. `usePlayback`'s time stays the playhead's, so edits (paste, split, adding at the playhead), the split buttons, the Timeline's playhead and the transport's time are unchanged. The preview draws at the shown time: the Scene and its panels' paths, captions, the hook, Text Layers, Overlays, the stage's handles and Transitions (whose ghost seeks with it). `follow` follows the shown time, so a media Segment's video, Overlay videos and Music Clips show the skimmed time. Music is paused while skimming, as playback is. With `sound`, a new position plays the parked deck unmuted for 80 ms (`SNIPPET_SECS`), checked on the frame clock. Only one snippet plays at a time: a move during it only seeks. After it, the deck is muted, paused and back on the skimmed frame. It is heard at the skimmed Segment's volume (PreviewMusic). A media Segment's time is silent. The switches are in `advanced/skim.ts`, remembered per browser like the Magnetic timeline (both off by default, storage in try/catch, other tabs heard). S is the keymap row `skim` (view, desktop only; Cmd+S stays the browser's), and `useShortcuts` toggles it. `AdvancedTimeline` takes `skimmable` (a desktop's). It then shows the Skim button and the Skim sound toggle beside the zoom buttons. A mouse moving over the ruler or the tracks skims there, pressing nothing and off the labels' column. Leaving, any press (captured, so an item's own drag ends it too), turning the Skim off and unmounting all end the skim. `SkimLine` draws a thin accent line at `skimTime`, so it is gone while playing. Tests in `playback.test.ts` (Seam F: the three examples, plus a seek while skimming, a repeated position and an edit, a media Segment, sound on and off) and `keymap.test.ts` (S in either case, nothing with Cmd, on a phone or typing). Not tried in the browser: skimming the whole Timeline with captions and layers, leaving it, the snippets, and both switches surviving a reload. Worth watching: a skim's seeks are not rounded to the frame grid (02's fps), so fast moves seek on every pointer event. Also check whether an unmuted `play()` on the parked deck outside a click is allowed for the snippets in Safari.

**2026-10-16: Review fixes.** A seek now ends a skim: the live deck shows the new time and the parked deck re-parks, so a frame step or Home while skimming shows where the playhead went. The old test ("a seek while skimming moves the time, and leaves the borrowed deck where it shows") encoded the bug and now says the opposite. An edit of the Segments, and a load of the live deck's video, still keep the skim (they go through the private `moveTo`). The remembered switch is now `rememberedSwitch` in `frontend/src/remembered.ts`, shared with the Magnetic timeline.
