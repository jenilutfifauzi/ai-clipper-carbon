# 05: Two decks: seamless joins

**Parent spec:** `spec.md` in this feature folder (user stories 26–33, 80; Implementation Decisions "`Playback` with two decks"); docs/adr/0006-the-preview-plays-the-source-on-two-decks.md.

**What to build:** the preview plays a cut Clip across its joins without the visible pause of today's seek. It does so in the Advanced Edit and in the clip editor, on the desktop and on a phone.

- **`Playback` holds two decks.** A deck is a master and a follower Source video. The preview mounts both decks' panel videos and registers them. Each panel shows the live deck's video and hides the other.
- **The live deck** is played, heard and read for time, as the single master is today.
- **The parked deck** is paused, muted, and seeked to:
  - while playing, the next Source Segment's `source_start`;
  - while paused, the Source Segment that starts at the next join after the playhead.

  It re-parks after every seek, every change of the Segments and every swap.
- **The swap.** At the handover before a join, if the parked deck is at its target and has fired `seeked`:
  - the decks swap;
  - the new live deck plays and is heard;
  - the old one pauses, mutes, hides and re-parks.

  Otherwise the live deck seeks, as today.
- **Media Segments.**
  - A join into a media Segment works as today: the Source decks wait while its clock runs.
  - A media Segment's video is parked at its `source_start` whenever its Segment is not the current one, so it starts on its first frame.
- **Transitions are unchanged.** The ghost keeps its own pair and its own `Playback`. They look and sound as today.
- **The test harness.**
  - A fake video is an EventTarget with:
    - `currentTime`, `paused`, `muted`, `playbackRate`;
    - `play()` and `pause()` that fire their events;
    - a seek whose `seeked` fires when the test says.
  - `requestAnimationFrame` and `performance.now` are stubbed so that the test advances time.
  - Later tickets reuse the harness.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Seam F (vitest), worked examples on Segments 0–5 s from 100 s and 5–9 s from 200 s:
  - [ ] paused at 1 s, the parked deck is at 200 s and the live deck at 101 s;
  - [ ] playing through 5 s swaps the decks;
  - [ ] the new live deck plays from 200 s, is unmuted and is read for time;
  - [ ] the old one is paused and muted;
  - [ ] with `seeked` not yet fired at the handover, the live deck is seeked instead, and playing continues;
  - [ ] a media Segment's clock runs while the Source decks wait, and its video was parked at its `source_start`;
  - [ ] seeking, and changing the Segments, re-park the parked deck;
  - [ ] a one-Segment Clip plays and stops at its end as today.
- [ ] A Clip cut into five Source Segments plays through every join with no visible pause in Chrome and Safari, Split and Blur Scenes included.
- [ ] A Transition and a media Segment look and sound as before. The clip editor plays a cut Clip seamlessly.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
