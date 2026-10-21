# 09: Duplicate a Candidate, keeping its aspect

**Parent spec:** `../spec.md` (User Stories 34–35; Implementation Decisions "Model": "Duplicate copies it"); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md ("To have another aspect, duplicate the Candidate and change the copy's aspect").

**What to build:** a Candidate can be duplicated as a new Candidate of the same Job, from Review and through MCP. Then the same moment can be had in two shapes: duplicate it, then change the copy's aspect in the Advanced Edit (the rescale from 04 applies).
- **The copy:** everything of the Candidate except its identity and history. That includes its range or Segments, hook, Layout and overrides, style and Style Overrides, Text Layers, Shapes, Overlays, Music Clips, Grade, effects, and its Canvas Aspect.
  - It gets a new id and starts at Revision 1.
  - It has no Clip.
  - It is listed right after the original.
- **Review:** a "Duplicate" action on the Candidate card.
- **MCP:** a `duplicate_candidate` tool, or the equivalent on an existing tool, returning the new Candidate. Every field reachable as for any Candidate.
- The review found that the codebase has no Candidate Duplicate yet. Ticket 03 couldn't build "Duplicate keeps it" for that reason.

**Blocked by:** None (01–08 are done).

**Status:** ready-for-agent

- [ ] API test: a duplicate of a 16:9 Candidate with layers is a new Candidate with the same fields, `aspect` included, Revision 1 and no Clip.
- [ ] MCP test: the agent duplicates a Candidate and changes the copy's aspect; the original is untouched.
- [ ] Browser: duplicating from Review and changing the copy to 1:1 in the Advanced Edit.
