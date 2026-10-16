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

**2026-10-16: walkthrough in Chrome (ego-browser), with two renders compared.** Passed:
- **An Overlay:** rotated by its handle (88° snaps to 90°), flipped, rounded, bordered, with a shadow. Its render matches the preview, and the shadow is there, if faint at its default.
- **Crop mode:** opens with a double-click, shows the cut part dimmed, and the kept part stays in place. Escape drops it, and one undo takes back the crop and its Transform.
- **Smart Guides:** an Overlay snaps to another's edge, and the line shows.
- **A Source Scene reframed by hand:** it starts from the cover scale with no jump. Panning, Fit over a colour and Use for all Scenes work, and its render matches.
- **A vertical video Segment:** turned 90° and filled at 177.8%.
- **The clip editor:** shows Manual chosen, has corner Grips only, and saves a pan.
- **Phone emulation (390×844, touch):** the toolbar has Transform, and a pinch with a twist gives 2× and +30° as one edit. The Transform sheet opens.

Found and fixed in 8f0426d:
- **Grips:** they were pulled in within 34 px of the stage's edge, so a small picture's edge Grips covered its middle and a drag there stretched it tenfold.
- **A colour Background:** it rendered black as #101010.
- **Crop mode's bar:** it was cut off on the desktop stage.
- **The Overlay hint:** it was out of date.

Not tried:
- a portrait Source (no portrait Job);
- a Transition between transformed Segments;
- Safari and a real iPhone.
