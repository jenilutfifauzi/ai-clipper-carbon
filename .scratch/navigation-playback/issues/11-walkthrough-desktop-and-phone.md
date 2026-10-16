# 11: Walkthrough on a desktop and a phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions "Not automated: a browser walkthrough").

**What to build:** a recorded walkthrough of the whole feature in the real app, on a desktop (Chrome and Safari) and on an iPhone (Safari). Fixes for anything small go in this ticket. Anything bigger gets its own ticket.

**Blocked by:** 01–10.

**Status:** ready-for-agent

- [ ] A Clip cut into five Source Segments plays through every join with no visible pause, Split and Blur Scenes included. Repeat at 2× and at 0.5×.
- [ ] A media Segment and a Transition between Source Segments look and sound as before.
- [ ] A 2-second Loop Region across a join loops ten times seamlessly.
- [ ] Frame-step across a join, and check the frame shown against the rendered Clip at the same time.
- [ ] Skim along the whole Timeline with and without sound, then leave. The preview is back on the playhead at once.
- [ ] Full screen on a desktop, and filling the window on an iPhone. Controls show and hide, and editing is off.
- [ ] On an iPhone, play a cut Clip for 2 minutes, including a Transition (six Source videos). Memory stays steady, and the page doesn't reload.
- [ ] The shortcuts sheet lists every key, and each one does what it says. Typing in a field never triggers one.
- [ ] The clip editor plays a cut Clip seamlessly.
- [ ] Findings recorded under Comments, with what was fixed and what was left.
