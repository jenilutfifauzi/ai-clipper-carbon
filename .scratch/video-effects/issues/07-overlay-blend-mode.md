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

**Status:** ready-for-agent

- [ ] Overlays accept `blend`. Stored Candidates render the same command as before.
- [ ] Seam B: the Blend Mode reaches the Overlay's plan.
- [ ] Seam A: Screen over a dark area lightens it, Multiply over a light area darkens it, and Normal is unchanged. The frame outside the Overlay's alpha and span is untouched.
- [ ] Seam A: a keyed Overlay with Screen blends like an unkeyed one.
- [ ] Refusals for an unknown mode, through the API and MCP; `dry_run` and the instructions mention Blend Mode.
- [ ] The preview shows each mode.
