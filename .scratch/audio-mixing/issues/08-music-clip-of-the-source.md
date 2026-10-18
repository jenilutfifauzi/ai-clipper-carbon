# 08: Music Clips of the Source's sound

**Parent spec:** `spec.md` in this feature folder (user stories 33–34, 59, 60; Implementation Decisions "Model", "API rules", "Planner, other", "Renderer", "Preview"); ADR 0016; GLOSSARY "Music Clip".

**What to build:** a Music Clip may be of the Source's sound instead of a Media Library item. It plays a range of the episode's sound anywhere on the Timeline, at its volume, fades, Keyframes and Speed, scaled by the Clip's own sound slider. Detach (09) will create these; this ticket makes them work for the agent, in the render, in the preview and on the Timeline.

- **Model.**
  - A Music Clip's `media` may be absent, meaning the Source's sound.
  - Its `offset` is then a time on the Source's timeline, and its read must lie within the Source.
  - It refuses `duck` once that field exists (10).
- **Planner.** `AudioEvent` carries `source`.
- **Renderer.**
  - The Source file (or, in Reverse, the Source's Retimed copy) is an input for such events.
  - Their volume is multiplied by `source_volume`.
  - Muted and fades apply as for any Music Clip.
- **Preview.** It plays from the Source's proxy (or Retimed copy) in a hidden element, as Overlay sounds do, at `source_volume` × its gain.
- **Timeline and inspector.**
  - Drawn on the Music Track with the Source's Peaks as its Waveform.
  - Labelled as the episode's sound.
  - "Starts in the song at" reads as a time in the episode.
- **Clipboard.** It pastes only into a Candidate of the same Job, as Segments of the Source do.
- **MCP.** The instructions explain a Music Clip without `media`. The dry run names it as the Source's.

**Blocked by:** 07.

**Status:** ready-for-agent

- [ ] A Music Clip of the Source's range under a media Segment renders that stretch of the episode's tone at its Timeline place, scaled by `source_volume`.
- [ ] At 2× and in Reverse it plays as a song's Music Clip does.
- [ ] The API and MCP refuse a read past the Source's end.
- [ ] The preview plays it in time with the playhead; its Waveform is the Source's.
- [ ] Pasting it into a Candidate of another Job is refused with a notice; into the same Job it pastes.
- [ ] A Candidate with only song Music Clips renders the same command as before.
