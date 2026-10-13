"""The Renderer: executes a Render Plan with the configured ffmpeg, making a Clip's MP4 and poster.

Each Clip is one encode, a single ffmpeg process that cuts the range (an accurate seek: ffmpeg
decodes from the keyframe before the start and drops what comes before it), crops and scales the
video, normalizes the audio, and writes the poster from the same frames. Before it, an audio-only
pass measures the range's loudness, so that the encode can apply the gain that takes it to −14 LUFS
(loudnorm's two-pass linear mode). One pass would have to adjust the gain as it goes (loudnorm's
dynamic mode), which can pump and lands less exactly on the target; the measurement only decodes
the range's audio, which takes about a second for a 90 s Clip.
"""

import json
import logging
import math
import os
import subprocess
import tempfile
import threading
from collections.abc import Callable
from pathlib import Path

from app.config import RenderTuning
from app.planner import RenderPlan

logger = logging.getLogger(__name__)


class RenderStopped(RuntimeError):
    """The render was cut short because the app is stopping."""


class Renderer:
    def __init__(self, ffmpeg: Path, tuning: RenderTuning) -> None:
        self.ffmpeg = ffmpeg
        self.tuning = tuning
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()
        self._stopping = threading.Event()

    def render(
        self,
        source: Path,
        plan: RenderPlan,
        video: Path,
        poster: Path,
        progress: Callable[[float], None] = lambda done: None,
    ) -> str:
        """Write the Clip that `plan` describes to `video` (MP4, fast start) and its poster to `poster`
        (JPEG), and return the video encoder that made them: the first of RenderTuning.encoders that
        succeeds. `progress` is called with the share of the Clip encoded so far, from 0 to 1.

        Both files are written under temporary names and then renamed, so a Clip that is rendered
        again stays playable until its new files are complete. Raises RenderStopped after `stop()`.
        """
        _check(plan)
        loudness = self._measure(source, plan)
        parts = video.with_name(f".{video.stem}.part{video.suffix}"), poster.with_name(f".{poster.stem}.part{poster.suffix}")
        failures = []
        try:
            for encoder in self.tuning.encoders:
                command = self._command(source, plan, loudness, encoder, *parts)
                stderr = self._run(command, plan.duration, progress)
                if stderr is None and parts[1].is_file():
                    os.replace(parts[0], video)
                    os.replace(parts[1], poster)
                    return encoder
                stderr = stderr or "no poster frame was written"
                logger.warning("Rendering with %s failed: %s", encoder, stderr)
                failures.append(f"{encoder}: {_last_lines(stderr)}")
        finally:
            for part in parts:
                part.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg couldn't render the Clip ({'; '.join(failures)})")

    def stop(self) -> None:
        """Kill the running encode, if any; renders from now on raise RenderStopped."""
        self._stopping.set()
        with self._lock:
            if self._process is not None:
                self._process.kill()

    def _measure(self, source: Path, plan: RenderPlan) -> dict[str, str] | None:
        """loudnorm's measurement of the range's audio; None when it is silent, with nothing to normalize."""
        tuning = self.tuning
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "info",
            *_range(plan), "-i", str(source), "-map", "0:a:0",
            "-af", f"loudnorm=I={tuning.loudness_lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}:print_format=json",
            "-f", "null", "-",
        ]
        result = subprocess.run(command, capture_output=True, text=True, errors="replace")
        output = result.stderr
        if result.returncode or "{" not in output:
            raise RuntimeError(f"ffmpeg couldn't measure the loudness of {source.name}: {_last_lines(output)}")
        measured = json.loads(output[output.rindex("{") : output.rindex("}") + 1])
        return measured if math.isfinite(float(measured["input_i"])) else None

    def _command(
        self, source: Path, plan: RenderPlan, loudness: dict[str, str] | None, encoder: str, video: Path, poster: Path
    ) -> list[str]:
        tuning = self.tuning
        [scene] = plan.scenes
        [panel] = scene.panels
        [at] = panel.path
        area = panel.area
        frame = (
            f"[0:v]crop@p0=w={panel.crop_width}:h={panel.crop_height}:x={at.x}:y={at.y},"
            f"scale={area.width}:{area.height}:flags=lanczos,setsar=1"
        )
        if (area.width, area.height) != (plan.width, plan.height):
            frame += f",pad={plan.width}:{plan.height}:{area.x}:{area.y}:black"
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        frame += f",format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
        audio = f"[0:a:0]aresample={tuning.audio_rate}[a]"
        if loudness is not None:
            audio = (
                f"[0:a:0]loudnorm=I={tuning.loudness_lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}"
                f":measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}"
                f":measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}"
                f":offset={loudness['target_offset']}:linear=true,aresample={tuning.audio_rate}[a]"
            )
        if encoder == "libx264":
            codec = [
                "-c:v", "libx264", "-preset", tuning.x264_preset, "-crf", str(tuning.x264_crf),
                "-maxrate", tuning.x264_maxrate, "-bufsize", tuning.x264_maxrate,
            ]
        else:
            codec = ["-c:v", encoder, "-b:v", tuning.bitrate if plan.fps <= 30 else tuning.high_fps_bitrate]
        return [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y", "-progress", "pipe:1",
            *_range(plan), "-i", str(source),
            "-filter_complex", f"{frame};{audio}",
            "-map", "[v]", "-map", "[a]", "-map_metadata", "-1", "-map_chapters", "-1",
            *codec, "-profile:v", "high", "-g", str(max(1, round(plan.fps * tuning.keyframe_secs))),
            "-c:a", "aac", "-b:a", tuning.audio_bitrate,
            "-movflags", "+faststart", "-f", "mp4", str(video),
            "-map", "[poster]", "-frames:v", "1", "-q:v", "3", "-f", "image2", "-update", "1", str(poster),
        ]

    def _run(self, command: list[str], duration: float, progress: Callable[[float], None]) -> str | None:
        """Run an encode, reporting its progress; None when it succeeds, else what ffmpeg said."""
        with tempfile.TemporaryFile() as errors:
            with self._lock:
                if self._stopping.is_set():
                    raise RenderStopped("The app is stopping")
                process = self._process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True)
            try:
                assert process.stdout is not None
                for line in process.stdout:
                    key, _, value = line.strip().partition("=")
                    if key == "out_time_us" and value.isdigit():
                        progress(min(1.0, int(value) / 1e6 / duration))
                process.wait()
            finally:
                with self._lock:
                    self._process = None
            if self._stopping.is_set():
                raise RenderStopped("The app is stopping")
            if process.returncode == 0:
                return None
            errors.seek(0)
            return errors.read().decode(errors="replace").strip() or f"exit code {process.returncode}"


def _check(plan: RenderPlan) -> None:
    """Refuse what the Render Plan can hold but the Renderer doesn't draw yet (tickets 13–16)."""
    if len(plan.scenes) != 1 or len(plan.scenes[0].panels) != 1 or len(plan.scenes[0].panels[0].path) != 1:
        raise ValueError("The Renderer draws one scene with one static panel so far")
    if plan.captions or plan.hook:
        raise ValueError("The Renderer doesn't burn captions or the hook yet")


def _range(plan: RenderPlan) -> list[str]:
    """Input options that read just the Clip's range of the Source."""
    return ["-ss", f"{plan.start:.3f}", "-t", f"{plan.duration:.3f}"]


def _last_lines(text: str, count: int = 3) -> str:
    return " ".join(text.strip().splitlines()[-count:])
