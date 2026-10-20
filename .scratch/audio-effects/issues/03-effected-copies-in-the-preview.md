# 03: Effected copies in the preview

**Parent spec:** `../spec.md` ("Effected copies", "Preview"); ADR 0017.

**What to build:** the preview plays every item's Audio Effects exactly as the render does.

**The copy:** when a sounding item has an enabled stack, the editor asks the server for its **Effected copy**. That is the item's sound before its volume: its range, Speed, Reverse and Audio Effects, made through the same chain builder as the render.
- The endpoint takes the Candidate, the item's kind and id, and the draft's unsaved edits, as the per-item WAV endpoint does.
- Copies are keyed by a hash of the source file, range, Speed, pitch, Reverse and validated stack. Each is made once and kept in the Job's folder.
- A request for a copy already being made waits on that job.
- After a save, copies that no Candidate of the Job uses are deleted.
- Muted items, Freeze frames and empty or all-off stacks have no copy.

**Playback:**
- The preview plays the copy at 1×, in the item's own time, from a hidden audio element.
- For a Source Segment, the deck's video sound is silenced over that Segment.
- The item's Web Audio gain still carries volume, Keyframes, fades, Ducking and the Transition share, so those stay instant.
- Under a Transition, the outgoing Segment is heard through its copy.
- Until the copy is ready, the item plays without effects.
- A change to the stack, or to anything in the key, asks again (debounced).
- The Meters follow the copy, as they read the master bus.

**Blocked by:** 01, 02.

**Status:** ready-for-agent

- [ ] Seam A: a copy matches the item's rendered sound before volume, with the same length and a close spectrum, for a Source Segment, a media Segment, a Music Clip and an Overlay.
- [ ] Seam A: unsaved draft edits are used.
- [ ] Seam A: the same key returns the same file with no second ffmpeg run.
- [ ] Seam A: unused copies are removed after a save.
- [ ] Seam A: a Freeze frame, an image or an empty stack gets "no copy".
- [ ] The preview plays copies in sync with the picture: playing, seeking, looping, over a Transition, and at Speeds other than 1×.
- [ ] The preview falls back to the item's own sound until the copy is ready.
- [ ] Volume, fade and duck changes stay instant over a copy.
- [ ] The editor exposes which picked items are still waiting for a copy, for the Inspector's "Preparing effects…".
