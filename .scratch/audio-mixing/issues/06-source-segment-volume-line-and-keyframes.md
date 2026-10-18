# 06: Volume Line and volume Keyframes on Source Segments

**Parent spec:** `spec.md` in this feature folder (user stories 10–13, 60; Solution "Source Segments get a Volume Line and volume Keyframes"; Implementation Decisions "Model", "Planner, other", "Renderer", "Timeline", "Inspector"); ADR 0016 (amends 0008); GLOSSARY "Volume Line", "Keyframe".

**What to build:** a Source Segment's volume can be dragged on its Volume Line and keyed over time, as a media Segment's can, in the editor and through the agent. The Clip's own sound slider (`source_volume`) still scales every Source Segment, keyed or not.

- **Model.** A Source Segment accepts volume Keyframes and still refuses picture Keyframes. A Freeze frame still refuses volume Keyframes. The error names what is refused.
- **Planner.** A Source Segment's `gain` carries its volume Keyframes.
- **Renderer.** The keyed path multiplies by `source_volume` for a Source Segment (it doesn't today, because only media Segments were keyed).
- **Preview.** The decks' Source sound follows the keyed curve × `source_volume`.
- **Timeline.** A Volume Line on Source Segments, at the Segment's own volume, following its Keyframes. It can be dragged on a picked one, with Auto-key. The Waveform is shaped by the gain.
- **Inspector and Keyframes pane.** The keyed volume control (‹ ◆ ›) on a Source Segment. Its volume row in the Keyframes pane.
- **MCP.** The instructions no longer say a Segment of the episode has none.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Source Segment keyed from 1 to 0.25 renders as loud as its sampled gain at chosen times (tone), with `source_volume` 0.5 halving it.
- [ ] The API and MCP accept volume Keyframes on a Source Segment and refuse picture Keyframes on it, and volume Keyframes on a Freeze frame.
- [ ] Dragging a Source Segment's Volume Line sets its volume; once keyed, it writes a Keyframe at the playhead (Auto-key).
- [ ] Split and trim of a keyed Source Segment re-anchor its volume Keyframes as a media Segment's are.
- [ ] The Keyframes pane shows a Source Segment's volume row.
- [ ] Backend tests and `npm run typecheck && npm run build` pass.
