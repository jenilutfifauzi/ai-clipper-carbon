# 09: Walkthrough on desktop and phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions "Not automated: a browser walkthrough"; user stories 48–51).

**What to build:** nothing new. This is a check by hand, in a real browser on a desktop and on a phone (over the LAN), that the Timeline's new pictures and gestures work together and stay smooth. Problems found become fixes here, or new issues if they are large (for example, virtualizing the Timeline's DOM items).

**Blocked by:** 01–08.

**Status:** ready-for-agent

- [ ] A 90-second Candidate of an hour-long Source, opened while a transcription runs: frames and Waveforms appear, and scrolling and pinching stay smooth on the phone.
- [ ] Scrolling the whole Clip at 40× on Safari iOS keeps memory steady, and the page doesn't reload.
- [ ] A fast fling across the Clip loads the stretch it stops at first.
- [ ] Volume Line and Fade Ramp: drag with a pause while holding, then undo each with one Cmd+Z, on both devices.
- [ ] On the phone, dragging an unpicked Music Clip moves it, with its volume unchanged.
- [ ] Fit with a Pick, with none, and on a very short item, on both devices. Shift+Z on the desktop.
- [ ] A media item uploaded before the feature fills in its frames and Waveform.
- [ ] Results recorded under a `## Comments` heading in this file.
