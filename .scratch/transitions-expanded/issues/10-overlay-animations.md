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

**Status:** done

- [x] A Fade-in Overlay is transparent at its first frame and fully shown after `animation_ms` (real render).
- [x] A Pop-in Overlay is smaller at its first frame than at its middle.
- [x] A Slide-out Overlay is lower near its end.
- [x] A keyed and animated Overlay multiplies both: a keyed opacity of 0.5 fading in reaches 0.5, not 1.
- [x] A video Overlay's audio level is unaffected by its animation.
- [x] The preview's Overlay matches the render's opacity and scale at given times (vitest on the look maths).
- [x] `merge_candidate_items` sets an Overlay's animation alone, and the dry run shows it.
- [x] An Overlay stored without the fields reads with none.

## Comments

**2026-10-18, agent:** Built.
- **Model**: `Overlay` (`candidates.py`) gains `animation_in`, `animation_out` (the `Animation` enum) and `animation_ms` (100–2000, default 300), after `keys`; stored Overlays read with none. `OverlayEvent` (`planner.py`) carries the three, so the Preview Plan and the dry run see them.
- **Render**: the Picture layers' maths is now shared. `renderer.py`'s `layer_at`/`layer_animation` became `animated_at(shown, style, picture, time)` and `animation_at(shown, style, time)`; `layer_at` and the new `overlay_at` call them, and `_Shown`/`_Motion` take an `OverlayEvent`. A Pop also scales the corners' radius (a picture layer's is 0, so they draw as before). `_keyed_items` sends an Overlay that is keyed or animated (`_comes_animated`) to a frame process, sampled by `overlay_at`. The sound path is untouched: an Overlay's `AudioEvent` ignores the animation.
- **Preview**: new `frontend/src/pages/job/editor/animation.ts` holds `hookEnds` and `hookLook` (moved out of `ClipPreview.tsx`), `SLIDE_PX`, `movesOf`/`isAnimated` (an Overlay's fields are optional in `api.ts`'s `OverlayAnimation`; left out means none) and `animatedPicture` (pictureAt, then the look stacked on top). `placedLayer` now goes through `animatedPicture`. `PicturePanel` takes an optional `look`, and an animated one moves with the playback as a keyed one does. `PreviewOverlays` passes the Overlay's look, and a selected Overlay is shown whole while paused in its time, as a picked Text Layer is.
- **Editor**: `MotionFields` (`TextLayers.tsx`) also takes an Overlay (`kind: "overlay"`, groups `overlay:<id>:animation_in` and so on, missing fields read as none). The Overlay inspector shows it under its decoration.
- **Agent**: `edit_candidate` and `merge_candidate_items` take the fields through the generated schemas. The dry run's `overlays` gains `animation_in`/`animation_out` (each when not none) and `animation_ms` (when either animates) via `_animation_view`. The instructions describe the fields.
- **Budget**: the tool list grew about 580 bytes, from the Overlay fields in two schemas, so `TOOLS_BUDGET_BYTES` (`test_mcp.py`) went from 69_000 to 69_700, with a comment. `test_sped_overlays.py`'s expected plan event gains the three defaults.
- **Tests**:
  - `backend/tests/test_overlay_animations.py` (6). Seam B: the defaults and bounds, Pop/Slide/Fade stacked on keyed opacity, scale and place, and each end at most half the length. Seam A: one render with Fade, Pop, Slide and keyed+Fade Overlays, and one with a fading video Overlay whose 1500 Hz tone stays within 1 dB. MCP: merge sets the animation alone, a bad length is refused, and the dry run shows it.
  - `frontend/src/pages/job/editor/animation.test.ts` (4): the preview look maths, as worked examples of the render's.
  - `frontend/src/pages/job/advanced/overlayMotion.test.ts` (2): the inspector fields.
- Checked: frontend 801 passed (53 + 1 files), tsc clean. Backend: the full suite gave 817 passed and 9 failed. Two failures were real and are fixed: the tool budget and `test_sped_overlays`' expected event. The other seven (`test_audio_signal`, `test_resilience`, `test_upload`) are 5 s job-wait timeouts under a load average of about 25. Different ones fail on each rerun and none touches Overlays. On rerun, `test_overlay_animations`, `test_mcp`'s budget test, `test_sped_overlays`, `test_keyed_text_layers` and `test_keyed_shapes` pass.
