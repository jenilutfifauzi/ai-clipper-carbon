# 10: Overlays animate in and out

**Parent spec:** `../spec.md` (Solution "Overlays animate in and out", "Model", "Overlays animated"); GLOSSARY **Overlay**.

**What to build:** an Overlay gets the Text Layer's in/out animations: `animation_in` and `animation_out` (none, Fade, Pop, Slide) and `animation_ms` (100–2000, default 300). Stored Overlays read with none.

**Render and preview:**
- An animated Overlay is drawn by a frame process, as a keyed one is.
- The animation is applied on top of its keyed values exactly as for Picture layers: opacity and scale multiplied, Slide's drop added, each end at most half its length.
- The preview applies the same maths.
- The animation changes the picture only. A video Overlay's sound keeps its own volume and Keyframes.

**Editor and agent:**
- The Overlay inspector shows the Text Layer's motion fields (Comes on, Goes off, Animation length).
- `edit_candidate` and `merge_candidate_items` take the fields.
- The dry run shows them.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A Fade-in Overlay is transparent at its first frame and fully shown after `animation_ms` (real render).
- [ ] A Pop-in Overlay is smaller at its first frame than at its middle.
- [ ] A Slide-out Overlay is lower near its end.
- [ ] A keyed and animated Overlay multiplies both: a keyed opacity of 0.5 fading in reaches 0.5, not 1.
- [ ] A video Overlay's audio level is unaffected by its animation.
- [ ] The preview's Overlay matches the render's opacity and scale at given times (vitest on the look maths).
- [ ] `merge_candidate_items` sets an Overlay's animation alone, and the dry run shows it.
- [ ] An Overlay stored without the fields reads with none.
