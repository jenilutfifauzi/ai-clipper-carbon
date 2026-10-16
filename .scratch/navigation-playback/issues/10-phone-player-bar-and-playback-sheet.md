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

**Status:** ready-for-agent

- [ ] On an iPhone, stepping frames with ◀▶ works, and so do the following from the sheet:
  - [ ] setting In and Out;
  - [ ] looping;
  - [ ] changing the rate;
  - [ ] jumping between Edit Points.
- [ ] The player bar fits a 375 px wide screen without wrapping.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
