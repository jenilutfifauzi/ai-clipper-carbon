# 02: Record a Take

**Parent spec:** `spec.md` in this feature folder (Solution "Recording a Take", "Where it lands", "On a phone"; Implementation Decisions "a take recorder module", "the take flow"); ADR 0018.

**What to build:** the shortest path from the microphone to the Timeline. On a desktop browser the owner presses the mic button by the transport, or Shift+R. The picture rolls from the playhead with the Clip's sound held silent, and a level meter beside the button shows the microphone. The owner presses Stop (the same button, Space or Shift+R). The Take is then uploaded to the Media Library and lands as a Music Clip marked Speech, where the first sound was heard against the picture. The countdown, the editing lock, the settings popover and the failure handling come in 03, 04 and 05: here recording starts at once, and an error is just shown.

- **The take recorder module** has no React. It opens the default input with echo cancellation, noise suppression and automatic gain off, and captures mono 48 kHz PCM through an AudioWorklet on its own AudioContext. It reports the level for the meter, reusing the Meters' ballistics. It stops itself at eight minutes, with a notice. On stop it gives the WAV bytes, the length and the AudioContext time of the first captured sample.
- **The landing** is the playhead plus (first sample time − the time the picture rolled), never before 0. It is a pure function, as is the WAV encoding.
- **Rolling.** Playback starts from the playhead and ignores the Loop. The master bus is silent until the Take stops. When the picture reaches the Clip's end it stops there, and the Take records on.
- **The upload.** The Take is uploaded as "Voiceover YYYY-MM-DD HH.MM.SS.wav" through the existing Media Library upload. No backend change is expected beyond what 01 gives.
- **Landing on the Timeline.** One edit adds the Music Clip: the new item, the landing as `start`, the Take's length as `secs`, `speech: true` and no `duck`. The existing auto-lane lays it. It is then Picked, and the playhead goes to its start. Undo removes the Music Clip and keeps the item.
- **Shown only where it can work.** The button exists only when `window.isSecureContext` and `navigator.mediaDevices` do. Elsewhere, a phone over plain HTTP for example, a hint suggests uploading a voice memo and marking it Speech.
- **Keymap.** A new `record` entry: Shift+R, desktop only, in the playback group, listed in the shortcut sheet.

**Blocked by:** 01 (Speech on Music Clips).

**Status:** ready-for-agent

- [ ] The WAV encoding round-trips its header and samples (vitest).
- [ ] The landing from a playhead, a roll time and a first-sample time is right, and never before 0 (vitest).
- [ ] The recorder stops itself at eight minutes (vitest, fake clock).
- [ ] With a fake `getUserMedia`, AudioContext and upload, pressing the button rolls the picture with the bus silent, and Stop by button, Space and Shift+R lands one Music Clip (media, start, secs, `speech: true`, no `duck`), Picked, with the playhead at its start (vitest).
- [ ] The input is opened with echo cancellation, noise suppression and automatic gain off (vitest).
- [ ] Outside a secure context the button is absent and the hint is shown (vitest).
- [ ] Seam A: a mono 48 kHz WAV upload becomes an audio item with Peaks, named from its file.
- [ ] Checked by hand in Chrome and Safari on the Mac: the words of a Take land in time with the picture.
