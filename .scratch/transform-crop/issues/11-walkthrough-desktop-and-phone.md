# 11: Walkthrough on desktop and phone

**Parent spec:** `spec.md` (Testing Decisions "Not automated: a browser walkthrough").

**What to build:** nothing new. Walk the whole feature in a browser, against rendered frames, and fix or file what is found.

**Blocked by:** 01, 02, 03, 04, 05, 06, 07, 08, 09, 10

**Status:** ready-for-human

- [ ] Desktop, Chrome and Safari:
  - [ ] an Overlay rotated, flipped, stretched, cropped in Crop mode, rounded to a circle, with a border and a shadow;
  - [ ] a sideways phone video as a media Segment, rotated 90° and filled;
  - [ ] a Source Scene switched to Manual, panned, zoomed, scaled over a colour, then Use for all Scenes;
  - [ ] the clip editor's Manual and pan;
  - [ ] a portrait episode: only As shot and Manual are offered (clip editor and Advanced Edit); Reframe by hand on one Scene, then Manual for the clip, and compare with the render;
  - [ ] Smart Guides between two Overlays;
  - [ ] each drag is one step of undo;
  - [ ] a Transition between two transformed media Segments.
- [ ] Phone, iPhone Safari: pinch, twist, the Transform sheet and Crop mode.
- [ ] Each step's preview matches a frame rendered at the same time.

## Comments
