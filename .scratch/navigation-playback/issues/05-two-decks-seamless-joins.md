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

**Status:** done

- [x] Seam F (vitest), worked examples on Segments 0–5 s from 100 s and 5–9 s from 200 s:
  - [x] paused at 1 s, the parked deck is at 200 s and the live deck at 101 s;
  - [x] playing through 5 s swaps the decks;
  - [x] the new live deck plays from 200 s, is unmuted and is read for time;
  - [x] the old one is paused and muted;
  - [x] with `seeked` not yet fired at the handover, the live deck is seeked instead, and playing continues;
  - [x] a media Segment's clock runs while the Source decks wait, and its video was parked at its `source_start`;
  - [x] seeking, and changing the Segments, re-park the parked deck;
  - [x] a one-Segment Clip plays and stops at its end as today.
- [ ] A Clip cut into five Source Segments plays through every join with no visible pause in Chrome and Safari, Split and Blur Scenes included.
- [ ] A Transition and a media Segment look and sound as before. The clip editor plays a cut Clip seamlessly.
- [x] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified. `Playback` (`playback.ts`) holds two decks, registered with `attachDeck(slot, master, follower)`; `shownDeck` says which one the panels show. The live deck plays, is heard and is read for time; the other is paused, muted and cued, master and follower, to `parkTarget()`, the one place that says where it waits (the start of the next Source Segment after the time's, or nowhere when none is left). It is parked again after every seek, change of the Segments and swap, and when its video loads. At the handover into a Source Segment the decks swap if the parked deck is there and both its videos have fired `seeked`; otherwise the live deck seeks as before. `Playback` now keeps each live follower in step itself (it seeks, plays and pauses both videos of a deck), so ClipPreview's follower effect is gone. ClipPreview mounts both decks' panel videos; the parked deck's are drawn transparent, not removed, so that their frame is ready. PreviewMusic sets the Source volume on both decks' masters. A media Segment's videos wait at its start outside its span (`follow`'s new `park`). The Transition ghost keeps its own pair and its own `Playback`, with one deck (`attachDeck(0, master)`), so it seeks as before. The Seam F fakes (fake video and stubbed clock) are in `playbackHarness.ts`, for 06–08; the examples are in `playback.test.ts`, plus one for the old deck parking for the join after and the decks swapping back. Not tried in the browser: seamless joins in Chrome and Safari (Split and Blur included), a Transition and a media Segment as before, the clip editor, and the phone. Worth watching in the walkthrough: a swapped-in deck's unmuted `play()` outside a click on an iPhone; the parked deck's muted master once it is routed through Web Audio (a Clip with Music or another Source volume); and memory with four Source videos.

**2026-10-16: Review fixes.** A swapped-in deck the browser refuses to play no longer freezes the time: `run()` stops the playback when the live deck's `play()` is rejected while playing (and not on a media Segment's clock), and `pause()` stops it even when the live video is paused already (no `pause` event comes then). To keep iOS from refusing in the first place, `play()` unlocks the parked deck: its paused, muted videos are played and paused at once inside the owner's own press. `onPause` ignores a pause heard after the video was played again (an unlock's pause landing after a swap). The fake video has a `refuse` flag; tests in `playback.test.ts`: a refusal at the swap stops the playback and Play plays again, Pause with the live deck paused already, and Play unlocking the parked deck.
