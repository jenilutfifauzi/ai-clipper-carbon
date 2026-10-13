"""The Renderer: executes a Render Plan with the configured ffmpeg, making a Clip's MP4 and poster.

Each Clip is one encode, a single ffmpeg process that cuts the range (an accurate seek: ffmpeg
decodes from the keyframe before the start and drops what comes before it), draws each Scene in its
Layout, normalizes the audio, and writes the poster from the same frames. Before it, an audio-only
pass measures the range's loudness, so that the encode can apply the gain that takes it to −14 LUFS
(loudnorm's two-pass linear mode). One pass would have to adjust the gain as it goes (loudnorm's
dynamic mode), which can pump and lands less exactly on the target; the measurement only decodes
the range's audio, which takes about a second for a 90 s Clip.

The decoded video is split into one branch per Scene, each trimmed to its Scene and drawn there:
every panel is a crop of the frame, moved at its change points by commands that ffmpeg sends it
as the frames go by, scaled into the panel's area (and blurred for Blur's background), and the
panels are laid over one another. The branches are then joined back to back (concat), so each
frame is drawn once, in its own Scene's Layout. The audio isn't cut: it runs on unchanged.
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
from app.planner import Panel, RenderPlan, ScenePlan

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
        frame = _scenes(plan, tuning)
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        frame += f";[frame]format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
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
    """Refuse what the Render Plan can hold but the Renderer doesn't draw yet (tickets 15–16)."""
    if not plan.scenes or not all(scene.panels for scene in plan.scenes):
        raise ValueError("A Render Plan needs at least one scene, each with at least one panel")
    if plan.captions or plan.hook:
        raise ValueError("The Renderer doesn't burn captions or the hook yet")


def _scenes(plan: RenderPlan, tuning: RenderTuning) -> str:
    """The filtergraph that draws the plan's Scenes from [0:v] into [frame]. With several, the video
    is split into a branch per Scene, trimmed to it from half a frame before its first frame (so that
    rounding can't move a frame across a cut) and restarted at 0 s, and the branches are concatenated."""
    if len(plan.scenes) == 1:
        return _scene(plan, plan.scenes[0], "s0", "[0:v]", "[frame]", tuning)
    count = len(plan.scenes)
    chains = [f"[0:v]split={count}" + "".join(f"[s{i}]" for i in range(count))]
    for i, scene in enumerate(plan.scenes):
        bounds = []
        if i > 0:
            bounds.append(f"start={scene.start - 0.5 / plan.fps:.4f}")
        if i < count - 1:
            bounds.append(f"end={scene.end - 0.5 / plan.fps:.4f}")
        chains.append(_scene(plan, scene, f"s{i}", f"[s{i}]trim={':'.join(bounds)},setpts=PTS-STARTPTS,", f"[v{i}]", tuning))
    chains.append("".join(f"[v{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0[frame]")
    return ";".join(chains)


def _scene(plan: RenderPlan, scene: ScenePlan, name: str, given: str, out: str, tuning: RenderTuning) -> str:
    """Filters that draw `scene` from the frames `given` (a link label, then any filters to start
    with) into the link `out`: its first panel, padded to the frame unless it fills it, then each
    other panel laid over it in its area."""
    panels = scene.panels
    if len(panels) == 1:
        chains = [f"{given}{_panel(plan, scene, f'{name}p0', panels[0], tuning)}{_pad(plan, panels[0])}{out}"]
    else:
        copies = "".join(f"[{name}c{j}]" for j in range(len(panels)))
        chains = [f"{given}split={len(panels)}{copies}"]
        below = f"[{name}l0]"
        chains.append(f"[{name}c0]{_panel(plan, scene, f'{name}p0', panels[0], tuning)}{_pad(plan, panels[0])}{below}")
        for j, panel in enumerate(panels[1:], 1):
            chains.append(f"[{name}c{j}]{_panel(plan, scene, f'{name}p{j}', panel, tuning)}[{name}d{j}]")
            above = out if j == len(panels) - 1 else f"[{name}l{j}]"
            chains.append(f"{below}[{name}d{j}]overlay={panel.area.x}:{panel.area.y}{above}")
            below = above
    return ";".join(chains)


def _panel(plan: RenderPlan, scene: ScenePlan, name: str, panel: Panel, tuning: RenderTuning) -> str:
    """Filters that crop the panel from the frame, as `crop@<name>`, and scale it into its area."""
    first, *moves = panel.path
    # The crop moves at its change points through commands that ffmpeg sends it as the frames go by,
    # a quarter of a frame early so that rounding can't make one late. The times are into the Scene,
    # whose branch starts at 0 s.
    commands, last = [], first
    for point in moves:
        at = f"{max(0.0, point.at - scene.start - 0.25 / plan.fps):.4f}"
        for key, old, new in (("x", last.x, point.x), ("y", last.y, point.y)):
            if new != old:
                commands.append(f"{at} crop@{name} {key} {new}")
        last = point
    # Commands are separated by ";", escaped from the filtergraph, which splits chains at it.
    moving = f"sendcmd=c={'\\;'.join(commands)}," if commands else ""
    area = panel.area
    drawn = f"{moving}crop@{name}=w={panel.crop_width}:h={panel.crop_height}:x={first.x}:y={first.y},"
    if panel.blur:
        # Blurred small and scaled up: cheaper than blurring the full size, and as smooth.
        small_width, small_height = (max(2, round(side / tuning.blur_shrink / 2) * 2) for side in (area.width, area.height))
        drawn += (
            f"scale={small_width}:{small_height},gblur=sigma={tuning.blur_sigma},"
            f"eq=brightness={tuning.blur_brightness},scale={area.width}:{area.height}"
        )
    else:
        drawn += f"scale={area.width}:{area.height}:flags=lanczos"
    return drawn + ",setsar=1"


def _pad(plan: RenderPlan, panel: Panel) -> str:
    area = panel.area
    if (area.width, area.height) == (plan.width, plan.height):
        return ""
    return f",pad={plan.width}:{plan.height}:{area.x}:{area.y}:black"


def _range(plan: RenderPlan) -> list[str]:
    """Input options that read just the Clip's range of the Source."""
    return ["-ss", f"{plan.start:.3f}", "-t", f"{plan.duration:.3f}"]


def _last_lines(text: str, count: int = 3) -> str:
    return " ".join(text.strip().splitlines()[-count:])
