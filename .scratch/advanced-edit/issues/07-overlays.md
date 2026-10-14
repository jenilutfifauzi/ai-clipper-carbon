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

**Status:** ready-for-agent

- [ ] Seam B: area, clamping, span.
- [ ] Seam A: an Overlay at its place and opacity during its span only; muted by default.
- [ ] Typecheck and build; browser walkthrough on desktop and phone.

## Comments
