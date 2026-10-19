# 0016: Ducking follows the Words; a Detached sound is a Music Clip of the Source

Status: accepted
Date: 2026-10-18

Amends 0008 (the Clip's own sound left unkeyed) and 0009 (Music Clips have no Speed).

## Context

The `audio-mixing` feature brings Concat's audio mixing to the Advanced Edit:
- fades on Segments;
- detaching a video clip's sound and reattaching it (`DetachAudio` / `ReattachAudio`);
- muting a clip with M;
- saving a clip's sound as WAV;
- the meters.

It also adds what Concat only lists as an open request: Music turned down under speech.

Today:
- **A Music Clip names a Media Library item.** It has a volume, fades and volume Keyframes, but no Speed.
- **The Source's sound lives only in its Segments.** It has one volume (`source_volume`), and a Segment's volume under it, with no fades and no Keyframes.
- **Nothing is ever silenced in the saved Candidate.** Track mute is the editor's alone (track-controls), and an Overlay is "muted" by volume 0.
- **The render mixes with `amix`, then normalizes loudness in two passes.** Nothing listens to anything else.
- **The planner already places every Word in Timeline time** (`_segment_words`). The preview and the render share one gain function (`gain_at` ↔ `loudness.ts`).

Auto-ducking is Out of Scope in `.scratch/advanced-edit/spec.md`.

## Decision

- **Ducking is computed from the Words, in the planner.**
  - A Music Clip has `duck`: a depth in dB, or none.
  - Speech is the Words of every Source Segment that isn't Muted, and of every Music Clip of the Source's sound, where each plays on the Timeline. The Words are the Clip's own, or the Transcript's when it has none.
  - Speech spans less than 0.8 s apart are joined. The Music goes down 0.25 s before a span and comes back up over 0.5 s after it, in linear ramps. These constants are in the config.
  - The plan carries each Audio event's duck spans. The render multiplies them into its `volume` expression, and the preview into its gain curve, so both hear the same thing. The gain is volume (or Keyframes) × fades × duck.
  - The loudness passes measure the mix after ducking.
  - A Music Clip of the Source's sound is never ducked.
  - Stored Music Clips read as unducked. A Music Clip of a song that an edit adds with an id new to the Revision and no `duck` gets −12 dB.
  - The editor's Track mute doesn't change ducking.
- **A Detached sound is a Music Clip of the Source.**
  - A Music Clip's `media` may be absent, meaning the Source's sound, as a Segment's is. Its `offset` is then a time on the Source's timeline, and `source_volume` applies to it.
  - Music Clips gain `speed`, `pitch` and `reverse`, as an Overlay has them.
  - Detach copies the Segment's range, Speed, pitch, Reverse, volume, fades and volume Keyframes onto a new Music Clip with `detached_from` (the Segment's id), spanning the Segment's whole sound on the Timeline (a Transition's overlap included). It then sets the Segment's `muted`.
  - A Detached sound moves on its own: no link is kept while editing.
  - Reattach deletes every Music Clip Detached from that Segment and clears `muted`. It copies nothing back.
  - The MCP tools do this with ordinary edits. No new tool is added.
- **Muted is a saved flag** on Segments, Music Clips and video Overlays. It keeps the item's volume and Keyframes. New video Overlays are volume 1 and Muted, rather than volume 0.
- **Every Segment's sound has linear fades.** A Source Segment's has volume Keyframes and a Volume Line too. Fades are worked out as a Music Clip's are, and multiply under a Transition's `acrossfade`.

## Considered options

- **`sidechaincompress` on the mix.** It hears every sound, a media Segment's included. But the preview can't do it (Web Audio has no sidechain), the Timeline can't draw it, and the plan would no longer be what the render hears.
- **Silero VAD on each Segment's sound.** It would catch speech in media Segments. But it needs another derived file and a pass per Segment, and the Words already say when someone speaks.
- **One ducking setting per Candidate.** There would be fewer knobs, but a sound effect would duck with the song.
- **A new "sound clip" item for Detached sound.** It is explicit, but it adds another branch to the planner, the preview, rippling, the Clipboard and the MCP tools, for what a Music Clip already does.
- **A Detached sound linked to its Segment** (moving and trimming with it). The link would be one more thing to keep valid and to merge, and Concat keeps none.
- **A Segment silent while a Music Clip names it, without a flag.** The tail of a split Segment gets a new id, so it would sound again.
- **Muting as volume 0 (Concat's M).** The volume would be lost, and a keyed volume would not go silent.

## Consequences

- **Overturns three Out of Scope lines:**
  - auto-ducking, in `.scratch/advanced-edit/spec.md`;
  - Speed on Music Clips, in `.scratch/speed/spec.md`;
  - Keyframes on the Clip's own sound, in `.scratch/keyframes/spec.md`, for a Source Segment's volume. `source_volume` stays a single number.
- **Every stored Candidate plans, renders and previews as before:** unducked, unmuted, unfaded Segments, and Music Clips at 1×.
- **A Clip's Music now depends on its Words.** Changing Word timing or captions can change the duck, and a Candidate whose Words are still being made ducks by the Transcript's.
- **Music Clips of the Source paste only into their own Job,** as Segments of the Source do.
- **Reordering Segments leaves a Detached sound where it was** (ADR 0004).
