# 10: Phone: frame buttons and the Playback sheet

**Parent spec:** `spec.md` in this feature folder (user stories 77–80; Solution "On a phone").

**What to build:** on a phone, which has no keyboard and no hover, the same tools have buttons.

- **The player bar** gets ◀ / ▶ frame-step buttons and the fullscreen button.
- **A Playback bottom sheet,** opened from the toolbar, holds:
  - the rate (0.5×, 1×, 1.5×, 2×);
  - In, Out, Loop and Clear;
  - previous and next Edit Point.
- **The buttons call the same commands** as the keymap rows, so a button and its key do the same thing.
- **No Skim and no shortcuts sheet** on a phone.

**Blocked by:** 02 (frame step), 03 (Edit Points), 06 (rate), 07 (Loop Region), 09 (fullscreen).

**Status:** done

- [ ] On an iPhone, stepping frames with ◀▶ works, and so do the following from the sheet:
  - [ ] setting In and Out;
  - [ ] looping;
  - [ ] changing the rate;
  - [ ] jumping between Edit Points.
- [ ] The player bar fits a 375 px wide screen without wrapping.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. What each keymap row does now lives in one place, `commandsOf(history, playback, actions, more)` in `frontend/src/pages/job/advanced/commands.ts` (tested in `commands.test.ts` on Seam F's harness): it gives a `Commands`, a `Record<ShortcutId, () => boolean | void>`, made once per render in the Advanced Edit's `Workspace`. `useShortcuts(commands, { fullscreen, phone })` only resolves the key and runs `commands[id]`, as before, and the buttons run the same entries: the phone's ◀ and ▶ are `step-back` and `step-forward`, the sheet's In, Out, Loop and Clear are `mark-in`, `mark-out`, `loop` and `clear-marks`, its Previous and Next are `edit-point-previous` and `edit-point-next`, and the fullscreen and desktop loop buttons are `fullscreen`/`fullscreen-exit` and `loop`. The rate has no key, so its buttons call `playback.setRate` as the desktop menu does.

On a phone, the player bar's `tools` (`ClipPreview`'s, from 09) are `FrameStep` (`Chrome.tsx`) then the fullscreen button, which 09 already showed there. Each frame button is a 44 px icon button, off at its end of the Clip. To fit 375 px, the compact transport is closer together below `sm` (8 px apart, not 12) and puts the time over the Clip's length in small type: play, ◀, ▶ and full screen take 176 px, the time about 40, the gaps 40, which leaves the scrubber about 95 px of the 351 inside the padding. From `sm` up, and in the clip editor, the bar is as it was. Full screen, the bar keeps the frame buttons.

The Playback sheet (`PlaybackPanel` in `Chrome.tsx`) is the phone's bottom sheet, opened by a Playback button in the toolbar (with nothing picked, after Split). It holds the rate as a segmented control (0.5×, 1×, 1.5×, 2×), the Loop Region's In, Out, Loop (pressed while on) and Clear (off with no marks), with the Region's times and whether it loops, and Previous and Next Edit Point, each off when there is nothing that way (Next is off on the last frame, where ↓ goes at the Clip's end). The sheet stays open, so Next can be tapped again and again over the preview. Ticket 06 asked the bar to show a rate other than 1×; on a phone the toolbar's button does instead, reading "Playback 2×" in the accent. There is no Skim and no shortcuts sheet on a phone, as before (`skimmable` and the keyboard button are a desktop's, and `skim` and `shortcuts` are desktop-only rows).

Not tried in the browser: on an iPhone, ◀▶, In, Out, looping, the rate and the Edit Point jumps from the sheet, and the bar fitting 375 px without wrapping, are left for the walkthrough (11). Worth watching there: the rate's segments are 36 px tall inside the 44 px control, as the inspector's segmented controls are; and a long Clip's time ("12:34.5") takes a few pixels more from the scrubber.
