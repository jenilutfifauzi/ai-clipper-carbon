"""Mattes (GLOSSARY.md, Matte; docs/adr/0015-background-removal-reads-a-cached-matte.md): the subject's
mask of every frame of a video, made by the person model on this Mac, which Background removal reads.

A Matte is kept in pieces of PIECE_SECS seconds aligned to its item's own timeline (the Source's, for
now), beside the item, in `jobs/<id>/mattes/`, each named by its subject, its matter's version and its
start in seconds: `person-rvm-mnv3-2-20.mp4` holds 20..30 s. A piece is a grayscale video (H.264,
yuv420p, so that a browser plays it for the preview) no larger than MATTE_SIDE on its long edge, at
its item's frame rate, one Matte frame per frame of the item; its last is cut where the item ends.
White keeps the picture, black takes it away. Every Segment, Candidate and trim showing that time
reads the same pieces. A piece is written under a temporary name and renamed when complete, so a
piece cut short is never taken for one. A piece that couldn't be made leaves its failure beside it
(`.failed`, the message), remembered until a Retry, which fails the render of a Clip that needs it.

The model sits behind the matter seam (`Matter`): frames at the Matte's size in, alpha frames out,
with its recurrent state kept across a run. The real one, `RvmMatter`, runs Robust Video Matting's
MobileNetV3 through onnxruntime on the CPU (CoreML's default conversion of it is wrong: ADR 0015's
Consequences). Each piece's run starts WARM_UP_SECS before
the piece (from the item's start for the first), so that the recurrent state has settled, and the
warm-up's frames are dropped. The frames come from an ffmpeg decoding the item at the Matte's size,
and the Matte is written by another.

The editor's pieces are made by the `MatteRunner`, one at a time, outside the Worker, its ffmpegs at
low priority, latest request first (a request's own pieces in order), with their progress kept for
the editor to poll; a save that switches Background removal on or changes a range asks for them. A
render makes the pieces it still lacks itself, in the Worker (`MatteRunner.make`), one at a time with
the runner.
"""

import math
import os
import subprocess
import tempfile
import threading
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from fractions import Fraction
from pathlib import Path
from typing import ClassVar, Protocol

import numpy as np

from app.candidates import Subject
from app.person_model import PersonModel

MATTES_DIR = "mattes"
# A piece's length, on its item's timeline, and how long before its start each piece's run starts.
PIECE_SECS = 10
WARM_UP_SECS = 1.0
# The longest side of a Matte's frames (and of the frames the model is given).
MATTE_SIDE = 1280
# The longest side RVM works on inside (its `downsample_ratio`): its README's choice for HD video.
RVM_INNER_SIDE = 480
# A piece has a keyframe each second, so that the preview's seeks in it are quick.
_ENCODE = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", "-force_key_frames", "expr:gte(t,n_forced)"]


class Matter(Protocol):
    """The matter seam: the person model, loaded from its file. `version` names what it makes, so
    that a Matte made by another model (or another version of it) is never read for this one."""

    version: ClassVar[str]

    def __init__(self, model: Path) -> None: ...

    def run(self) -> Callable[[np.ndarray], np.ndarray]:
        """A run with fresh recurrent state: called with each frame in turn (RGB, H×W×3 uint8), it gives
        the frame's alpha (H×W uint8: 255 keeps, 0 takes away)."""
        ...


class RvmMatter:
    """Robust Video Matting's MobileNetV3 (app/person_model.py's file), through onnxruntime on the CPU.

    Not CoreML (measured in .scratch/background-removal/issues/09, ADR 0015): its default conversion
    (NeuralNetwork) of this model, dynamic in shape, gives a wrong Matte (blobby, keeping chairs and
    tables) on any compute unit; its MLProgram one is right but slower than the CPU. Fixing the inputs'
    shapes and the downsample ratio in the graph made MLProgram about 2.5× faster than the CPU with
    the same Matte, but needs the `onnx` package to rewrite the model: a follow-up.
    `version` 2: Mattes made by 1 (CoreML ahead of the CPU) are never read."""

    version: ClassVar[str] = "rvm-mnv3-2"

    def __init__(self, model: Path) -> None:
        import onnxruntime

        self.session = onnxruntime.InferenceSession(str(model), providers=["CPUExecutionProvider"])

    def run(self) -> Callable[[np.ndarray], np.ndarray]:
        state = {name: np.zeros((1, 1, 1, 1), np.float32) for name in ("r1i", "r2i", "r3i", "r4i")}
        outputs = [output.name for output in self.session.get_outputs()]

        def alpha(frame: np.ndarray) -> np.ndarray:
            height, width = frame.shape[:2]
            source = (frame.astype(np.float32) / 255).transpose(2, 0, 1)[None]
            ratio = np.array([min(1.0, RVM_INNER_SIDE / max(width, height))], np.float32)
            found = dict(zip(outputs, self.session.run(None, {"src": source, **state, "downsample_ratio": ratio})))
            state.update({f"r{i}i": found[f"r{i}o"] for i in range(1, 5)})
            return np.clip(np.rint(found["pha"][0, 0] * 255), 0, 255).astype(np.uint8)

        return alpha


