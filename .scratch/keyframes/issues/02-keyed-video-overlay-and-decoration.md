# 02: Keyed video Overlays and decorated keyed pictures

**Parent spec:** `spec.md` (user stories 2–5, 42–43; Implementation Decisions "Renderer", "Preview").

**What to build:** a video Overlay can have Keyframes too. A keyed Overlay's rounded corners, border and shadow are drawn right at every frame: the corners scale with the picture, the border keeps its width in output pixels, and the shadow falls in the frame's own directions.

- **Renderer.** A keyed video Overlay is decoded by its own ffmpeg process. It crops the video and sends RGBA frames at the Clip's frame rate, over the span the Overlay shows, to the frame process. Its time lines up with the Overlay's start as today's video Overlays do.
- **The frame process** draws the corners and border at the sampled size and the shadow in screen space, after the rotation, for images and videos alike.
- **Preview.** A keyed video Overlay plays its motion as an image does (from 01).

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Seam A, real ffmpeg:
  - [ ] a video Overlay keyed in `x` has its centre at the sampled position, measured at two times;
  - [ ] its picture is the right frame of the video at those times (a frame-numbered test video);
  - [ ] a keyed Overlay with a radius, a border and a shadow, held at its constants, matches the static chain's frame above a set PSNR;
  - [ ] its border is the same width in pixels at scale 0.5 and at scale 1.
- [ ] Rendering a 10 s Clip with one keyed video Overlay is timed and noted in the ticket (expected around 1.5× realtime).
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
