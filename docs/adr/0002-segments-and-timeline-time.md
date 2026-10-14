# 0002: A Clip is a list of Segments; layers live in Timeline time

Status: accepted
Date: 2026-10-14

## Context

Until now a Clip was one range of the Source, `Candidate.start` to `end`. The Advanced Edit (`.scratch/advanced-edit/spec.md`) needs more on its Main Track:
- split it at the playhead;
- delete a piece from the middle;
- reorder pieces;
- add another moment of the Source.

A Clip then shows some ranges of the Source, in some order, possibly the same one twice. Much of the code assumed that "Clip time = Source time − start":
- the planner's inputs;
- the per-range Words and analysis caches;
- the renderer's one `-ss/-t`;
- the preview's `Playback`;
- the clip editor's Timeline.

Two questions follow. What does the Candidate store? And what are its other edits keyed by, once Source time no longer maps to one Clip time?

## Decision

- **`Candidate.segments`** holds the Main Track: Source Segments in order, back to back, each `start`..`end` on the Source's timeline with its own id.
  - Empty, the default, means one Segment from `start` to `end`. Every Candidate saved before this ADR is one of these, and plans, renders and previews exactly as it did.
  - An edit that leaves one Segment is stored that way, as `start`/`end`.
- **`start` and `end` stay**, as stored fields:
  - For one Segment they are its range.
  - For several, they are the hull of the Source they show (the earliest start, the latest end). Selection's overlap checks, the Candidate list, thumbnails and evaluation read them.
  - Trimming them directly is refused while the Clip has several Segments.
- Each Segment's ends are snapped to Words as a Clip's are. The longest-clip limit applies to the length the Clip plays on the Timeline: its Segments' lengths, less its Transitions' overlaps.
- **Timeline time** (seconds into the output) anchors:
  - the hook;
  - Text Layers;
  - Music Clips;
  - and, later, Overlays and Transitions.

  Cutting the Main Track leaves them where they are on the output.
- **Word Edits and Layout Overrides stay on the Source's timeline.**
  - A piece of the Source shown twice gets the same corrections in both places.
  - The planner maps them into each Segment that holds them.
- **The planner frames each Segment on its own**, from that range's cached Words and analysis. The caches stay keyed by range, so a Segment equal to a Clip prepared before reuses its work.
  - A Segment's ends are cuts: Scenes don't cross them, and caption lines break at them.
  - Captions, the hook and every layer are planned once over the whole Timeline.
- **The renderer reads each Source Segment as its own input** (`-ss`/`-t`), draws its Scenes, and joins the Segments' video and audio with `concat`. The one-Segment Clip keeps the single-input command it had.
- **The Render Plan gets `segments`** (each Segment's Timeline span and Source range) for a Clip of several, so that the preview's `Playback` can map Timeline time to the Source and jump at each join.

## Consequences

- Nothing changes for Clips the Advanced Edit hasn't cut. Their ASS, ffmpeg command and Render Plan are as before, apart from new empty fields in the plan's JSON.
- A cut Clip renders slower: it decodes each Segment separately, and its captions transcribe each Segment's range.
- The clip editor shows a cut Clip's preview and captions. Its trim and Source-time Timeline give way to a link to the Advanced Edit.
- The preview jumps the Source video at each join with a seek. The pause there is short on a local file. A second, preloaded video could hide it later.