class PieceState(StrEnum):
    READY = "ready"
    MAKING = "making"
    QUEUED = "queued"
    MISSING = "missing"
    FAILED = "failed"


def matte_pieces(start: float, end: float, duration: float) -> list[int]:
    """The starts of the pieces of a Matte of an item `duration` seconds long that hold its time from
    `start` to `end` (a held frame's: from its frame, a moment)."""
    end = min(max(end, start + 1e-3), duration)
    first = int(start // PIECE_SECS) * PIECE_SECS
    return [piece for piece in range(first, math.ceil(round(end, 6)), PIECE_SECS) if piece < duration]


def matte_frame(source: float, fps: float) -> tuple[int, int]:
    """Which piece of a Matte (its start) holds the item's frame at `source` seconds, `fps` frames a
    second, and which of the piece's frames it is: the item's frame `round(source × fps)` (a half
    rounded up), in the piece whose first frame is `round(piece × fps)`, as `Mattes.frames` counts a
    piece's. The preview finds a Matte frame by the same rule (frontend/src/pages/job/editor/
    matteTime.ts); both are tested on tests/fixtures/matte_frames.json."""
    index = math.floor(source * fps + 0.5)
    piece = int(index / fps // PIECE_SECS) * PIECE_SECS
    # A piece's first frame is rounded, so a frame near its start may be the piece before's or after's.
    while piece > 0 and index < round(piece * fps):
        piece -= PIECE_SECS
    while index >= round((piece + PIECE_SECS) * fps):
        piece += PIECE_SECS
    return piece, index - round(piece * fps)


class Mattes:
    """The Matte pieces of one item (the Source), in `folder`, made from its `video`, whose picture is
    `frame` (width, height, frames a second), `duration` seconds long."""

    def __init__(self, folder: Path, video: Path, frame: tuple[int, int, float], duration: float) -> None:
        self.folder = folder
        self.video = video
        self.frame = frame
        self.duration = duration

    def size(self) -> tuple[int, int]:
        """The Matte's frames' width and height: the item's, no larger than MATTE_SIDE on the long
        edge, even."""
        width, height, _ = self.frame
        scale = min(1.0, MATTE_SIDE / max(width, height))
        return max(2, 2 * round(width * scale / 2)), max(2, 2 * round(height * scale / 2))

    def path(self, subject: Subject, version: str, piece: int) -> Path:
        return self.folder / f"{subject}-{version}-{piece}.mp4"

    def failure(self, subject: Subject, version: str, piece: int) -> str | None:
        """Why the piece couldn't be made, until a Retry; None when it hasn't failed."""
        failed = self.path(subject, version, piece).with_suffix(".failed")
        try:
            return failed.read_text()
        except OSError:
            return None

    def retry(self, subject: Subject, version: str, pieces: Iterable[int]) -> None:
        """Forget the pieces' failures, so that they are made again."""
        for piece in pieces:
            self.path(subject, version, piece).with_suffix(".failed").unlink(missing_ok=True)

    def frames(self, piece: int) -> tuple[int, int]:
        """How many frames the piece from `piece` holds, and how many warm-up frames its run starts with."""
        fps = self.frame[2]
        start, end = piece, min(piece + PIECE_SECS, self.duration)
        warm = max(0.0, start - WARM_UP_SECS)
        return max(1, round(end * fps) - round(start * fps)), round(start * fps) - round(warm * fps)

    def make(
        self, ffmpeg: Path, matter: Matter, subject: Subject, piece: int, progress: Callable[[float], None] = lambda done: None, nice: bool = False
    ) -> Path:
        """The piece from `piece`, made now by `matter` if it isn't there, its `progress` reported from 0
        to 1. A failure is remembered beside it (`failure`) and raised as a RuntimeError."""
        target = self.path(subject, matter.version, piece)
        if target.is_file():
            return target
        try:
            self._made(ffmpeg, matter, piece, target, progress, nice)
        except Exception as exc:
            message = str(exc) or type(exc).__name__
            target.parent.mkdir(parents=True, exist_ok=True)
            target.with_suffix(".failed").write_text(message)
            raise RuntimeError(message) from exc
        return target

    def _made(self, ffmpeg: Path, matter: Matter, piece: int, target: Path, progress: Callable[[float], None], nice: bool) -> None:
        width, height = self.size()
        fps = self.frame[2]
        count, warm = self.frames(piece)
        start = max(0.0, piece - WARM_UP_SECS)
        end = min(piece + PIECE_SECS, self.duration)
        target.parent.mkdir(parents=True, exist_ok=True)
        part = target.with_name(f".{target.stem}.{uuid.uuid4().hex}.part.mp4")
        run = ["nice", "-n", "10"] if nice else []
        base = [str(ffmpeg), "-hide_banner", "-nostdin", "-v", "error", "-y"]
        decode = [
            *run, *base, "-ss", f"{start:.6f}", "-t", f"{end - start:.6f}", "-i", str(self.video), "-map", "0:v:0",
            "-vf", f"scale={width}:{height},format=rgb24", "-fps_mode", "passthrough", "-f", "rawvideo", "pipe:1",
        ]
        rate = Fraction(fps).limit_denominator(1001)
        encode = [
            *run, *base, "-f", "rawvideo", "-pixel_format", "gray", "-video_size", f"{width}x{height}", "-framerate", str(rate),
            "-i", "pipe:0", *_ENCODE, "-movflags", "+faststart", "-f", "mp4", str(part),
        ]
        alpha = matter.run()
        size = width * height * 3
        with tempfile.TemporaryFile() as decode_errors, tempfile.TemporaryFile() as encode_errors:
            decoder = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=decode_errors)
            encoder = subprocess.Popen(encode, stdin=subprocess.PIPE, stderr=encode_errors)
            assert decoder.stdout is not None and encoder.stdin is not None
            read = written = 0
            last = np.zeros((height, width), np.uint8)
            try:
                while written < count and len(data := decoder.stdout.read(size)) == size:
                    last = alpha(np.frombuffer(data, np.uint8).reshape(height, width, 3))
                    read += 1
                    if read > warm:
                        encoder.stdin.write(last.tobytes())
                        written += 1
                        progress(written / (count + 1))
                # A piece holds one frame per frame of its item: one cut short at the item's end (its
                # last frame a little shorter than its rate) has its last Matte frame held.
                for _ in range(count - written):
                    encoder.stdin.write(last.tobytes())
                encoder.stdin.close()
                encoder.wait()
            finally:
                decoder.kill()
                decoder.wait()
                if encoder.poll() is None:
                    encoder.kill()
                    encoder.wait()
            if encoder.returncode:
                encode_errors.seek(0)
                part.unlink(missing_ok=True)
                raise RuntimeError(f"ffmpeg couldn't write the Matte: {_last_line(encode_errors.read())}")
            if not read:
                decode_errors.seek(0)
                part.unlink(missing_ok=True)
                raise RuntimeError(f"ffmpeg couldn't read {self.video.name} at {start:g} s: {_last_line(decode_errors.read())}")
        os.replace(part, target)
        progress(1.0)


@dataclass(frozen=True)
class MatteStatus:
    """How the Matte of a range is coming along: `state` "ready" (every piece there), "making" (some
    queued or being made), "waiting" (for the person model), "failed" (a piece, with its `error`,
    until a Retry) or "missing" (not asked for); its `progress` from 0 to 1 over its pieces."""

    state: str
    progress: float
    error: str | None = None


class ModelAbsent(RuntimeError):
    """The person model isn't downloaded (or isn't offered), so no Matte can be made."""


class MatteRunner:
    """The app's Matte maker: the pieces the editor asks for, one at a time, in a thread of its own,
    latest request first; and those a render needs, made in its thread. The model is the person
    model's file (`model`, None where it isn't offered) loaded by `matter`; `ffmpeg` decodes and
    encodes."""

    def __init__(self, model: PersonModel | None, matter: type[Matter], ffmpeg: Path) -> None:
        self.model = model
        self.matter = matter
        self.ffmpeg = ffmpeg
        self._loaded: Matter | None = None
        self._changed = threading.Condition()
        # Requests waiting, latest last: each its pieces, in order.
        self._requests: list[list[tuple[Mattes, Subject, int]]] = []
        # The piece the runner is making, and how far it has got.
        self._making: tuple[Path, float] | None = None
        self._thread: threading.Thread | None = None
        # One piece made at a time, by the runner or a render.
        self._one = threading.Lock()

    @property
    def version(self) -> str:
        return self.matter.version

    def ready(self) -> bool:
        """Whether the person model is downloaded, so that pieces can be made."""
        return self.model is not None and self.model.installed

    def state(self, mattes: Mattes, subject: Subject, piece: int) -> tuple[PieceState, float, str | None]:
        """The piece's state, with its progress from 0 to 1 and a failed one's message."""
        if mattes.path(subject, self.version, piece).is_file():
            return PieceState.READY, 1.0, None
        if (failure := mattes.failure(subject, self.version, piece)) is not None:
            return PieceState.FAILED, 0.0, failure
        target = mattes.path(subject, self.version, piece)
        with self._changed:
            if self._making is not None and self._making[0] == target:
                return PieceState.MAKING, self._making[1], None
            if any(m.path(s, self.version, p) == target for request in self._requests for m, s, p in request):
                return PieceState.QUEUED, 0.0, None
        return PieceState.MISSING, 0.0, None

    def status(self, wanted: Iterable[tuple[Mattes, Subject, int]]) -> MatteStatus:
        """How the pieces `wanted` are coming along together."""
        states = [self.state(*piece) for piece in wanted]
        if not states:
            return MatteStatus("ready", 1.0)
        progress = round(sum(done for _, done, _ in states) / len(states), 3)
        if failed := next((error for state, _, error in states if state is PieceState.FAILED), None):
            return MatteStatus("failed", progress, failed)
        if all(state is PieceState.READY for state, _, _ in states):
            return MatteStatus("ready", 1.0)
        if any(state in (PieceState.MAKING, PieceState.QUEUED) for state, _, _ in states):
            return MatteStatus("making", progress)
        return MatteStatus("missing" if self.ready() else "waiting", progress)

    def ask(self, wanted: Iterable[tuple[Mattes, Subject, int]]) -> None:
        """Queue the pieces `wanted` that are missing (not there, not failed, not being made) as the
        latest request, ahead of those asked for before (which lose them). Nothing waits for the person
        model: it is asked again once there is one."""
        if not self.ready():
            return
        missing = [piece for piece in wanted if self.state(*piece)[0] in (PieceState.MISSING, PieceState.QUEUED)]
        if not missing:
            return
        targets = {mattes.path(subject, self.version, piece) for mattes, subject, piece in missing}
        with self._changed:
            kept = [[p for p in request if p[0].path(p[1], self.version, p[2]) not in targets] for request in self._requests]
            self._requests = [request for request in kept if request] + [missing]
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="mattes", daemon=True)
                self._thread.start()
            self._changed.notify_all()

    def retry(self, wanted: Iterable[tuple[Mattes, Subject, int]]) -> None:
        """Forget the failures of the pieces `wanted`, and ask for them again."""
        wanted = list(wanted)
        for mattes, subject, piece in wanted:
            mattes.retry(subject, self.version, [piece])
        self.ask(wanted)

    def make(self, wanted: Iterable[tuple[Mattes, Subject, int]], progress: Callable[[float], None] = lambda done: None) -> list[Path]:
        """The pieces `wanted`, in order, made now in this thread where they aren't there (a render's,
        in the Worker), one at a time with the runner, `progress` reported from 0 to 1 over those made.
        ModelAbsent without the person model; a RuntimeError with the message of a piece that fails,
        now or before a Retry."""
        wanted = list(wanted)
        missing = [p for p in wanted if not p[0].path(p[1], self.version, p[2]).is_file()]
        for i, (mattes, subject, piece) in enumerate(missing):
            if (failure := mattes.failure(subject, self.version, piece)) is not None:
                raise RuntimeError(failure)
            with self._one:
                matter = self._matter()
                mattes.make(self.ffmpeg, matter, subject, piece, lambda done, i=i: progress((i + done) / len(missing)))
        progress(1.0)
        return [mattes.path(subject, self.version, piece) for mattes, subject, piece in wanted]

    def _matter(self) -> Matter:
        """The model, loaded once. ModelAbsent without its file."""
        if self.model is None or not self.model.installed:
            self._loaded = None
            raise ModelAbsent("the person model isn't downloaded: download it in the Inspector's Remove background section")
        if self._loaded is None:
            self._loaded = self.matter(self.model.path)
        return self._loaded

    def _run(self) -> None:
        """Make the pieces asked for, latest request first, until none is left."""
        while True:
            with self._changed:
                while self._requests and not self._requests[-1]:
                    self._requests.pop()
                if not self._requests:
                    self._thread = None
                    return
                mattes, subject, piece = self._requests[-1].pop(0)
                target = mattes.path(subject, self.version, piece)
                self._making = (target, 0.0)

            def report(done: float) -> None:
                with self._changed:
                    if self._making is not None and self._making[0] == target:
                        self._making = (target, round(done, 3))

            try:
                with self._one:
                    if not target.is_file() and mattes.failure(subject, self.version, piece) is None:
                        mattes.make(self.ffmpeg, self._matter(), subject, piece, report, nice=True)
            except ModelAbsent:
                # Removed meanwhile: what was asked waits for it again.
                with self._changed:
                    self._requests.clear()
            except Exception:
                # Remembered beside the piece (`Mattes.make`) until a Retry.
                pass
            finally:
                with self._changed:
                    self._making = None


def _last_line(errors: bytes) -> str:
    lines = errors.decode(errors="replace").strip().splitlines()
    return lines[-1] if lines else "no message"
