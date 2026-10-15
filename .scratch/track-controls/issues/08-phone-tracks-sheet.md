# 08: The phone's Tracks sheet

**Parent spec:** `spec.md` in this feature folder (user story 4; Implementation Decisions "Phone").

**What to build:** on a phone, the Advanced Edit's toolbar gains a **Tracks** button. It opens a bottom sheet with the Track controls and the Magnetic switch.

- **Rows:** the sheet lists the six Tracks, each with the hide, mute and lock buttons the matrix gives it, showing their current state.
- **The Magnetic switch** is the same preference as the desktop's, with the same explanation.
- **Behaviour:** changes apply at once and behave exactly as the desktop headers do.

**Blocked by:** 01, 06, 07.

**Status:** ready-for-agent

- [ ] At phone width, the Tracks button opens the sheet, and each button hides, mutes or locks its Track as on a desktop.
- [ ] The Magnetic switch in the sheet and the desktop's bar show and set the same preference.
- [ ] The sheet fits a 375 px wide screen without horizontal scroll, with tap targets of at least 44 px.
- [ ] `npm run typecheck`, `npm test`, `npm run build`.
