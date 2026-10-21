# 07: Blend Mode for Overlays

**Parent spec:** `../spec.md` ("Model", "Renderer", "Preview", "Inspector UI", "API and MCP"); ADR 0014.

**What to build:** an Overlay gets a Blend Mode: Normal, Multiply, Screen, Add, Lighten or Darken.
- A light leak on black set to Screen adds light.
- A paper texture set to Multiply darkens the picture beneath.

**The model:** Overlay gains `blend`, `normal` by default. An absent value reads as Normal.

**The render:**
- **Normal** keeps today's overlay.
- **Any other mode:**
  1. The Overlay, already drawn with its corners, rotation, shadow and opacity, is padded to the frame with transparency.
  2. Its colour is blended over the frame below with that mode.
  3. The result is masked by the Overlay's alpha and laid over the frame, only over the Overlay's span.
- This holds for keyed Overlays too: their full-frame RGBA from the frame process is blended the same way.

**The preview:** CSS `mix-blend-mode` on the Overlay's outer element. This matches the render.

**The editor and the agent:**
- A Blend Mode menu next to the Overlay's opacity in the Inspector. It applies to a Pick of several Overlays.
- `edit_candidate` and `merge_candidate_items` take `blend`, and `dry_run` shows a mode that isn't Normal.
- Split, duplicate, the Clipboard and the Revision merge carry it.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Overlays accept `blend`. Stored Candidates render the same command as before.
- [x] Seam B: the Blend Mode reaches the Overlay's plan.
- [x] Seam A: Screen over a dark area lightens it, Multiply over a light area darkens it, and Normal is unchanged. The frame outside the Overlay's alpha and span is untouched.
- [x] Seam A: a keyed Overlay with Screen blends like an unkeyed one.
- [x] Refusals for an unknown mode, through the API and MCP; `dry_run` and the instructions mention Blend Mode.
- [x] The preview shows each mode.

## Comments

Built end to end.
- **Model:** `BlendMode` (StrEnum, `app/candidates.py`) and `Overlay.blend`, Normal by default; an unknown mode is refused by pydantic (API 422, MCP error). `OverlayEvent.blend` carries it (`_overlay_event`). `scaled_plan` needs nothing.
- **Render:** `_laid(below, name, at, laid, out, blend, shows)` in `renderer.py` is the overlay step of `_picture` and of a keyed Overlay's frame feed. Normal returns today's string, so stored Candidates give the same command (test_keyframes' command fixtures pass). Another mode:
  - `below` is split three ways. One branch is made transparent (`colorchannelmixer=aa=0`), and the picture is laid on it at its place (`format=rgb`), which pads it to the frame.
  - That and `below` go to gbrap and meet in `blend=all_mode=<mode>` (Add is ffmpeg's `addition`), enabled over the span.
  - The result is masked by the padded picture's alpha (`alphaextract` and `alphamerge`) and laid over `below` with `overlay=0:0`, enabled over the span.
  - Each branch's format change follows a `scale`. Without it, `split` gave `below` itself the RGBA format, which moved the untouched frame's colour by about 5 levels. `BLEND_MODES` maps the modes.
- **MCP:** the tools budget went up to 87_500. The dry run lists `blend` under `overlays` when it isn't normal. The instructions have a paragraph on Blend Modes. `merge_candidate_items` takes `blend` through the generic patch model.
- **Frontend:**
  - `BlendMode` type, `Overlay.blend` and `OverlayEvent.blend` in `api.ts`.
  - `sharedBlend` and `setBlend` in `actions.ts`. Normal leaves the Overlay without the field.
  - `BlendModeField` in `Overlays.tsx`, shown after Opacity through `TransformFields`' new `blend` slot (from `OverlayTransform`'s `blend`). The Inspector's multi-pick view shows it too when an Overlay is picked.
  - `mixBlendMode` in `editor/videoEffects.ts` (Add is `plus-lighter`) goes on `PicturePanel`'s outer element (`blend` prop), from `PreviewOverlays`.
  - Split, duplicate, the Clipboard and the Revision merge already carry the field. vitest checks this.
- **Not drafted locally:** the preview takes the mode from the Preview Plan, so a change shows once the plan of the change comes. There is no local draft, unlike `draftVideoEffects`.
- **Not verified in a browser:** the CSS blend over the decks. vitest checks the markup only. The phone's Transform sheet has no menu.
- **Cost (for 10):** one full-frame planar-RGB `blend`, two format changes and an alpha merge per non-Normal Overlay. The blend and the last overlay are skipped outside the span (`enable`), the rest are not.
