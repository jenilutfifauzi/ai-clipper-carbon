# 05: Scale, rotation and opacity of a Text Layer on stage

**Parent spec:** `spec.md` (Solution "Transform and Keyframes", "On stage"; Implementation Decisions "Preview and editor"); docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md.

**What to build:** a Text Layer is handled on stage as an Overlay is.

- Corner grips set `transform.scale`, and the rotate grip `transform.rotation`, with the Overlay's snapping and guides. The centre stays on the frame, and the picture may go past its edges.
- The inspector shows the Transform's position, scale, rotation and opacity beside the Text Style. The font size stays in the Text Style.
- Scaling, turning and fading don't request a new picture. The picture is re-made at a larger scale only when the scale grows past what it was rasterised at.
- The dry run lists the bounds once turned and scaled.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] A rotated Text Layer's plate corners land in a rendered frame where the plan's turned bounds say.
- [ ] A layer at scale 3 is as sharp in the render as one at size ×3 (its picture was made at scale 3).
- [ ] At opacity 0.5, the text and the plate are half transparent over the video.
- [ ] Dragging a corner grip scales the layer without rewrapping it. The rotate grip turns it. Each is one undo step.
- [ ] Moving, turning or fading in the preview makes no picture request.
