# 02: 31 xfade built-ins in seven groups, both sides moving in the preview

**Parent spec:** `../spec.md` (Solution's table, "Model", "Preview", "Advanced Edit", "Agent (MCP)"); ADR 0012.

**What to build:** the owner sees the Transitions tab grouped into Basic, Slide, Wipe, Shape, Zoom, Light and Glitch, and can apply any of xfade's 31 built-in kinds in the spec's table. That is 21 new ones beside the ten of today:
- `fadegrays`, `dissolve`;
- `coverleft`, `coverright`, `coverup`, `coverdown`;
- `wiperight`, `wipeup`, `wipedown`, `radial`;
- `circleclose`, `circlecrop`, `rectcrop`, `vertopen`, `horzopen`;
- `squeezeh`, `squeezev`;
- `pixelize`, `hblur`, `distance`, `hlslice`.

Each renders through its recipe (01) and is imitated in the preview with CSS:
- the outgoing and incoming layers are both styled over the overlap, so Push, Cover and Squeeze move both pictures as they render;
- wipes, doors, box and circles use `clip-path`;
- Clock wipe uses a `conic-gradient` mask;
- Dip through grey and Blur use `filter`;
- Dissolve uses a noise mask;
- Pixelize and Slices use an SVG filter or the nearest CSS;
- Distance is a crossfade.

A Transition's length is now 0.1–3 s (was 0.2–1.5), default 0.5, still at most half the shorter neighbour. The Length slider follows.

The Transitions tab lists the groups as sections with sticky headings. Kinds are still text buttons; cards come in 03. Groups with no kinds yet (Light) are hidden until they have some.

The agent sees every kind in the schemas. The tool descriptions name the groups and their kinds and the length bounds. The dry run's plan view gains `transitions` (after, kind, start, end).

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] Each of the 21 new kinds is accepted by the API and MCP and renders: a sample (`coverleft`, `pixelize`, `radial`, `rectcrop`) has a mid-Transition frame unlike both sides, and the Clip is shortened by the overlap.
- [ ] `secs` of 0.1 and 3.0 are accepted, and 0.05 and 3.5 are refused with a clear message. The half-the-shorter clamp still applies.
- [ ] In the preview, Push left moves the incoming picture in from the right while the outgoing one leaves to the left. Cover left moves only the incoming one.
- [ ] Each look shows only the outgoing picture at progress 0 and only the incoming one at 1 (vitest over the catalogue).
- [ ] The tab shows group sections with sticky headings in the spec's order.
- [ ] The dry run lists `transitions`.
- [ ] Saved Candidates with the old ten kinds load and render unchanged.
