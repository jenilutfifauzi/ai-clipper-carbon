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

Captions are burned into the joined frames by libass (the `ass` filter, on the Clip's timeline), from
an ASS file written for the render: one Dialogue event per Word of each caption line, showing the
whole line with that Word in orange while it is spoken, so the line never moves as the highlight
does. The font is the bundled Montserrat ExtraBold, given to libass through `fontsdir`, so no system
font is needed. A line too wide for its area is set smaller, measured with the font's own widths.

The hook is drawn by the same `ass` filter, in the same encode: a dark, semi-transparent rounded
box drawn as an ASS vector shape, and over it each of its lines as its own event, placed where the
Render Plan's metrics put it. It shows from the first frame and fades out briefly at its end.
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

from app.config import MONTSERRAT_EXTRABOLD, RenderTuning
from app.planner import (
    HOOK_LEADING,
    HOOK_PAD_Y,
    HOOK_SIZE,
    CaptionEvent,
    HookEvent,
    Panel,
    RenderPlan,
    ScenePlan,
    font_metrics,
)

logger = logging.getLogger(__name__)

# The captions' look, in output pixels: white UPPERCASE Montserrat ExtraBold with a black outline, the
# Word being spoken in orange. libass sizes a font so that its ascent plus descent (Montserrat's
# Windows metrics: 1.562 em) is the font size: at 110 the letters are 70 px to the em, with capitals
# 49 px tall, and an average line of 16 characters is about 770 px wide.
CAPTION_FONT = "Montserrat ExtraBold"
CAPTION_SIZE = 110
CAPTION_OUTLINE = 7
CAPTION_COLOUR = "#FFFFFF"
CAPTION_ACTIVE = "#FF9F0A"
CAPTION_EDGE = "#000000"
# The hook's look: white text in a black box with rounded corners (radius in pixels), 60% opaque,
# fading out over its last moment (it is there from the first frame, which platforms show first).
HOOK_COLOUR = "#FFFFFF"
HOOK_BOX = "#000000"
HOOK_BOX_OPACITY = 0.6
HOOK_RADIUS = 24
HOOK_FADE_OUT_MS = 200


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
        subtitles = video.with_name(f".{video.stem}.part.ass") if plan.captions or plan.hook else None
        failures = []
        try:
            if subtitles is not None:
                subtitles.write_text(_ass(plan), encoding="utf-8")
            for encoder in self.tuning.encoders:
                command = self._command(source, plan, loudness, encoder, *parts, subtitles)
                stderr = self._run(command, plan.duration, progress)
                if stderr is None and parts[1].is_file():
                    os.replace(parts[0], video)
                    os.replace(parts[1], poster)
                    return encoder
                stderr = stderr or "no poster frame was written"
                logger.warning("Rendering with %s failed: %s", encoder, stderr)
                failures.append(f"{encoder}: {_last_lines(stderr)}")
        finally:
            for part in (*parts, subtitles):
                if part is not None:
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
        self,
        source: Path,
        plan: RenderPlan,
        loudness: dict[str, str] | None,
        encoder: str,
        video: Path,
        poster: Path,
        subtitles: Path | None,
    ) -> list[str]:
        tuning = self.tuning
        frame = _scenes(plan, tuning)
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        # Captions and the hook are burned after the Scenes are joined, so that they follow the Clip's timeline.
        burned = "" if subtitles is None else (
            f"ass=filename={_filter_value(str(subtitles))}:fontsdir={_filter_value(str(MONTSERRAT_EXTRABOLD.parent))},"
        )
        frame += f";[frame]{burned}format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
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
    """Refuse a Render Plan with nothing to draw."""
    if not plan.scenes or not all(scene.panels for scene in plan.scenes):
        raise ValueError("A Render Plan needs at least one scene, each with at least one panel")


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


def _ass(plan: RenderPlan) -> str:
    """The plan's captions and hook as an ASS script for libass, in output pixels: a Dialogue event
    for each Word of each caption line, while that Word is highlighted, and the hook's (_hook_events)."""
    white, black = _style_colour(CAPTION_COLOUR), _style_colour(CAPTION_EDGE)
    script = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {plan.width}",
        f"PlayResY: {plan.height}",
        # No wrapping: a line is set smaller instead (see _caption_size). No colour conversion.
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: None",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        # Not bold: the font is ExtraBold already, and libass would embolden it further. Centred (5) on \pos.
        f"Style: Caption,{CAPTION_FONT},{CAPTION_SIZE},{white},{white},{black},{black},0,0,0,0,100,100,0,0,1,"
        f"{CAPTION_OUTLINE},0,5,0,0,0,1",
        f"Style: Hook,{CAPTION_FONT},{HOOK_SIZE},{_style_colour(HOOK_COLOUR)},{_style_colour(HOOK_COLOUR)},"
        f"{black},{black},0,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for event in plan.captions:
        area = event.area
        size = _caption_size(event)
        place = f"\\pos({area.x + area.width / 2:g},{area.y + area.height / 2:g})"
        if size != CAPTION_SIZE:
            place += f"\\fs{size:g}"
        for i, word in enumerate(event.words):
            start, end = _ass_time(word.start), _ass_time(word.end)
            if start >= end:
                continue
            text = " ".join(
                f"{{\\c{_tag_colour(CAPTION_ACTIVE)}}}{_ass_text(other.text)}{{\\c{_tag_colour(CAPTION_COLOUR)}}}"
                if j == i else _ass_text(other.text)
                for j, other in enumerate(event.words)
            )
            script.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{{place}}}{text}")
    if plan.hook:
        script.extend(_hook_events(plan.hook))
    return "\n".join(script) + "\n"


def _hook_events(hook: HookEvent) -> list[str]:
    """The hook's Dialogue events: its box, drawn, and over it each line centred on the box, with
    the first line's capitals HOOK_PAD_Y below its top and the baselines HOOK_LEADING sizes apart."""
    font = font_metrics()
    area, size = hook.area, hook.size
    start, end = _ass_time(hook.start), _ass_time(hook.end)
    fade = f"\\fad(0,{HOOK_FADE_OUT_MS})"
    alpha = f"&H{round(255 * (1 - HOOK_BOX_OPACITY)):02X}&"
    box = (
        f"{{\\an7\\pos({area.x},{area.y})\\p1\\c{_tag_colour(HOOK_BOX)}\\alpha{alpha}{fade}}}"
        f"{_rounded_box(area.width, area.height, HOOK_RADIUS)}{{\\p0}}"
    )
    events = [f"Dialogue: 1,{start},{end},Hook,,0,0,0,,{box}"]
    centre_x = area.x + area.width / 2
    for i, line in enumerate(hook.lines):
        baseline = area.y + HOOK_PAD_Y + (font.cap_height / font.units + i * HOOK_LEADING) * size
        # A line is centred (5) on the middle of its height: its ascent above the baseline and its
        # descent below, which together are the font size.
        centre_y = baseline - font.ascent / font.units * size + size / 2
        place = f"\\an5\\pos({centre_x:g},{centre_y:.1f}){fade}"
        if size != HOOK_SIZE:
            place += f"\\fs{size:g}"
        events.append(f"Dialogue: 2,{start},{end},Hook,,0,0,0,,{{{place}}}{_ass_text(line)}")
    return events


def _rounded_box(width: int, height: int, radius: int) -> str:
    """An ASS drawing of a `width` x `height` rectangle with rounded corners, from its top-left corner;
    each corner a Bézier quarter circle."""
    w, h, r = width, height, radius
    # How far from each corner its curve's control points are.
    c = round(r * (1 - 0.5523), 2)
    return (
        f"m {r} 0 l {w - r} 0 b {w - c:g} 0 {w} {c:g} {w} {r} l {w} {h - r} b {w} {h - c:g} {w - c:g} {h} {w - r} {h} "
        f"l {r} {h} b {c:g} {h} 0 {h - c:g} 0 {h - r} l 0 {r} b 0 {c:g} {c:g} 0 {r} 0"
    )


def _caption_size(event: CaptionEvent) -> float:
    """The font size for the caption line: CAPTION_SIZE, or smaller if the line (with its outline)
    would be wider than its area at that size."""
    width = font_metrics().width(event.text, CAPTION_SIZE) + 2 * CAPTION_OUTLINE
    if width <= event.area.width:
        return CAPTION_SIZE
    return math.floor(CAPTION_SIZE * (event.area.width - 2 * CAPTION_OUTLINE) / (width - 2 * CAPTION_OUTLINE) * 10) / 10


def _style_colour(hex_colour: str) -> str:
    """An #RRGGBB colour as an ASS style gives it, opaque: &H00BBGGRR."""
    return f"&H00{_tag_colour(hex_colour)[2:-1]}"


def _tag_colour(hex_colour: str) -> str:
    """An #RRGGBB colour as an ASS override tag gives it: &HBBGGRR&."""
    red, green, blue = hex_colour[1:3], hex_colour[3:5], hex_colour[5:7]
    return f"&H{blue}{green}{red}&".upper()


def _ass_time(seconds: float) -> str:
    """A time as ASS writes it, in centiseconds: H:MM:SS.cc."""
    centis = round(seconds * 100)
    return f"{centis // 360000}:{centis // 6000 % 60:02}:{centis // 100 % 60:02}.{centis % 100:02}"


def _ass_text(text: str) -> str:
    """Caption text with what libass would read as markup made harmless: override blocks and escapes."""
    return text.replace("\\", "\u29f5").replace("{", "(").replace("}", ")")


def _filter_value(value: str) -> str:
    """`value` escaped as a filter option inside a filtergraph: once for the option, once for the graph."""
    for special in ("\\':", "\\'[],;"):
        for char in special:
            value = value.replace(char, "\\" + char)
    return value


def _range(plan: RenderPlan) -> list[str]:
    """Input options that read just the Clip's range of the Source."""
    return ["-ss", f"{plan.start:.3f}", "-t", f"{plan.duration:.3f}"]


def _last_lines(text: str, count: int = 3) -> str:
    return " ".join(text.strip().splitlines()[-count:])
