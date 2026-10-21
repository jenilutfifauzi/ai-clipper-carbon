"""The frame process (docs/adr/0008-keyframes-for-pictures-and-sound.md): a keyed picture drawn for
every output frame of its span with OpenCV, into a transparent RGBA frame of the Clip's size, and
written raw to a pipe that ffmpeg reads as one of its inputs and lays over the Clip at 0, 0
(app/renderer.py).

For each frame, at its time n / fps of the Clip (`frame_numbers`), the picture's tracks are sampled
by the rule the preview samples them by (`picture_at`, app/keyframes.py), and `PictureFrames.draw`:
- takes the part of its cropped, flipped item that is on the frame (and a little round it), scaled
  to its sampled size (area resampling when it shrinks, bilinear when it grows), so a picture zoomed
  far past the frame costs no more than one on it;
- gives it 2 px of transparent margin, its colour copied from its edge, so that the turn's
  interpolation fades its edge out rather than into black;
- rounds its corners at their sampled radius and draws its border along the inside of its edge, as
  many output pixels wide whatever its size, as the still chain does (renderer.py's `_corners`);
- turns it about its sampled centre, placed in fractions of a pixel, into only the box that holds
  it on the frame, the rest of the reused frame cleared where it was drawn the frame before;
- lays it over its shadow, cast from its turned shape, so that it falls in the frame's own
  directions, as the still chain's (`_shadow`);
- multiplies its alpha by the sampled opacity.

The alpha is straight: ffmpeg's overlay of a premultiplied picture over yuv420p darkens it.

An image is read once, and graded and drawn through its Video Effects once by ffmpeg when its
Overlay has a Grade or effects (`graded_image`), unless an effect of it changes with time (Film
grain, Bloom pulse): then it is read as a looping stream, as a video is (`VideoDecode`'s `looped`). A
video is decoded by an ffmpeg process of its own
(`VideoDecode`), which crops and flips it, brings it down to the largest size it is drawn at, grades
it, draws it through its Video Effects, and sends a frame for each of the Clip's, timed as the still
chain times a video Overlay. Either way the effects come before the sampled scale (docs/adr/0014):
their sizes are made those of the pixels they work on (`_effects_at`), so a keyed picture shows the
effects of an unkeyed one at the same scale.

`FrameFeed` writes one picture's frames to its pipe from a thread of its own, so that ffmpeg, reading
every input as it needs it, never waits on another. A feed whose ffmpeg has gone (failed or stopped)
stops at its next write.
"""

import math
import os
import subprocess
import tempfile
import threading
from collections.abc import Callable, Iterator
from pathlib import Path

import cv2
import numpy as np

from app.candidates import Border, Shadow
from app.canvas import PORTRAIT
from app.planner import Picture, picture_at
from app.segment_time import SegmentTime
from app.video_effects import Clock, VideoEffect, scaled_effects, video_effect_chain

# The transparent margin round a picture before it is turned, in output pixels.
MARGIN = 2
# A shadow's blur is made at a size where its sigma is about this many pixels.
BLUR_SIGMA = 3


def frame_numbers(start: float, end: float, fps: float) -> range:
    """The numbers n of the Clip's frames, at n / `fps` seconds into it, from `start` until `end`."""
    return range(math.ceil(start * fps - 1e-6), math.ceil(end * fps - 1e-6))


def shadow_room(shadow: Shadow) -> int:
    """How far round a picture its `shadow` can fall, in output pixels: its blur's reach (three
    sigmas, the sigma half the blur, as a CSS shadow's) and its offset."""
    return math.ceil(1.5 * shadow.blur) + math.ceil(max(abs(shadow.x), abs(shadow.y)))


class PictureFrames:
    """The frames of one keyed `picture`, each drawn into one reused frame of the Clip's size `frame`
    (the 9:16 Canvas's by default; the renderer gives the size it draws the plan at), of an item whose
    pixels are `image` (RGBA, its whole size), or of a video's frames, each cropped and flipped
    already (and maybe scaled), `show`n before it is drawn. The picture at a time is `sampled` from
    it: by its motion (`picture_at`) unless another rule is given (a picture layer's animations,
    app/renderer.py's `layer_at`)."""

    def __init__(
        self,
        picture: Picture,
        image: np.ndarray | None = None,
        frame: tuple[int, int] = PORTRAIT.size,
        sampled: Callable[[float], Picture] | None = None,
    ) -> None:
        self.picture = picture
        self.sampled = sampled or (lambda time: picture_at(picture, time, frame))
        self.canvas = np.zeros((frame[1], frame[0], 4), np.uint8)
        # Where the frame before drew, cleared before the next is drawn.
        self.drawn: tuple[int, int, int, int] | None = None
        # The last part scaled and decorated, and what it was made from.
        self.scaled: tuple[tuple[int, ...], np.ndarray] | None = None
        self.decorated: tuple[tuple[float, ...], np.ndarray] | None = None
        self.source = np.zeros((1, 1, 4), np.uint8)
        if image is not None:
            crop = picture.crop
            cut = image[crop.y : crop.y + crop.height, crop.x : crop.x + crop.width]
            if picture.flip_h:
                cut = cut[:, ::-1]
            if picture.flip_v:
                cut = cut[::-1]
            self.show(np.ascontiguousarray(cut))

    def show(self, cut: np.ndarray) -> None:
        """Draw `cut` from now on: the item's pixels in the picture's crop, at any size, flipped as the
        picture is (RGBA)."""
        self.source = cut
        self.scaled = self.decorated = None

    def draw(self, time: float) -> np.ndarray:
        """The frame at `time` seconds into the Clip: the picture as sampled there, over transparency."""
        if self.drawn is not None:
            x0, y0, x1, y1 = self.drawn
            self.canvas[y0:y1, x0:x1] = 0
            self.drawn = None
        at = self.sampled(time)
        if at.opacity <= 0 or at.width < 0.5 or at.height < 0.5:
            return self.canvas
        frame_width, frame_height = self.canvas.shape[1], self.canvas.shape[0]
        # A shadow falls on the frame from as far off it as it reaches.
        room = shadow_room(at.shadow) if at.shadow else 0
        angle = math.radians(at.rotation)
        cos, sin = math.cos(angle), math.sin(angle)
        cx, cy = at.centre
        width, height = float(at.width), float(at.height)

        # What of the picture (in its drawn pixels, from its top-left corner) is on the frame, or
        # near enough to cast its shadow onto it.
        corners = [(-room, -room), (frame_width + room, -room), (-room, frame_height + room), (frame_width + room, frame_height + room)]
        local = [((px - cx) * cos + (py - cy) * sin + width / 2, -(px - cx) * sin + (py - cy) * cos + height / 2) for px, py in corners]
        u0 = max(min(u for u, _ in local) - MARGIN, 0.0)
        u1 = min(max(u for u, _ in local) + MARGIN, width)
        v0 = max(min(v for _, v in local) - MARGIN, 0.0)
        v1 = min(max(v for _, v in local) + MARGIN, height)
        if u1 <= u0 or v1 <= v0:
            return self.canvas

        # That part of the item, a pixel more each side for the scaling to read, and its size drawn.
        source_height, source_width = self.source.shape[:2]
        per_x, per_y = source_width / width, source_height / height
        sx0, sx1 = max(math.floor(u0 * per_x) - 1, 0), min(math.ceil(u1 * per_x) + 1, source_width)
        sy0, sy1 = max(math.floor(v0 * per_y) - 1, 0), min(math.ceil(v1 * per_y) + 1, source_height)
        left, top = sx0 / per_x, sy0 / per_y
        across, down = (sx1 - sx0) / per_x, (sy1 - sy0) / per_y
        size = (max(1, round(across)), max(1, round(down)))
        padded = self._scaled((sx0, sx1, sy0, sy1, *size))
        step_x, step_y = across / size[0], down / size[1]
        if at.radius > 0 or at.border is not None:
            padded = self._decorated(padded, (left, top, step_x, step_y, width, height, at.radius), at.border)

        # From the padded part's pixels to the frame's: scaled, moved to the picture's centre, turned
        # about it; a pixel's middle at its index plus a half on both.
        offset_x = left + (0.5 - MARGIN) * step_x - width / 2
        offset_y = top + (0.5 - MARGIN) * step_y - height / 2
        matrix = np.array([
            [cos * step_x, -sin * step_y, cos * offset_x - sin * offset_y + cx - 0.5],
            [sin * step_x, cos * step_y, sin * offset_x + cos * offset_y + cy - 0.5],
        ])
        rows, columns = padded.shape[:2]
        edges = np.array([[-0.5, -0.5, 1], [columns - 0.5, -0.5, 1], [-0.5, rows - 0.5, 1], [columns - 0.5, rows - 0.5, 1]])
        placed = edges @ matrix.T + 0.5
        # The box it is turned into, with room for its shadow, as far as that can reach the frame.
        x0, y0 = max(math.floor(placed[:, 0].min()) - room, -room), max(math.floor(placed[:, 1].min()) - room, -room)
        x1 = min(math.ceil(placed[:, 0].max()) + room, frame_width + room)
        y1 = min(math.ceil(placed[:, 1].max()) + room, frame_height + room)
        if min(x1, frame_width) <= max(x0, 0) or min(y1, frame_height) <= max(y0, 0):
            return self.canvas
        matrix[:, 2] -= (x0, y0)
        box = cv2.warpAffine(padded, matrix, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
        if at.shadow is not None:
            box = _over_shadow(box, at.shadow)
        # Only what is on the frame.
        box = box[max(-y0, 0) : box.shape[0] - max(y1 - frame_height, 0), max(-x0, 0) : box.shape[1] - max(x1 - frame_width, 0)]
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, frame_width), min(y1, frame_height)
        if at.opacity < 1:
            box[..., 3] = cv2.convertScaleAbs(box[..., 3], alpha=at.opacity)
        self.canvas[y0:y1, x0:x1] = box
        self.drawn = (x0, y0, x1, y1)
        return self.canvas

    def _scaled(self, key: tuple[int, ...]) -> np.ndarray:
        """The item's pixels `sx0`:`sx1` across and `sy0`:`sy1` down scaled to `width` x `height`, with
        MARGIN transparent pixels of their edge's colour round them: kept for the next frame, which
        often needs the same."""
        if self.scaled is not None and self.scaled[0] == key:
            return self.scaled[1]
        sx0, sx1, sy0, sy1, width, height = key
        part = self.source[sy0:sy1, sx0:sx1]
        shrinks = width < part.shape[1] and height < part.shape[0]
        scaled = cv2.resize(part, (width, height), interpolation=cv2.INTER_AREA if shrinks else cv2.INTER_LINEAR)
        padded = cv2.copyMakeBorder(scaled, MARGIN, MARGIN, MARGIN, MARGIN, cv2.BORDER_REPLICATE)
        padded[:MARGIN, :, 3] = padded[-MARGIN:, :, 3] = 0
        padded[:, :MARGIN, 3] = padded[:, -MARGIN:, 3] = 0
        self.scaled = (key, padded)
        return padded

    def _decorated(self, padded: np.ndarray, geometry: tuple[float, ...], border: Border | None) -> np.ndarray:
        """`padded`, a part of the picture `width` x `height` large whose first pixel inside its margin
        is at `left`, `top` of it and whose pixels are `step_x` x `step_y` of it, its corners rounded
        `radius` and its `border` drawn (`_decorate`): kept for the next frame, which often needs the
        same."""
        assert self.scaled is not None
        key = (*self.scaled[0], *geometry)
        if self.decorated is not None and self.decorated[0] == key:
            return self.decorated[1]
        left, top, step_x, step_y, width, height, radius = geometry
        rows, columns = padded.shape[:2]
        # Each pixel's middle, in the picture's drawn pixels from its top-left corner.
        us = left + (np.arange(columns, dtype=np.float32) - MARGIN + 0.5) * step_x
        vs = top + (np.arange(rows, dtype=np.float32) - MARGIN + 0.5) * step_y
        # Nothing changes farther inside than the radius and the border's width: only the bands
        # along the edges are drawn.
        reach = max(radius, border.width if border is not None else 0) + 1
        top_rows, bottom_rows = int(np.searchsorted(vs, reach)), int(np.searchsorted(vs, height - reach))
        left_columns, right_columns = int(np.searchsorted(us, reach)), int(np.searchsorted(us, width - reach))
        bottom_rows, right_columns = max(bottom_rows, top_rows), max(right_columns, left_columns)
        out = padded.copy()
        for down, across in (
            (slice(0, top_rows), slice(0, columns)),
            (slice(bottom_rows, rows), slice(0, columns)),
            (slice(top_rows, bottom_rows), slice(0, left_columns)),
            (slice(top_rows, bottom_rows), slice(right_columns, columns)),
        ):
            if down.stop > down.start and across.stop > across.start:
                out[down, across] = _decorate(out[down, across], us[across], vs[down], width, height, radius, border)
        self.decorated = (key, out)
        return out


def _decorate(pixels: np.ndarray, us: np.ndarray, vs: np.ndarray, width: float, height: float, radius: float, border: Border | None) -> np.ndarray:
    """`pixels` (RGBA, their middles at `us` across and `vs` down a `width` x `height` picture) with
    the picture's `border` laid over them within its width of the edge, and their alpha cut to the
    box with its corners rounded `radius`, each anti-aliased over a pixel by the box's signed
    distance, as `_corners` in renderer.py does."""
    across = np.abs(us - width / 2) - (width / 2 - radius)
    down = np.abs(vs - height / 2) - (height / 2 - radius)
    outside = np.hypot(np.maximum(across, 0)[None, :], np.maximum(down, 0)[:, None])
    distance = outside + np.minimum(np.maximum(across[None, :], down[:, None]), 0) - radius
    colour = pixels[..., :3].astype(np.float32)
    alpha = pixels[..., 3].astype(np.float32) / 255
    if border is not None:
        ring = np.clip(distance + border.width + 0.5, 0, 1)
        shade = np.array([int(border.colour[i : i + 2], 16) for i in (1, 3, 5)], np.float32)
        colour = colour * (1 - ring[..., None]) + shade * ring[..., None]
        alpha = ring + alpha * (1 - ring)
    alpha *= np.clip(0.5 - distance, 0, 1)
    return np.dstack([colour, alpha * 255]).round().astype(np.uint8)


def _over_shadow(box: np.ndarray, shadow: Shadow) -> np.ndarray:
    """`box` (RGBA, a turned picture with room round it) laid over its `shadow`: its alpha at the
    shadow's opacity, moved by its offset and blurred, in its colour. A wide blur is made at a
    smaller size and brought back, which a shadow's smoothness hides and which costs a fraction."""
    alpha = box[..., 3]
    dx, dy = round(shadow.x), round(shadow.y)
    cast = np.zeros_like(alpha)
    rows, columns = alpha.shape
    cast[max(dy, 0) : rows + min(dy, 0), max(dx, 0) : columns + min(dx, 0)] = alpha[max(-dy, 0) : rows - max(dy, 0), max(-dx, 0) : columns - max(dx, 0)]
    sigma = shadow.blur / 2
    if sigma:
        shrink = max(1, math.floor(sigma / BLUR_SIGMA))
        if shrink > 1:
            small = cv2.resize(cast, (math.ceil(columns / shrink), math.ceil(rows / shrink)), interpolation=cv2.INTER_LINEAR)
            small = cv2.GaussianBlur(small, (0, 0), sigma / shrink)
            cast = cv2.resize(small, (columns, rows), interpolation=cv2.INTER_LINEAR)
        else:
            cast = cv2.GaussianBlur(cast, (0, 0), sigma)
    # Straight alpha's "over": each colour weighted by its share of what shows.
    over = alpha.astype(np.float32) * (1 / 255)
    under = cast.astype(np.float32) * (shadow.opacity / 255)
    under *= 1 - over
    shade = np.empty_like(box)
    shade[...] = (*(int(shadow.colour[i : i + 2], 16) for i in (1, 3, 5)), 255)
    out = cv2.blendLinear(box, shade, over, under)
    out[..., 3] = cv2.convertScaleAbs(over + under, alpha=255)
    return out


def read_image(path: os.PathLike | str) -> np.ndarray:
    """An image's pixels as RGBA, opaque where it has no alpha of its own."""
    pixels = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if pixels is None:
        raise RuntimeError(f"The image {path} couldn't be read")
    if pixels.ndim == 2:
        return cv2.cvtColor(pixels, cv2.COLOR_GRAY2RGBA)
    if pixels.shape[2] == 3:
        return cv2.cvtColor(pixels, cv2.COLOR_BGR2RGBA)
    return cv2.cvtColor(pixels, cv2.COLOR_BGRA2RGBA)


def _effects_at(
    picture: Picture, effects: list[VideoEffect], size: tuple[int, int], clock: Clock = Clock(), canvas: tuple[int, int] = PORTRAIT.size
) -> list[str]:
    """The filters of `effects` (an Overlay's, their sizes as `picture` is drawn at its constants) on
    its pixels at `size` (width, height) on `canvas` (the plan's Canvas, at its own size), its time by `clock`: their sizes times the pixels per drawn
    pixel along its more stretched axis (the fewer), the one an unkeyed picture's sizes come from
    (`overlay_scale`), so that a stretched picture's effect is as wide along it as unkeyed. Along the
    other axis it is narrower, stretched with the picture: unkeyed, it isn't."""
    per_pixel = min(size[0] / picture.width, size[1] / picture.height)
    return video_effect_chain(scaled_effects(effects, per_pixel), size, clock=clock, frame=canvas) if effects else []


def graded_image(
    ffmpeg: Path, image: np.ndarray, picture: Picture, graded: str, effects: list[VideoEffect] | None = None,
    canvas: tuple[int, int] = PORTRAIT.size,
) -> np.ndarray:
    """`image` (RGBA, its whole size) with the part `picture`'s crop keeps graded by the ffmpeg filters
    `graded` (an Overlay's Grade, keeping its alpha: app/grading.py), as the still chain grades it
    after its crop, then drawn through its Video Effects `effects` at the item's own pixels (on the
    plan's `canvas`, at its own size); the rest,
    which isn't drawn, as it was."""
    crop = picture.crop
    cut = np.ascontiguousarray(image[crop.y : crop.y + crop.height, crop.x : crop.x + crop.width])
    filters = ",".join([*filter(None, [graded]), *_effects_at(picture, effects or [], (crop.width, crop.height), canvas=canvas)])
    command = [
        str(ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error",
        "-f", "rawvideo", "-pix_fmt", "rgba", "-s", f"{crop.width}x{crop.height}", "-i", "pipe:0",
        "-vf", filters, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
    ]
    done = subprocess.run(command, input=cut.tobytes(), capture_output=True)
    if done.returncode or len(done.stdout) != cut.nbytes:
        said = (done.stderr.decode(errors="replace").strip() or "no picture").splitlines()[-1]
        raise RuntimeError(f"An image couldn't be graded: {said}")
    graded_image = image.copy()
    graded_image[crop.y : crop.y + crop.height, crop.x : crop.x + crop.width] = np.frombuffer(done.stdout, np.uint8).reshape(cut.shape)
    return graded_image


# How much of its video a Freeze frame reads, of which it shows the first frame: a frame at any rate.
_HELD_READ_SECS = 0.5


class VideoDecode:
    """The frames of a keyed video Overlay's `picture`, from `video` (by `ffmpeg`), one for each of
    the Clip's frames at `fps` (`numbers`) while the Overlay shows, from `start` to `end` seconds
    into the Clip, playing the video as `shown` says (at its Speed): each cropped and flipped as the picture is, no
    larger than it is drawn at its largest over its span (`size`), RGBA. Each is the video's last
    frame at or before the Clip's frame's time, the video's first frame from `shown`'s start at the
    Overlay's start, as the still chain lays a video Overlay over the frames (renderer.py's
    `_overlay`). When the video ends early, its last frame is held, and a held `shown` (a Freeze
    frame's) is its first frame throughout. Each is graded by the ffmpeg filters `graded` (an
    Overlay's Grade, app/grading.py), after it is scaled and flipped, as the still chain grades it,
    then drawn through its Video Effects `effects` (docs/adr/0014) at the size it is sent at (on the
    plan's `canvas`, at its own size), before
    the sampled scale, their time from the Overlay's start. With `looped`, `video` is an image, read
    as a stream of its one picture over the whole span (`shown` unused), so that an effect that
    changes with time moves on it."""

    def __init__(
        self, ffmpeg: Path, video: Path, picture: Picture, start: float, end: float, shown: SegmentTime, fps: float, graded: str = "",
        effects: list[VideoEffect] | None = None, looped: bool = False, canvas: tuple[int, int] = PORTRAIT.size,
    ) -> None:
        self.ffmpeg, self.video, self.picture, self.graded, self.effects = ffmpeg, video, picture, graded, effects or []
        self.canvas = canvas
        self.looped = looped
        self.start, self.end, self.shown, self.fps = start, end, shown, fps
        self.numbers = frame_numbers(start, end, fps)
        # As large as the picture is drawn at its largest, or its crop when it's drawn no smaller:
        # what is sent is no more than what is drawn.
        drawn = [picture_at(picture, number / fps) for number in self.numbers] or [picture]
        crop = picture.crop
        self.size = (min(crop.width, math.ceil(max(at.width for at in drawn))), min(crop.height, math.ceil(max(at.height for at in drawn))))
        self._process: subprocess.Popen[bytes] | None = None

    def frames(self) -> Iterator[np.ndarray]:
        """Each of its frames in turn, in one of two reused arrays: the one after next overwrites it."""
        crop = self.picture.crop
        width, height = self.size
        still = self.shown.hold is not None and not self.looped
        speed = 1 if self.looped else self.shown.speed
        steps = [
            f"setpts=(PTS-STARTPTS)/{speed:.6g}+{self.start:.3f}/TB",
            f"fps={self.fps:.6g}:start_time={self.numbers.start / self.fps:.6f}:round=up",
            f"crop={crop.width}:{crop.height}:{crop.x}:{crop.y}:exact=1",
            *([] if (width, height) == (crop.width, crop.height) else [f"scale={width}:{height}:flags=lanczos"]),
            *["hflip"] * self.picture.flip_h, *["vflip"] * self.picture.flip_v,
            *([self.graded] if self.graded else []),
            *_effects_at(self.picture, self.effects, self.size, Clock(self.start), self.canvas),
            "format=rgba",
        ]
        if self.looped:
            read = ["-loop", "1", "-framerate", f"{self.fps:.6g}", "-t", f"{self.end - self.start:.3f}"]
        else:
            read = ["-ss", f"{self.shown.start:.3f}", "-t", f"{_HELD_READ_SECS if still else self.shown.span:.3f}"]
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", *read, "-i", str(self.video),
            "-an", "-sn", "-dn", "-vf", ",".join(steps), "-frames:v", str(1 if still else len(self.numbers)),
            # Its frames as the steps time them: a frame rate kept by the muxer would fill the time
            # before the first (from 0, when the video has sound) with copies of it.
            "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1",
        ]
        frames = [np.zeros((height, width, 4), np.uint8) for _ in range(2)]
        with tempfile.TemporaryFile() as errors:
            self._process = process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors)
            assert process.stdout is not None
            read = 0
            held = None
            for _ in self.numbers:
                if held is None:
                    frame = frames[read % 2]
                    if _fill(process.stdout, memoryview(frame).cast("B")):
                        read += 1
                        yield frame
                        continue
                    if not read:
                        process.wait()
                        errors.seek(0)
                        # Its last line: the error the render reports is a few lines long at most.
                        said = (errors.read().decode(errors="replace").strip() or "no frames").splitlines()[-1]
                        raise RuntimeError(f"The video {self.video.name} couldn't be decoded: {said}")
                    # It ended early: its last whole frame is held.
                    held = frames[(read - 1) % 2]
                yield held

    def close(self) -> None:
        """End its ffmpeg, if it runs."""
        if self._process is not None:
            if self._process.poll() is None:
                self._process.kill()
            self._process.wait()
            if self._process.stdout is not None:
                self._process.stdout.close()


