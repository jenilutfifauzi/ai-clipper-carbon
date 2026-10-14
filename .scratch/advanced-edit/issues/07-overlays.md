# 07: Overlays (picture in picture)

**Parent spec:** `spec.md` in this feature folder (user story 13).

**What to build:**
- **Model:** `Overlay` on the Candidate (`overlays`): `media` (video or image), `start`/`secs` (Timeline time), `offset`, `x`/`y`/`scale`, `opacity`, `volume` (default 0).
- **Planner:** an `OverlayEvent`, drawn above the Segments and below the Watermark.
- **Renderer:**
  - Each Overlay is an extra input: trim, then `scale`, then `colorchannelmixer` for opacity.
  - It is placed with `overlay=…:enable='between(t,a,b)'` (with `setpts` offset) before the `ass` filter.
  - Its audio joins `amix` when `volume` is above 0.
- **Preview:** a DOM layer (video proxy or image) on the stage that can be dragged and resized. Video is slaved to `Playback`.
- **Workspace:** an Overlay track (move, trim, split, delete). The inspector sets opacity and volume.
- **Media Library:** deleting an item in use as an Overlay is refused.
- **Glossary:** add **Overlay**.

**Blocked by:** 06.

**Status:** done

- [x] Seam B: area, clamping, span.
- [x] Seam A: an Overlay at its place and opacity during its span only; muted by default.
- [x] Typecheck and build; browser walkthrough on desktop and phone.

## Comments

**2026-10-14: done.**

**Checks:**
- `tests/test_overlays.py`:
  - Seam B: size and place, clamping to the frame, cut where the Clip or its video ends, images, a missing item.
  - Seam A: validation (past the video's end, an unknown item, opacity > 1); muted by default; the delete of an image in use refused.
  - Seam A: a green video and a blue image burned in where and only when planned (pixel colour inside their areas at two times).
- `npm run build`.
- Browser:
  - An uploaded PNG added as an overlay.
  - Dragged on the preview (y 760 → 987).
  - Resized by its corner (width 540 → 673, its top-left kept).

**Changes from the plan:**
- An Overlay's size is its width in output pixels; its height follows its shape.
- A video's sound, when turned up, is planned as an `AudioEvent`, so the music mixer and the preview's music player handle it.
- In the Media tab, a video's card adds it to the Main Track, and its layers button adds it as an Overlay. An image's card adds an Overlay.
- No rounded corners or borders yet (the plan's "+ corners" option wasn't chosen).
