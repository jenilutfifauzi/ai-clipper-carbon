"""The frame process (docs/adr/0008-keyframes-for-pictures-and-sound.md): a keyed picture drawn for
every output frame of its span with OpenCV, into a transparent 1080×1920 RGBA frame, and written raw
to a pipe that ffmpeg reads as one of its inputs and lays over the Clip at 0, 0 (app/renderer.py).

For each frame, at its time n / fps of the Clip (`frame_numbers`), the picture's tracks are sampled
by the rule the preview samples them by (`picture_at`, app/keyframes.py), and `PictureFrames.draw`:
- takes the part of its cropped, flipped item that is on the frame (and a little round it), scaled
  to its sampled size (area resampling when it shrinks, bilinear when it grows), so a picture zoomed
  far past the frame costs no more than one on it;
- gives it 2 px of transparent margin, its colour copied from its edge, so that the turn's
  interpolation fades its edge out rather than into black;
- turns it about its sampled centre, placed in fractions of a pixel, into only the box that holds
  it on the frame, the rest of the reused frame cleared where it was drawn the frame before;
- multiplies its alpha by the sampled opacity.

The alpha is straight: ffmpeg's overlay of a premultiplied picture over yuv420p darkens it.

`FrameFeed` writes one picture's frames to its pipe from a thread of its own, so that ffmpeg, reading
every input as it needs it, never waits on another. A feed whose ffmpeg has gone (failed or stopped)
stops at its next write.
"""

import math
import os
import threading
from collections.abc import Callable

import cv2
import numpy as np

from app.planner import FRAME, Picture, picture_at

# The transparent margin round a picture before it is turned, in output pixels.
MARGIN = 2


def frame_numbers(start: float, end: float, fps: float) -> range:
    """The numbers n of the Clip's frames, at n / `fps` seconds into it, from `start` until `end`."""
    return range(math.ceil(start * fps - 1e-6), math.ceil(end * fps - 1e-6))


class PictureFrames:
    """The frames of one keyed `picture` of an item whose pixels are `image` (RGBA, its whole size),
    each drawn into one reused frame of the output's size."""

    def __init__(self, picture: Picture, image: np.ndarray, frame: tuple[int, int] = FRAME) -> None:
        self.picture = picture
        crop = picture.crop
        cut = image[crop.y : crop.y + crop.height, crop.x : crop.x + crop.width]
        if picture.flip_h:
            cut = cut[:, ::-1]
        if picture.flip_v:
            cut = cut[::-1]
        self.source = np.ascontiguousarray(cut)
        self.canvas = np.zeros((frame[1], frame[0], 4), np.uint8)
        # Where the frame before drew, cleared before the next is drawn.
        self.drawn: tuple[int, int, int, int] | None = None
        # The last part scaled, and what it was scaled from and to.
        self.scaled: tuple[tuple[int, ...], np.ndarray] | None = None

    def draw(self, time: float) -> np.ndarray:
        """The frame at `time` seconds into the Clip: the picture as sampled there, over transparency."""
        if self.drawn is not None:
            x0, y0, x1, y1 = self.drawn
            self.canvas[y0:y1, x0:x1] = 0
            self.drawn = None
        at = picture_at(self.picture, time)
        if at.opacity <= 0 or at.width < 0.5 or at.height < 0.5:
            return self.canvas
        frame_width, frame_height = self.canvas.shape[1], self.canvas.shape[0]
        angle = math.radians(at.rotation)
        cos, sin = math.cos(angle), math.sin(angle)
        cx, cy = at.centre
        width, height = float(at.width), float(at.height)

        # What of the picture (in its drawn pixels, from its top-left corner) is on the frame.
        corners = [(0, 0), (frame_width, 0), (0, frame_height), (frame_width, frame_height)]
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
        x0, y0 = max(math.floor(placed[:, 0].min()), 0), max(math.floor(placed[:, 1].min()), 0)
        x1, y1 = min(math.ceil(placed[:, 0].max()), frame_width), min(math.ceil(placed[:, 1].max()), frame_height)
        if x1 <= x0 or y1 <= y0:
            return self.canvas
        matrix[:, 2] -= (x0, y0)
        box = cv2.warpAffine(padded, matrix, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0))
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


class FrameFeed:
    """One keyed picture's frames from `start` to `end` seconds into the Clip (`frame_numbers` at
    `fps`), drawn by `frames` and written to a pipe, whose reading end (`fd`) ffmpeg is given. Its
    thread is started once ffmpeg runs; `error` is what stopped it, if anything did but ffmpeg going."""

    def __init__(self, frames: PictureFrames, start: float, end: float, fps: float) -> None:
        self.frames = frames
        self.numbers = frame_numbers(start, end, fps)
        self.fps = fps
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
            for number in self.numbers:
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

    def close(self) -> None:
        """Wait for its thread, or let go of both ends when it never started."""
        if self._thread is not None:
            self._thread.join()
            return
        os.close(self.fd)
        os.close(self._write)
