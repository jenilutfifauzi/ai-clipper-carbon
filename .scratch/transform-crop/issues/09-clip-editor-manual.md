# 09: Manual in the clip editor

**Parent spec:** `spec.md` (user story 37; Implementation Decisions "Clip editor"); ADR 0007.

**What to build:** in the clip editor, Manual joins the Layout choices for the Candidate and per Scene.
- Choosing it copies the plan's `ScenePlan.framing`.
- On the preview, a Manual Scene's picture can be dragged to pan and scaled from its corners, through 05's gesture module.
- There is no rotation, edge stretch, crop or Background here.

**Blocked by:** 04, 05

**Status:** ready-for-agent

- [ ] Walkthrough: choose Manual for one Scene and for the Candidate, pan and zoom, and compare with the render. The Advanced Edit shows the same Framing.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments
