# 02: Keyed video Overlays and decorated keyed pictures

**Parent spec:** `spec.md` (user stories 2–5, 42–43; Implementation Decisions "Renderer", "Preview").

**What to build:** a video Overlay can have Keyframes too. A keyed Overlay's rounded corners, border and shadow are drawn right at every frame: the corners scale with the picture, the border keeps its width in output pixels, and the shadow falls in the frame's own directions.

- **Renderer.** A keyed video Overlay is decoded by its own ffmpeg process. It crops the video and sends RGBA frames at the Clip's frame rate, over the span the Overlay shows, to the frame process. Its time lines up with the Overlay's start as today's video Overlays do.
- **The frame process** draws the corners and border at the sampled size and the shadow in screen space, after the rotation, for images and videos alike.
- **Preview.** A keyed video Overlay plays its motion as an image does (from 01).

**Blocked by:** 01

**Status:** done

- [x] Seam A, real ffmpeg:
  - [x] a video Overlay keyed in `x` has its centre at the sampled position, measured at two times;
  - [x] its picture is the right frame of the video at those times (a frame-numbered test video);
  - [x] a keyed Overlay with a radius, a border and a shadow, held at its constants, matches the static chain's frame above a set PSNR;
  - [x] its border is the same width in pixels at scale 0.5 and at scale 1.
- [x] Rendering a 10 s Clip with one keyed video Overlay is timed and noted in the ticket (expected around 1.5× realtime).
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built test first in `backend/tests/test_keyed_pictures.py` (Seam A through the API and the real ffmpeg), with the shared `keyed_picture.json` extended for the corners' radius (`picture.test.ts` reads it too).

- **API.** 01's two refusals in `_check_media_of` (`api.py`), picture Keyframes on a video Overlay and on a decorated one, are gone. 03's refusal of a volume Keyframe on an image stays. `test_keyframes.py`'s refusal table lost those two rows and gained a keyed, decorated video Overlay that is accepted. The MCP instructions say "Keyframes move an Overlay" (not "an image Overlay").
- **Planner.** `picture_at` gives the sampled `radius` too: the constant's times the sampled shorter side over the constant's, so the corners scale with the picture. The border and shadow stay in output pixels. `pictureAt` in `picture.ts` does the same, so the preview's corners scale too (`PicturePanel` already repainted `borderRadius` from it). `keyed_picture.json`'s picture now has a radius of 24.4, and each sampled time has its `radius`.
- **Frame process** (`backend/app/frames.py`).
  - `PictureFrames(picture, image=None)` gained `show(cut)`: a video's frame, already cropped and flipped (at any size), to draw next. It drops the caches.
  - `_decorated` / `_decorate` round the corners and draw the border on the scaled part before it is turned. They use the box's signed distance at each pixel's middle, in the picture's drawn pixels, as `_corners`' `geq` does. Only the bands along the edges (radius or border width, plus a pixel) are touched. The margin's pixels get the border's colour, so the turn doesn't fringe it.
  - `_over_shadow` lays the turned box over its shadow: the alpha moved by the offset, blurred with sigma blur / 2, in the colour at the opacity. A blur with a sigma of 6 or more is made at 1/⌊sigma/3⌋ size and brought back. The over is straight alpha's, through `cv2.blendLinear`.
  - The box is turned with `shadow_room` round it, out to `room` past the frame, so a shadow cast from just off the frame still falls on it. `shadow_room(shadow)` is now the one rule; `renderer.py`'s `_shadow` uses it too, with the same values as before.
- **Video decode.** `VideoDecode(ffmpeg, video, picture, start, end, offset, fps)` runs `ffmpeg -ss <offset> -t <span> -i <video> -vf setpts=PTS-STARTPTS+<start>/TB,fps=<rate>:start_time=<first/fps>:round=up,crop=…:exact=1[,scale=W:H:flags=lanczos][,hflip][,vflip],format=rgba -frames:v <n> -f rawvideo pipe:1`.
  - `round=up` picks the video's last frame at or before each Clip frame's time, as the still chain's overlay does, from its first frame after the offset.
  - It is scaled down to the largest size the picture is drawn at over its span (`size`, from `picture_at` at every frame), so no more is piped than is drawn.
  - `frames()` reads into two reused arrays and holds the last whole frame if the video ends early. With no frame at all, it raises "The video X couldn't be decoded: <ffmpeg's last line>", which the render reports as "A keyed picture couldn't be drawn: …".
  - `FrameFeed(frames, start, end, fps, video=None)` shows each decoded frame before it draws it, and ends the decode when it stops.
- **Renderer.** `_keyed_items` now gives a keyed Overlay's image pixels or its video's `Path`. `_feeds(plan, items, ffmpeg)` makes a `VideoDecode` for a video. Nothing else in the command changes.

Choices:
- **The PSNR test holds the picture at 90°,** not at an angle in between. At 30° the still chain itself lands up to half a pixel off: `rotate`'s whole-pixel output size and `overlay`'s whole-pixel place. The frame process is exact, so the border's hard edges make 30 dB of that. Undecorated it is 34 dB. At 90° the two agree to 50 dB with a radius, a border and a shadow (the bar is 40). A shadow turned with the picture would fall at (-18, 12) instead of (12, 18) and fail it.
- **At a video's end the frame process holds its last frame up to the Overlay's end.** The still chain's video runs out up to a frame early: `-ss` lands on the first frame after the offset, and `setpts=PTS-STARTPTS` starts it there, so it ends that much early. Checked frame by frame against the still chain with a frame-numbered video (Clips at 25, 30 and 60 fps): the same frame of the video on every Clip frame, but for that last one or two.
- **The shadow's blur is a true Gaussian** (OpenCV) where `gblur` approximates one, and the over is straight alpha's where `overlay=format=rgb` mixes the colours by the top alpha alone. The difference is in the antialiased edge only.

Measured on this Mac (VideoToolbox), a 10 s Clip of a 1920×1080 30 fps Source with a 1920×1080 video Overlay:
- no Overlay: 4.1× realtime;
- the Overlay still (scale 0.5, turned 10°): 2.4×;
- keyed in x, scale (0.4 → 0.7) and rotation: **1.53×**;
- the same still with radius, border and shadow: 2.1×;
- keyed and decorated: 1.25×.

Before the decode scaled the video down, the keyed one was 1.25×, and the shadow's full-size blur and float compositing took the decorated one down to 0.57×. Drawing one frame at that size is 3.6 ms plain and 13 ms with all three decorations.

Not checked by hand: the preview of a keyed video Overlay in the browser. It goes through the same `PicturePanel` path as an image (01's `playback` repaint, and `follow` for the video's time). `picture.test.ts` checks the corners' radius against the backend at ten times.
