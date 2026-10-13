# 14: Split & Blur layouts per scene

**Parent spec:** `spec.md` in this feature folder (Milestone M4; user stories 37, 48–51; Render Planner layout rules).

**What to build:** Each scene in a Clip gets its own layout:
- two faces → **Split**: two 1080×960 panels stacked, left face on top, each with its own camera;
- three or more faces, or none → **Blur**: the wide shot centred over a blurred background;
- one face → **Track**, from ticket 13.

Scenes shorter than 1 second are merged so the layout doesn't flicker. A layout override from Review replaces the automatic choice for every scene. An already-vertical Source is passed through.

**Blocked by:** 13 (Track layout with face tracking).

**Status:** ready-for-agent

- [ ] The face count per scene comes from 5 sampled frames. 1 face gives Track, 2 give Split, 0 or 3+ give Blur.
- [ ] Scenes shorter than 1 s are merged into a neighbouring scene before layouts are chosen.
- [ ] A Track, Split, or Blur override applies to every scene. A forced Split with fewer than two faces splits the frame into its left and right halves.
- [ ] A vertical Source is passed through without reframing.
- [ ] The Renderer composes vertical stacking for Split and a blurred background for Blur. Layouts switch at scene boundaries within a single process.
- [ ] Seam B tests cover:
  - the layout for 0, 1, 2, and 3+ faces;
  - the override on every scene;
  - short-scene merging;
  - Split panel order;
  - passthrough.
- [ ] Seam A test: the 2-face fixture renders a 1080×1920 Clip whose Render Plan uses Split.
- [ ] Manual visual check on real two-person and three-person wide scenes.
