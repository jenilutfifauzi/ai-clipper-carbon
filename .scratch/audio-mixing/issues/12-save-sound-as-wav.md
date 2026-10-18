# 12: Save sound as WAV

**Parent spec:** `spec.md` in this feature folder (user stories 50–53; Solution "Save sound as WAV"; Implementation Decisions "Save sound as WAV"); GLOSSARY "Segment", "Music Clip", "Overlay".

**What to build:** from the context menu of a Segment, a Music Clip or a video Overlay, the owner saves that item's sound as a WAV file. It is the item alone as it is heard in the Clip (with unsaved edits), and the browser downloads it.

- **Endpoint.** It takes the Candidate's draft edits (as the Preview Plan does) and an item id. It returns `audio/wav`, 48 kHz stereo 16-bit PCM, with a download filename made from the Candidate and the item.
- **What is rendered:**
  - Included: the item's range, Speed, pitch and Reverse, volume or Keyframes, fades, and `source_volume` for the Source's sound.
  - Left out: Muted, the Track mute, Ducking and the loudness passes.
  - It reuses the renderer's own sound chains, not a copy of them.
- **Refused:** a Freeze frame, an image, an item without sound, and an id the draft doesn't have.
- **Editor.** "Save sound as WAV" on those items' context menus (desktop). It shows progress while the file is made, and an error notice if it fails.

**Blocked by:** 04, 07, 08.

**Status:** ready-for-agent

- [ ] A Source Segment's WAV is PCM at 48 kHz, as long as its Timeline length, with its fade in audible (tone).
- [ ] A 2× Music Clip's WAV is half its read length; a Music Clip of the Source's WAV is the episode's sound at `source_volume`.
- [ ] A Muted item's WAV is not silent; a ducked Music Clip's WAV is not ducked.
- [ ] Unsaved draft edits (a changed volume) are in the WAV.
- [ ] A Freeze frame, an image Overlay and an unknown id are refused.
- [ ] The context menu item downloads the file in the browser.
