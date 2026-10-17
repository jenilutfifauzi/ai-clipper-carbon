# 07: A reversed Segment of the Source

**Parent spec:** `spec.md` in this feature folder (user stories 17, 20–21, 23; Solution "Reverse"; Implementation Decisions "The planner", "The preview"); ADR 0009, ADR 0006.

**What to build:** a Segment of the episode can be reversed. It shows no captions, its Scenes and face tracking are the forward ones mirrored, Layout Overrides still apply, and the preview plays its Split and Blur panels backwards from the copy. Through MCP; the switch comes in 08.

- **Planner.** A reversed Source Segment gets no Words. Its Scenes are its range's analysis with times turned (`t → length − t`), scaled by its Speed, and its camera path run backwards. A Layout Override applies to the Scene holding its Source time. No new analysis is run.
- **Renderer.** Its Scenes and panels are drawn from the full-size copy of the Source's range, at its Speed, with the Clip's own volume.
- **Preview.** A Segment played from a copy gets its own master and follower, parked at its start like a media Segment's video, so every panel of its Scenes draws from the copy. The decks resume at the next forward Source Segment.
- **Word Edits** inside a reversed Segment are kept and still apply wherever their time is shown forwards.

**Blocked by:** 03, 06.

**Status:** ready-for-agent

- [ ] The plan of a reversed Source Segment has no caption events in its span, and the captions on either side are unchanged.
- [ ] A Scene cut at 2 s into a 10 s range sits at 8 s into the reversed Segment on the Timeline (4 s at 2×).
- [ ] A Layout Override at a Source time inside it applies to the mirrored Scene.
- [ ] A Split Scene renders both panels reversed and in step.
- [ ] In the preview, a reversed Source Segment between two forward ones plays backwards with both panels, and the joins on either side are seamless.
