# 02: Audio Effects on Music Clips and Overlay video sound

**Parent spec:** `../spec.md` ("Model", "Renderer", "Editor actions"); ADR 0017.

**What to build:** Audio Effects reach every sounding item:
- Music Clips: songs, a video's sound, and Detached sound of the Source;
- video Overlays.

**The model:** MusicClip and Overlay gain `audio_effects`, validated as a Segment's are. A stack on an image Overlay is refused.

**Where the stack sits in the render:** in each Music Clip's and Overlay's chain, after Speed, Reverse and `asetpts`, and before volume × duck, fades and the delay. Each chain is trimmed to the item's length. The same chain is used:
- in the per-item "Save sound as WAV", which keeps leaving out Ducking and the final loudness;
- in the whole-sound export (WAV / M4A).

**The editor keeps the stack with the sound:**
- Detach copies the Segment's stack onto the new Music Clip and keeps the Segment's own, so Reattach brings the Segment back as it was.
- Split gives the stack to both parts.
- Copy, paste and the Clipboard carry it.
- The Revision merge treats it as one field of the item.

**What the agent sees:** MCP and `dry_run` cover Music Clips and Overlays.

**Blocked by:** 01.

**Status:** done

- [x] Seam A: Telephone on a song Music Clip, and on an Overlay video's sound, is heard in the render.
- [x] Seam A: a Detached sound of the Source, with Echo, sounds the same as the Segment did, at its new place.
- [x] Seam A: the per-item WAV includes the effects.
- [x] Ducking is unchanged: a song with effects still ducks under speech.
- [x] A stack on an image Overlay is refused through the API and MCP.
- [x] Vitest: Detach copies the stack and Reattach keeps the Segment's; Split and paste carry it; the Revision merge handles two different stack edits.
- [x] Stored Candidates render as before.
