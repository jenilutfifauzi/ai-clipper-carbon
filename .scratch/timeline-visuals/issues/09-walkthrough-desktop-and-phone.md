# 09: Walkthrough on desktop and phone

**Parent spec:** `spec.md` in this feature folder (Testing Decisions "Not automated: a browser walkthrough"; user stories 48–51).

**What to build:** nothing new. This is a check by hand, in a real browser on a desktop and on a phone (over the LAN), that the Timeline's new pictures and gestures work together and stay smooth. Problems found become fixes here, or new issues if they are large (for example, virtualizing the Timeline's DOM items).

**Blocked by:** 01–08.

**Status:** ready-for-human

- [ ] A 90-second Candidate of an hour-long Source, opened while a transcription runs: frames and Waveforms appear, and scrolling and pinching stay smooth on the phone.
- [ ] Scrolling the whole Clip at 40× on Safari iOS keeps memory steady, and the page doesn't reload.
- [ ] A fast fling across the Clip loads the stretch it stops at first.
- [ ] Volume Line and Fade Ramp: drag with a pause while holding, then undo each with one Cmd+Z, on both devices.
- [x] On the phone, dragging an unpicked Music Clip moves it, with its volume unchanged.
- [x] Fit with a Pick, with none, and on a very short item, on both devices. Shift+Z on the desktop.
- [x] A media item uploaded before the feature fills in its frames and Waveform.
- [x] Results recorded under a `## Comments` heading in this file.

## Comments

**2026-10-16: walked through by the agent, in Chromium (ego-browser) against `make dev`; what needs a real phone is left.** Desktop at 1440×900/1100, DPR 2; "phone" is Chromium emulating 390×844, DPR 3, touch. Candidate `e9d63986` (78 s) of Job `c37ac3bbb8ad` (a 68-minute 1080p50 Source, no proxy). A test song was uploaded, added, and removed again afterwards; the Candidate is back to no Music Clips (Revision 13), and the song is deleted.

- **Filmstrip and Waveform on Source Segments:** both appear, at 1× and at 40× (repeated frames per tile, as the 1 fps grid says; the Waveform stays sharp). Layout labels show as chips over the frames.
  - **Finding: the first look at a stretch is slow.** Each 30 s chunk of this Source took 7–17 s to make (1080p50 decoded on one thread at low priority, no proxy), so a cold Candidate fills in over ~20 s. Worth an issue: e.g. decode with more threads when the Worker is idle, or seek per frame instead of decoding every frame.
- **Media Segments and Music Clips:** a media Segment shows its own frames, Waveform and Volume Line. The uploaded song's Peaks were there when the upload finished (`0.peaks`, `30.peaks`). An older video whose chunks were moved away was filled in on request (6 Filmstrip and 6 Peaks chunks, 0.3–1.5 s each).
  - Adding the 150 s video to the 78 s Clip was refused by the existing 180 s limit (422 on save and on the preview plan), so the media Segment was seen but not saved. Not this feature's, but the editor gave no visible sign the save failed — worth checking separately.
- **Volume Line:** on desktop, a drag with a 2.2 s pause while holding shows the % label and shrinks the Waveform, and one Cmd+Z restores 100%. On the phone the same with touch (and the Undo button). A locked Music Track shows the line, and its Music Clip takes no input.
  - **Finding: on the phone the line is very sensitive:** the Music lane is 35 px tall, so 14 px of drag took 100% down to 21%.
- **Fade Ramp (desktop):** both handles drag with a seconds label, the slopes are drawn, the inspector follows (5.4 s / 6.3 s), and each drag (one with a 2.2 s pause) undoes as one step. Not tried with touch.
- **Phone, unpicked Music Clip:** a swipe scrolls and changes nothing; a long press (350 ms) lifts it and a drag moves it (0 → 10.1 s) with its volume unchanged.
- **Fit:** Shift+Z and the button, with nothing picked (whole Clip), on the hook (3 s, held at the Clip's start), on a Music Clip and on a new media Segment; on the phone, on a picked Music Clip.
- **40× scroll on the phone (emulated):** the whole Clip (12 480 px) in 101 steps; the JS heap stayed at ~32 MB, canvases stayed windowed (946×94 device px). Bitmap/GPU memory isn't visible here, and Safari iOS wasn't run.
- **Fling:** with cold chunks, the two chunks asked for at 1× (0:00–1:00) were already being made when the fling reached the end, so the end's chunk came third (at 21 s). Queued chunks that left the view were dropped (no Peaks asked for 0:00–1:00), but loads already sent aren't cancelled and the server makes chunks one at a time in arrival order. **Not met** as written; fixing it means cancelling sent requests (AbortController) and letting the server skip chunks nobody waits for any more.

**Left for a human, on real devices:** Safari iOS memory at 40×; scrolling and pinching while a transcription runs (no transcription was running here); the Fade Ramp by touch; and the two findings above (chunk speed, fling order) to decide on.
