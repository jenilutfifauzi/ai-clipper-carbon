"""Clip analysis: what the Render Planner needs to know about a Clip's range of the Source, found
with the configured ffmpeg and MediaPipe before planning.

- The Scene Detector runs ffmpeg's scene-change filter (scdet) over the range and returns its Scenes.
- The Face Detector runs MediaPipe's Face Detector (BlazeFace short-range, on the CPU) on every
  third frame of the range, decoded by ffmpeg at 640 px wide and read from a pipe one frame at a
  time, so that a long Clip never sits in memory.

The two are separate passes: decoding is fast (about 1.3 s for 27 s of 1080p), and keeping them apart
keeps each simple. A Clip's analysis is saved with its Job and reused while the Clip's range and the
AnalysisTuning stay the same (see `analysis_file`), so rendering again after a hook or layout edit
doesn't analyse again.
"""

import re
import subprocess
import tempfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.config import AnalysisTuning
from app.planner import Face, FrameFaces, Scene
from app.renderer import RenderStopped
from app.video_source import SourceMetadata

ANALYSIS_DIR = "analysis"

_SCENE_CUT = re.compile(r"lavfi\.scd\.time:\s*([\d.]+)")


@dataclass(frozen=True)
class ClipAnalysis:
    # The Clip's range on the Source's timeline, and the tuning it was analysed with.
    start: float
    end: float
    tuning: AnalysisTuning
    # Back to back, covering the Clip from 0 to its duration.
    scenes: list[Scene]
    # Every sampled frame in time order, with or without faces.
    frames: list[FrameFaces]


def analysis_file(start: float, end: float) -> str:
    """The cached analysis of the Clip from `start` to `end` on the Source, relative to the Job's directory."""
    return f"{ANALYSIS_DIR}/{round(start * 1000)}-{round(end * 1000)}.json"


class Analyzer:
    def __init__(self, ffmpeg: Path, model: Path, tuning: AnalysisTuning) -> None:
        self.ffmpeg = ffmpeg
        self.model = model
        self.tuning = tuning
        self._process: subprocess.Popen[bytes] | None = None
        self._lock = threading.Lock()
        self._stopping = threading.Event()

    def analyze(
        self,
        source: Path,
        metadata: SourceMetadata,
        start: float,
        end: float,
        progress: Callable[[float], None] = lambda done: None,
    ) -> ClipAnalysis:
        """The Scenes and faces of `source` from `start` to `end` seconds. `progress` is called with
        the share of the face search done so far. Raises RenderStopped after `stop()`."""
        duration = round(end - start, 3)
        scenes = self.detect_scenes(source, start, duration)
        frames = self.detect_faces(source, metadata, start, duration, progress)
        return ClipAnalysis(start, end, self.tuning, scenes, frames)

    def stop(self) -> None:
        """Kill the running ffmpeg, if any; analyses from now on raise RenderStopped."""
        self._stopping.set()
        with self._lock:
            if self._process is not None:
                self._process.kill()

    def detect_scenes(self, source: Path, start: float, duration: float) -> list[Scene]:
        """The Scene Detector: the shots of the range, split where scdet reports a scene change."""
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "info",
            *_range(start, duration), "-i", str(source), "-an", "-sn", "-dn",
            "-vf", f"scdet=threshold={self.tuning.scene_threshold}", "-f", "null", "-",
        ]
        with tempfile.TemporaryFile() as errors:
            self._run(command, stdout=subprocess.DEVNULL, stderr=errors, read=lambda process: None)
            errors.seek(0)
            output = errors.read().decode(errors="replace")
        cuts = sorted({round(float(at), 3) for at in _SCENE_CUT.findall(output)} - {0.0})
        edges = [0.0, *(cut for cut in cuts if cut < duration), duration]
        return [Scene(a, b) for a, b in zip(edges, edges[1:])]

    def detect_faces(
        self,
        source: Path,
        metadata: SourceMetadata,
        start: float,
        duration: float,
        progress: Callable[[float], None] = lambda done: None,
    ) -> list[FrameFaces]:
        """The Face Detector: the faces in every face_step-th frame of the range, from its first."""
        # Imported here: MediaPipe takes a moment to load, and only rendering needs it.
        import mediapipe as mp
        from mediapipe.tasks.python.core.base_options import BaseOptions
        from mediapipe.tasks.python.vision import FaceDetector, FaceDetectorOptions, RunningMode

        tuning = self.tuning
        width = min(tuning.face_width, metadata.width) // 2 * 2
        height = max(2, round(metadata.height * width / metadata.width / 2) * 2)
        frame_bytes = width * height * 3
        scale_x, scale_y = metadata.width / width, metadata.height / height
        step_secs = tuning.face_step / metadata.fps
        expected = max(1.0, duration / step_secs)
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error",
            *_range(start, duration), "-i", str(source), "-an", "-sn", "-dn",
            "-vf", f"framestep={tuning.face_step},scale={width}:{height}",
            "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1",
        ]
        options = FaceDetectorOptions(
            base_options=BaseOptions(model_asset_path=str(self.model), delegate=BaseOptions.Delegate.CPU),
            running_mode=RunningMode.VIDEO,
            min_detection_confidence=tuning.face_confidence,
        )
        frames: list[FrameFaces] = []

        def read(process: subprocess.Popen[bytes]) -> None:
            assert process.stdout is not None
            with FaceDetector.create_from_options(options) as detector:
                while len(data := process.stdout.read(frame_bytes)) == frame_bytes:
                    at = round(len(frames) * step_secs, 3)
                    pixels = np.frombuffer(data, dtype=np.uint8).reshape(height, width, 3)
                    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=pixels)
                    result = detector.detect_for_video(image, round(at * 1000))
                    faces = []
                    for detection in result.detections:
                        box = detection.bounding_box
                        x0, y0 = max(0.0, box.origin_x * scale_x), max(0.0, box.origin_y * scale_y)
                        x1 = min(float(metadata.width), (box.origin_x + box.width) * scale_x)
                        y1 = min(float(metadata.height), (box.origin_y + box.height) * scale_y)
                        if x1 > x0 and y1 > y0:
                            score = detection.categories[0].score if detection.categories else 0.0
                            box = (round(x0, 1), round(y0, 1), round(x1 - x0, 1), round(y1 - y0, 1))
                            faces.append(Face(*box, round(score, 3)))
                    frames.append(FrameFaces(at, faces))
                    progress(min(1.0, len(frames) / expected))

        with tempfile.TemporaryFile() as errors:
            self._run(command, stdout=subprocess.PIPE, stderr=errors, read=read)
        return frames

    def _run(self, command: list[str], stdout, stderr, read: Callable[[subprocess.Popen[bytes]], None]) -> None:
        """Run ffmpeg, handing it to `read` while it runs; raise if it fails or is stopped."""
        with self._lock:
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping")
            process = self._process = subprocess.Popen(command, stdout=stdout, stderr=stderr)
        try:
            read(process)
            process.wait()
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            with self._lock:
                self._process = None
        if self._stopping.is_set():
            raise RenderStopped("The app is stopping")
        if process.returncode:
            stderr.seek(0)
            said = stderr.read().decode(errors="replace").strip().splitlines()[-3:]
            raise RuntimeError(f"ffmpeg couldn't analyse the Clip: {' '.join(said) or f'exit code {process.returncode}'}")


def _range(start: float, duration: float) -> list[str]:
    return ["-ss", f"{start:.3f}", "-t", f"{duration:.3f}"]
