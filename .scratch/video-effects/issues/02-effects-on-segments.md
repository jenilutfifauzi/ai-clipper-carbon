# 02: Video Effects on Segments

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview", "Inspector UI", "API and MCP"); ADR 0014.

**What to build:** a Segment, of the Source or a media item, gets a stack of Video Effects, as an Overlay did in 01.
- **Where it applies:** to the Segment's whole frame (panels, picture and Background) after its Grade and before the joins. A Transition therefore crossfades pictures that already carry their effects.
- **Sizes:** the frame is 1080×1920 at scale 1, so its sizes are not scaled.

**The model:** Segments gain `video_effects`, with the same entry shape and validation as Overlays.

**The render:**
- A Segment with a non-empty, enabled stack is not "plain". Both the concat fast path and the collapse of a single plain Segment back into a range must count it.
- A Freeze frame takes effects like any other Segment.

**The preview:** the effects' SVG filters are chained after the Segment's Grade on the decks (and on media Segments), as the Grade's filter is applied there.

**The editor and the agent:**
- The Inspector's Effects section shows for a Segment. A mixed Pick of Segments and Overlays applies an action to all of them where their stacks are equal.
- `edit_candidate`, `merge_candidate_items` and `dry_run` cover Segments.
- Split copies the stack to both halves.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Segments accept `video_effects`, and stored Candidates render the same command as before.
- [ ] Seam B: the stack reaches the Segment's plan with its enabled entries only.
- [ ] Seam A: Gaussian blur on a Source Segment and on a media Segment blurs the frame, and a blurred Segment between plain ones keeps its timing at a join and under a Transition.
- [ ] A Segment with effects is not collapsed back into a range or put on the concat fast path.
- [ ] The preview blurs the Segment on the decks and stops at its edges.
- [ ] MCP and `dry_run` show Segment stacks, and the instructions mention Segments.
- [ ] Vitest: split keeps the stack on both halves, and a mixed Pick of Segments and Overlays applies an action to both.
