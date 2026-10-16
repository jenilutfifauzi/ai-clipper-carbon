# 0006: The preview plays the Source on two decks

Status: accepted
Date: 2026-10-16

## Context

The preview plays a cut Clip by seeking the Source video at each join (ADR 0002). Each join pauses visibly while the browser seeks and decodes, even when the file is on this Mac.

- **The Source is already two videos.** These are the master `<video>`, which `Playback` drives and which is heard, and a muted follower for the second panel of a Split or Blur Layout. Every panel of a Scene is cropped from one of them.
- **A Transition already has a second playback.** For its length, a "ghost" keeps playing the Segment it takes away, over the main playback, which has already jumped to the next Segment.
- **Media Segments have their own `<video>`.** It waits paused and is not moved to its start until its turn comes.
- **`navigation-playback` adds two more readers of the Source.** A Loop Region jumps from Out back to In, and the Skim shows the frame under the pointer and must then show the playhead again at once.
- **Browsers cannot hide a seek on one element.** There is no API to queue the next range on the same element. An element's frame is ready only after its `seeked` event.

## Decision

- **The preview has two decks.** A deck is a full set of the Source's panel videos: a master and a follower. One deck is live: it is shown, heard and driven by `Playback`. The other is parked, paused and muted, at the place the playback will need next:
  - while playing, the start of the next Source Segment, or In when the Loop Region is about to wrap;
  - while paused, the next join after the playhead.
- **At a join, the decks swap.** The parked deck becomes live: it is shown, unmuted and played from where it was parked. The old live deck is hidden, paused, and parked for the join after. If the parked deck was not ready, for example after a fast run of joins, the live deck seeks as it does today.
- **`Playback` owns both decks.** It knows the Segments, the Loop Region and the rate, so it chooses where to park and when to swap. The preview mounts the two decks' videos and registers them, and each panel draws from whichever deck is live.
- **The Skim borrows the parked deck.** While paused, the parked deck seeks under the pointer and is shown instead of the live one. When the pointer leaves, the live deck, never moved, shows at once, and the parked deck is parked again.
- **Media Segments are parked too.** Each one's video moves to its start while it is not playing, so that its first frame is ready when its turn comes.
- **The same on every device.** A parked deck is paused, so it holds a decoder and its buffers but does not decode frames.

## Considered options

- **A spare video for the master only.** The follower would still seek, so the second panel of a Split or Blur Scene would stall at each join.
- **Seeking early on the one deck.** This is impossible while it is still playing the Segment before the join.
- **Swapping `src` between two elements per join.** Changing `src` reloads the file and loses the decoder, so it is slower than a seek.
- **Decks only on desktop.** This would mean two code paths. A paused deck is cheap enough to try on a phone first.
- **Leaving it.** The pause was short on a local file, but every join shows it. A Loop Region and the Skim would make it worse.

## Consequences

- **Joins between Source Segments are seamless** once the parked deck is ready. The same holds at a Loop Region's wrap. A media Segment starts on its first frame.
- **The page holds four Source videos instead of two.** Up to six are held during a Transition, whose ghost keeps its own pair, plus a video for each media Segment and Overlay. The walkthrough on an iPhone checks memory. If the iPhone struggles, a phone may get a single deck later.
- **The clip editor gets seamless joins too,** since it shares the preview and `Playback`.
- **`Playback` grows from one video to decks.** Its tests drive it with fake video elements and a fake clock.