def _fill(stream, data: memoryview) -> bool:
    """Read `stream` into all of `data`; False when it ends first."""
    while data:
        count = stream.readinto(data)
        if not count:
            return False
        data = data[count:]
    return True


class FrameFeed:
    """One keyed picture's frames from `start` to `end` seconds into the Clip (`frame_numbers` at
    `fps`), drawn by `frames` (each of a video's frames shown to it first, from `video`) and written
    to a pipe, whose reading end (`fd`) ffmpeg is given. Its thread is started once ffmpeg runs;
    `error` is what stopped it, if anything did but ffmpeg going."""

    def __init__(self, frames: PictureFrames, start: float, end: float, fps: float, video: VideoDecode | None = None) -> None:
        self.frames = frames
        self.numbers = frame_numbers(start, end, fps)
        self.fps = fps
        self.video = video
        self.fd, self._write = os.pipe()
        self.error: BaseException | None = None
        self._thread: threading.Thread | None = None

    @property
    def first(self) -> int:
        """The number of the first frame it writes."""
        return self.numbers.start

    def start(self, failed: Callable[[], None]) -> None:
        """Let go of the reading end (ffmpeg has its own) and write the frames; `failed` is called
        when the frames can't be drawn."""
        os.close(self.fd)
        self._thread = threading.Thread(target=self._feed, args=(failed,), name="frame-feed", daemon=True)
        self._thread.start()

    def _feed(self, failed: Callable[[], None]) -> None:
        try:
            shown = iter(self.video.frames()) if self.video is not None else None
            for number in self.numbers:
                if shown is not None:
                    self.frames.show(next(shown))
                data = memoryview(self.frames.draw(number / self.fps)).cast("B")
                while data:
                    data = data[os.write(self._write, data) :]
        except BrokenPipeError:
            # ffmpeg stopped reading: it failed or was stopped, and says why itself.
            pass
        except Exception as exc:
            self.error = exc
            failed()
        finally:
            os.close(self._write)
            if self.video is not None:
                self.video.close()

    def close(self) -> None:
        """Wait for its thread, or let go of both ends when it never started."""
        if self._thread is not None:
            self._thread.join()
            return
        os.close(self.fd)
        os.close(self._write)
