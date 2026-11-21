# 05 — Hook, Watermark, and visual overlay assets

Type: grilling
Status: open
Blocked by: 02, 06

## Question

Which existing visual overlay behaviors must the native renderer and editor support first, and what is their canonical timing and asset model? Decide the ordering and editing parity for Hook (including Kicker/Emphasis), text or logo Watermark, text/image layers, stickers, intro/outro, animation, position/scale/opacity, and reusable brand/style presets.

Clarify whether native overlays must consume the full server `RenderPlan` geometry and timing or may expose a deliberately smaller local mode with its limits visible. Define how logos and other assets are imported, stored, and kept local, and what the editor shows when an asset is missing. The first local slice supports text-only hook/watermark and simple caption styling, not logo or layer parity.
