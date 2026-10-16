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
whole line with that Word highlighted (in the active colour, or on a box of it) while it is spoken,
so the line never moves as the highlight does. The look is the plan's Caption Style. Its font is
one of the bundled ones (app/fonts.py), given to libass through `fontsdir`, so no system font is
needed. A line too wide for its area is set at the smaller size the plan gives it.

The hook is drawn by the same `ass` filter, in the same encode: a semi-transparent rounded box
drawn as an ASS vector shape, and over it each of its lines as its own event, placed where the
Render Plan's metrics put it, in the plan's Hook Style. It shows from the first frame and fades out
briefly at its end.

A text Watermark is one more event of the same script, under the captions and the hook. A Logo, an
image libass can't draw, is a second input (its PNG, from app/logos.py), scaled into the Watermark's
area at its opacity and laid over the joined frames before the captions are burned.

A Clip cut into several Segments (docs/adr/0002-segments-and-timeline-time.md) reads each Segment
as its own input, cut from the Source like a one-range Clip (or from its Media Library video); each
is drawn as above, in its own Scenes, and the Segments' frames and sounds are joined back to back
(concat). A video's Segment is one Scene of one picture: its Background (the blurred cover panel, or
its colour) and then its Picture over it, as Overlays are drawn, only the part on the frame of it
scaled (so a video zoomed in is never scaled past the frame). A Manual Scene of the Source is drawn
the same way from its own frames. With videos among them (or a Segment's own volume), each Segment's sound is set to its
volume (a Source Segment's also at the Clip's own) before the join, and a video without sound adds
silence. A join with a Transition is an
xfade of the pictures (each Segment first brought to the Clip's frame rate and time base, which
xfade needs) and an acrossfade of the sounds, over the length the two overlap.

Overlays are more inputs (a video read from its offset for as long as it shows, or an image), each
drawn as its Picture (`_picture`: cropped, scaled, flipped, rounded and bordered, turned with a
transparent fill, shadowed, faded) and laid over the joined frames at its centre while it shows,
before the Logo and the captions. A picture that is only scaled keeps the graph it had: a scale and
an overlay.

Music Clips are more inputs (their songs, from app/media.py), each trimmed to its part of the song,
set to its volume, faded, and delayed to where it is heard, then mixed with the Clip's own sound (at
its volume) before the loudness is measured and normalized, so that the mix lands at −14 LUFS.
Without music, and at its own volume, the Clip's sound goes as it did.

Text Layers are drawn by the same script too, each in its own style and its own pair of ASS layers
(its box, then its lines) above the captions' and the one before's, animated as the hook is. With
any, the hook's layers move above theirs, so that it stays on top; without, the script is as before.
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

from app.config import FONTS_DIR, RenderTuning
from app.fonts import font
from app.planner import (
    HOOK_LEADING,
    HOOK_PAD_Y,
    Box,
    CaptionEvent,
    TEXT_RADIUS,
    HookEvent,
    Panel,
    RenderPlan,
    ScenePlan,
    TextEvent,
    OverlayEvent,
    Picture,
    WatermarkEvent,
    font_metrics,
    on_frame,
)
from app.candidates import Shadow, TextLayer
from app.styles import Animation, CaptionStyle, Highlight, HookStyle, WatermarkKind, WatermarkStyle

logger = logging.getLogger(__name__)

# The highlight box's padding around its Word, in sizes of the line's font, and its corners' radius.
HIGHLIGHT_PAD_X = 0.12
HIGHLIGHT_PAD_Y = 0.08
HIGHLIGHT_RADIUS = 0.12


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
        logo: Path | None = None,
        files: dict[str, Path] | None = None,
    ) -> str:
        """Write the Clip that `plan` describes to `video` (MP4, fast start) and its poster to `poster`
        (JPEG), and return the video encoder that made them: the first of RenderTuning.encoders that
        succeeds. `progress` is called with the share of the Clip encoded so far, from 0 to 1. `logo`
        is the PNG of the plan's Logo Watermark, which isn't drawn without it; `files` has the file of
        each Media Library item the plan plays (songs and videos), by its id.

        Both files are written under temporary names and then renamed, so a Clip that is rendered
        again stays playable until its new files are complete. Raises RenderStopped after `stop()`.
        """
        _check(plan)
        files = files or {}
        loudness = self._measure(source, plan, files)
        parts = video.with_name(f".{video.stem}.part{video.suffix}"), poster.with_name(f".{poster.stem}.part{poster.suffix}")
        drawn = plan.captions or plan.hook or plan.texts or _text_watermark(plan)
        subtitles = video.with_name(f".{video.stem}.part.ass") if drawn else None
        if plan.watermark is None or plan.watermark.kind is not WatermarkKind.LOGO:
            logo = None
        failures = []
        try:
            if subtitles is not None:
                subtitles.write_text(_ass(plan), encoding="utf-8")
            for encoder in self.tuning.encoders:
                command = self._command(source, plan, loudness, encoder, *parts, subtitles, logo, files)
                stderr = self._run(command, plan.duration, progress)
                if stderr is None and parts[1].is_file():
                    os.replace(parts[0], video)
                    os.replace(parts[1], poster)
                    return encoder
                stderr = stderr or "no poster frame was written"
                logger.warning("Rendering with %s failed: %s", encoder, stderr)
                failures.append(f"{encoder}: {last_lines(stderr)}")
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

    def _measure(self, source: Path, plan: RenderPlan, files: dict[str, Path] | None = None) -> dict[str, str] | None:
        """loudnorm's measurement of the range's audio, mixed with its music; None when it is silent,
        with nothing to normalize."""
        tuning = self.tuning
        measure = f"loudnorm=I={tuning.loudness_lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}:print_format=json"
        sources, sounds, sound = _source_inputs(plan, source, files or {}, tuning.audio_rate)
        inputs, index = _music_inputs(plan, files or {}, first=len(sources) // _INPUT_ARGS)
        mix = _audio_mix(plan, index, tuning.audio_rate, sound)
        if mix is None and not sounds:
            audio = ["-map", "0:a:0", "-af", measure]
        else:
            heard = f"{sounds}{mix};[mix]" if mix is not None else f"{sounds}{sound}"
            audio = ["-filter_complex", f"{heard}{measure}[measured]", "-map", "[measured]"]
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "info",
            *sources, *inputs, *audio, "-f", "null", "-",
        ]
        result = subprocess.run(command, capture_output=True, text=True, errors="replace")
        output = result.stderr
        if result.returncode or "{" not in output:
            raise RuntimeError(f"ffmpeg couldn't measure the loudness of {source.name}: {last_lines(output)}")
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
        logo: Path | None = None,
        files: dict[str, Path] | None = None,
    ) -> list[str]:
        tuning = self.tuning
        sources, sounds, sound = _source_inputs(plan, source, files or {}, tuning.audio_rate)
        count = len(sources) // _INPUT_ARGS
        frame = _segmented(plan, tuning) if plan.segments else _scenes(plan, tuning)
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        joined = "[frame]"
        inputs, index = _music_inputs(plan, files or {}, first=count + (1 if logo is not None else 0))
        layers, layered = _overlay_inputs(plan, files or {}, first=count + (1 if logo is not None else 0) + len(index))
        for i, (event, number) in enumerate(layered):
            frame += f";{_overlay(event, joined, f'[over{i}]', number, i)}"
            joined = f"[over{i}]"
        if logo is not None and plan.watermark is not None:
            frame += f";{_logo_overlay(plan.watermark, joined, '[marked]', count)}"
            joined = "[marked]"
        # Captions and the hook are burned after the Scenes are joined, so that they follow the Clip's timeline.
        burned = "" if subtitles is None else (
            f"ass=filename={_filter_value(str(subtitles))}:fontsdir={_filter_value(str(FONTS_DIR))},"
        )
        frame += f";{joined}{burned}format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
        mix = _audio_mix(plan, index, tuning.audio_rate, sound)
        heard = f"{sounds}{mix};[mix]" if mix is not None else f"{sounds}{sound}"
        audio = f"{heard}aresample={tuning.audio_rate}[a]"
        if loudness is not None:
            audio = (
                f"{heard}loudnorm=I={tuning.loudness_lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}"
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
            *sources, *([] if logo is None else ["-i", str(logo)]), *inputs, *layers,
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
    if not plan.scenes or not all(scene.panels or scene.picture for scene in plan.scenes):
        raise ValueError("A Render Plan needs at least one scene, each with at least one panel or a picture")


# How many arguments read one input: -ss, its start, -t, its length, -i, the file.
_INPUT_ARGS = 6


def _source_inputs(plan: RenderPlan, source: Path, files: dict[str, Path], rate: int) -> tuple[list[str], str, str]:
    """The input options that read the Source (its one range, or each Segment's in order, from the
    Source or from its video in `files`: inputs 0, 1, ...), the filters that join the Segments'
    sounds (none for one range), and the link the Clip's sound is then heard from. With videos among
    the Segments, a Segment's own volume, or Transitions, each Segment's sound is first set to its
    volume (a Source Segment's also to the Clip's own, which the mix then leaves) in one format, and
    a video without sound gives silence."""
    if not plan.segments:
        return [*_range(plan), "-i", str(source)], "", "[0:a:0]"
    inputs = []
    for segment in plan.segments:
        length = f"{segment.source_end - segment.source_start:.3f}"
        read = files[segment.media] if segment.media else source
        inputs += ["-ss", f"{segment.source_start:.3f}", "-t", length, "-i", str(read)]
    count = len(plan.segments)
    plain = all(segment.media is None and segment.volume == 1 for segment in plan.segments)
    if plain and not plan.transitions:
        return inputs, "".join(f"[{i}:a:0]" for i in range(count)) + f"concat=n={count}:v=0:a=1[src];", "[src]"
    form = f"aformat=sample_rates={rate}:channel_layouts=stereo"
    chains = []
    for i, segment in enumerate(plan.segments):
        if segment.silent:
            chains.append(f"anullsrc=r={rate}:cl=stereo,atrim=duration={segment.source_end - segment.source_start:.3f}[a{i}]")
        else:
            volume = segment.volume * (1 if segment.media else plan.source_volume)
            chains.append(f"[{i}:a:0]volume={volume:g},{form}[a{i}]")
    if plan.transitions:
        chains.append(_joins(plan, [f"[a{i}]" for i in range(count)], "a", "[srcv]"))
    else:
        chains.append("".join(f"[a{i}]" for i in range(count)) + f"concat=n={count}:v=0:a=1[srcv]")
    return inputs, ";".join(chains) + ";", "[srcv]"


def _joins(plan: RenderPlan, links: list[str], kind: str, out: str) -> str:
    """Filters that join the Segments' pictures (`kind` "v") or sounds ("a"), from `links`, into
    `out`, one after another: by the Transition at a join (xfade, acrossfade), else back to back."""
    into = {transition.start: transition for transition in plan.transitions}
    chains, joined = [], links[0]
    for i in range(1, len(links)):
        segment = plan.segments[i]
        label = out if i == len(links) - 1 else f"[{kind}j{i}]"
        transition = into.get(segment.start)
        if transition is None:
            chains.append(f"{joined}{links[i]}concat=n=2:v={int(kind == 'v')}:a={int(kind == 'a')}{label}")
        elif kind == "v":
            length = transition.end - transition.start
            chains.append(f"{joined}{links[i]}xfade=transition={transition.kind.value}:duration={length:.3f}:offset={transition.start:.3f}{label}")
        else:
            chains.append(f"{joined}{links[i]}acrossfade=d={transition.end - transition.start:.3f}{label}")
        joined = label
    return ";".join(chains)


def _segmented(plan: RenderPlan, tuning: RenderTuning) -> str:
    """The filtergraph that draws a Clip of several Segments into [frame]: each Segment from its own
    input, its Scenes drawn as _scenes draws a Clip's (in seconds into the Segment), and the Segments
    joined back to back."""
    chains, first = [], 0
    for i, segment in enumerate(plan.segments):
        scenes = plan.scenes[first : first + segment.scenes]
        first += segment.scenes
        chains.append(_scenes(plan, tuning, scenes, f"[{i}:v]", f"[g{i}]", f"g{i}s", segment.start))
    count = len(plan.segments)
    if not plan.transitions:
        chains.append("".join(f"[g{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0[frame]")
        return ";".join(chains)
    # xfade takes pictures of one frame rate and time base.
    rate = plan.fps if plan.fps > 0 else 30
    chains += [f"[g{i}]fps={rate:g},settb=AVTB,format=yuv420p[n{i}]" for i in range(count)]
    chains.append(_joins(plan, [f"[n{i}]" for i in range(count)], "v", "[frame]"))
    return ";".join(chains)


def _scenes(
    plan: RenderPlan,
    tuning: RenderTuning,
    scenes: list[ScenePlan] | None = None,
    given: str = "[0:v]",
    out: str = "[frame]",
    prefix: str = "s",
    offset: float = 0.0,
) -> str:
    """The filtergraph that draws the plan's Scenes (or `scenes`, starting `offset` seconds into the
    Clip) from `given` (by default [0:v]) into `out` (by default [frame]), its filters named from
    `prefix`. With several, the video is split into a branch per Scene, trimmed to it from half a
    frame before its first frame (so that rounding can't move a frame across a cut) and restarted at
    0 s, and the branches are concatenated."""
    scenes = plan.scenes if scenes is None else scenes
    if len(scenes) == 1:
        return _scene(plan, scenes[0], f"{prefix}0", given, out, tuning)
    count = len(scenes)
    chains = [f"{given}split={count}" + "".join(f"[{prefix}{i}]" for i in range(count))]
    for i, scene in enumerate(scenes):
        bounds = []
        if i > 0:
            bounds.append(f"start={scene.start - offset - 0.5 / plan.fps:.4f}")
        if i < count - 1:
            bounds.append(f"end={scene.end - offset - 0.5 / plan.fps:.4f}")
        chains.append(
            _scene(plan, scene, f"{prefix}{i}", f"[{prefix}{i}]trim={':'.join(bounds)},setpts=PTS-STARTPTS,", f"[{prefix}v{i}]", tuning)
        )
    chains.append("".join(f"[{prefix}v{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0{out}")
    return ";".join(chains)


def _scene(plan: RenderPlan, scene: ScenePlan, name: str, given: str, out: str, tuning: RenderTuning) -> str:
    """Filters that draw `scene` from the frames `given` (a link label, then any filters to start
    with) into the link `out`: its first panel, padded to the frame unless it fills it, then each
    other panel laid over it in its area; or, for a Scene of one picture, as `_framed_scene` draws it."""
    if scene.picture is not None:
        return _framed_scene(plan, scene, name, given, out, tuning)
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


def _framed_scene(plan: RenderPlan, scene: ScenePlan, name: str, given: str, out: str, tuning: RenderTuning) -> str:
    """Filters that draw a Scene of one picture (a media Segment's, or a Manual Scene's of the Source)
    from the frames `given` into `out`: its Background, the blurred cover panel or a frame of its
    colour (made from the frames themselves, so that it has their times), then the part of its
    Picture on the frame over it. A picture that covers the frame hides its Background, which is
    then not blurred."""
    assert scene.picture is not None
    picture = on_frame(scene.picture)
    covers = picture.opacity >= 1 and not picture.rotation % 360 and picture.bounds == Box(0, 0, plan.width, plan.height)
    chains = [f"{given}split=2[{name}b][{name}f]"]
    if scene.panels and not covers:
        panel = scene.panels[0]
        chains.append(f"[{name}b]{_panel(plan, scene, f'{name}p0', panel, tuning)}{_pad(plan, panel)}[{name}l]")
    else:
        colour = (scene.colour or "#000000").removeprefix("#")
        chains.append(f"[{name}b]crop=2:2:0:0,scale={plan.width}:{plan.height},setsar=1,drawbox=c=0x{colour}:t=fill[{name}l]")
    chains.append(_picture(picture, f"[{name}f]", f"[{name}l]", out, f"{name}q"))
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


def _music_inputs(plan: RenderPlan, music: dict[str, Path], first: int) -> tuple[list[str], dict[str, int]]:
    """The input options of the songs the plan's music plays, each once, numbered from `first`, and
    each song's input number by its id."""
    index: dict[str, int] = {}
    for event in plan.audio:
        if event.media not in index and event.media in music:
            index[event.media] = first + len(index)
    return [arg for media in index for arg in ("-i", str(music[media]))], index


def _audio_mix(plan: RenderPlan, index: dict[str, int], rate: int, source: str = "[0:a:0]") -> str | None:
    """Filters that mix the Clip's sound (the link `source`), at its volume, with its music into [mix]: each Music Clip its part of its song (input
    `index[media]`), at its volume, faded, delayed to its start. None without music at the Clip's own
    volume, where the sound goes as it is."""
    heard = [event for event in plan.audio if event.media in index]
    # Segments' sounds set to their volumes already (with videos among them) aren't set again.
    volume = 1.0 if source == "[srcv]" else plan.source_volume
    if not heard and volume == 1:
        return None
    if not heard:
        return f"{source}volume={volume:g}[mix]"
    form = f"aformat=sample_rates={rate}:channel_layouts=stereo"
    chains = [f"{source}volume={volume:g},{form}[m0]"]
    for i, event in enumerate(heard, 1):
        length = round(event.end - event.start, 3)
        filters = [
            f"atrim=start={event.offset:g}:end={event.offset + length:g}", "asetpts=PTS-STARTPTS", f"volume={event.volume:g}",
        ]
        if event.fade_in:
            filters.append(f"afade=t=in:st=0:d={event.fade_in:g}")
        if event.fade_out:
            filters.append(f"afade=t=out:st={length - event.fade_out:g}:d={event.fade_out:g}")
        filters.append(f"adelay={round(event.start * 1000)}:all=1")
        chains.append(f"[{index[event.media]}:a:0]{','.join(filters)},{form}[m{i}]")
    labels = "".join(f"[m{i}]" for i in range(len(heard) + 1))
    # The Clip's length is its own sound's; nothing is turned down to make room (normalize=0).
    chains.append(f"{labels}amix=inputs={len(heard) + 1}:duration=first:normalize=0[mix]")
    return ";".join(chains)


def _overlay_inputs(plan: RenderPlan, files: dict[str, Path], first: int) -> tuple[list[str], list[tuple[OverlayEvent, int]]]:
    """The input options of the plan's Overlays, one each, numbered from `first` (a video read from its
    offset for as long as it shows; an image's one picture), and each Overlay drawn with its input's
    number. One whose file isn't in `files` isn't drawn."""
    inputs: list[str] = []
    drawn = []
    for event in plan.overlays:
        if event.media not in files:
            continue
        if not event.image:
            inputs += ["-ss", f"{event.offset:.3f}", "-t", f"{event.end - event.start:.3f}"]
        inputs += ["-i", str(files[event.media])]
        drawn.append((event, first + len(drawn)))
    return inputs, drawn


def _overlay(event: OverlayEvent, below: str, out: str, index: int, number: int) -> str:
    """Filters that draw an Overlay (input `index`) as its Picture over the frames `below` while it
    shows, into `out`: a video's frames moved to start when it does, an image's one picture held."""
    timed = "" if event.image else f",setpts=PTS-STARTPTS+{event.start:.3f}/TB"
    shows = f"enable='between(t\\,{event.start:.3f}\\,{event.end:.3f})'"
    ends = "repeat" if event.image else "pass"
    return _picture(event.picture, f"[{index}:v]", below, out, f"layer{number}", timed, f"{shows}:eof_action={ends}")


def _picture(picture: Picture, source: str, below: str, out: str, name: str, after: str = "", laid: str = "") -> str:
    """Filters that draw `picture` of the frames `source` over the frames `below`, into `out`, in the
    order of docs/adr/0007: crop, scale, flip, corners and border (`_corners`), rotate with a
    transparent fill, shadow (`_shadow`), opacity, then laid over at its centre. Steps that change
    nothing are left out. `after` is more filters of the picture's own frames, `laid` more options of
    the overlay; its own frames are labelled `name`."""
    crop = picture.crop
    steps = [] if (crop.width, crop.height) == picture.item_size else [f"crop={crop.width}:{crop.height}:{crop.x}:{crop.y}:exact=1"]
    steps.append(f"scale={picture.width}:{picture.height}:flags=lanczos")
    steps += ["hflip"] * picture.flip_h + ["vflip"] * picture.flip_v
    turned = picture.rotation % 360 != 0
    decorated = picture.radius > 0 or picture.border is not None
    if turned or picture.opacity < 1 or decorated or picture.shadow:
        steps.append("format=rgba")
    if decorated:
        steps[-1] += _corners(picture, name)
    if turned:
        angle = f"{picture.rotation:g}*PI/180"
        steps.append(f"rotate={angle}:ow=rotw({angle}):oh=roth({angle}):c=none")
    if picture.shadow:
        steps.append(_shadow(picture.shadow, name))
    if picture.opacity < 1:
        steps.append(f"colorchannelmixer=aa={picture.opacity:g}")
    x, y = picture.centre
    at = f"x={x:g}-overlay_w/2:y={y:g}-overlay_h/2"
    return f"{source}{','.join(steps)}{after}[{name}];{below}[{name}]overlay={at}{':' if laid else ''}{laid}{out}"


def _corners(picture: Picture, name: str) -> str:
    """Filters that take the frames before them (labelled `name`p) and round their corners and draw
    the border along the inside of their edge, the chain going on after them. Each is a frame of the
    picture's size made once, by a `geq` of a single frame, and held by the filter that takes it: the
    border's colour within its width of the edge, laid over the picture; and a mask of the rounded
    box, multiplied into the picture's alpha (so an image's own transparency stays). A `geq` of the
    picture's every frame instead took 20 times as long as the rest of a 3-minute render. Both give
    planar RGB, brought back to packed RGBA, which `rotate` turns far faster."""
    size = f"s={picture.width}x{picture.height}:r=1:d=1"
    edge = _edge_distance(picture.width, picture.height, picture.radius)
    graph = chain = f"[{name}p]"
    if picture.border:
        red, green, blue = _rgb(picture.border.colour)
        ring = f"255*clip({edge}+{picture.border.width}+0.5,0,1)"
        graph += f";color=c=black:{size},format=rgba,geq=r={red}:g={green}:b={blue}:a='{ring}'[{name}ring];{chain}[{name}ring]overlay=format=rgb"
        if picture.radius > 0:
            graph += f"[{name}bordered]"
            chain = f"[{name}bordered]"
    if picture.radius > 0:
        inside = f"255*clip(0.5-{edge},0,1)"
        graph += f";color=c=white:{size},format=rgba,geq=r=255:g=255:b=255:a='{inside}'[{name}mask];{chain}[{name}mask]blend=c3_mode=multiply"
    return graph + ",format=rgba"


def _edge_distance(width: int, height: int, radius: float) -> str:
    """A `geq` expression of how far each pixel's middle is outside the edge of a `width` x `height`
    box with its corners rounded `radius` (negative inside): the box's signed distance."""
    across = f"(abs(X+0.5-{width / 2:g})-{width / 2 - radius:g})"
    down = f"(abs(Y+0.5-{height / 2:g})-{height / 2 - radius:g})"
    return f"(hypot(max({across},0),max({down},0))+min(max({across},{down}),0)-{radius:g})"


def _shadow(shadow: Shadow, name: str) -> str:
    """Filters that lay a drop shadow under the frames before them, the chain going on after them:
    their alpha at the shadow's opacity, padded with room for the blur and the offset on every side
    (so the picture keeps its centre) and moved by the offset, blurred (sigma half the blur, as a
    CSS shadow's), in the shadow's colour."""
    room = math.ceil(1.5 * shadow.blur) + math.ceil(max(abs(shadow.x), abs(shadow.y)))
    red, green, blue = _rgb(shadow.colour)
    pad = f"pad=iw+{2 * room}:ih+{2 * room}:{room + round(shadow.x)}:{room + round(shadow.y)}"
    alpha = f"[{name}cast]alphaextract" + (f",lut=c0=val*{shadow.opacity:g}" if shadow.opacity < 1 else "") + f",{pad}:color=black"
    if shadow.blur:
        alpha += f",gblur=sigma={shadow.blur / 2:g}"
    return (
        f"split[{name}lifted][{name}under];[{name}under]split[{name}tint][{name}cast]"
        f";[{name}tint]lutrgb=r={red}:g={green}:b={blue},{pad}:color=0x{shadow.colour[1:]}@0[{name}tinted]"
        f";{alpha}[{name}alpha];[{name}tinted][{name}alpha]alphamerge[{name}shadow]"
        f";[{name}shadow][{name}lifted]overlay={room}:{room}:format=rgb"
    )


def _rgb(colour: str) -> tuple[int, int, int]:
    """A #RRGGBB colour's red, green and blue."""
    return int(colour[1:3], 16), int(colour[3:5], 16), int(colour[5:7], 16)


def _logo_overlay(watermark: WatermarkEvent, below: str, out: str, index: int = 1) -> str:
    """Filters that scale the Logo (input `index`, one frame) into the Watermark's area at its opacity
    and lay it over the frames `below`, into `out`. The overlay repeats the Logo's one frame to the end."""
    area = watermark.area
    return (
        f"[{index}:v]scale={area.width}:{area.height}:flags=lanczos,format=rgba,colorchannelmixer=aa={watermark.opacity:g}[logo];"
        f"{below}[logo]overlay={area.x}:{area.y}:eof_action=repeat{out}"
    )


def _text_watermark(plan: RenderPlan) -> WatermarkEvent | None:
    return plan.watermark if plan.watermark is not None and plan.watermark.kind is WatermarkKind.TEXT else None


def _pad(plan: RenderPlan, panel: Panel) -> str:
    area = panel.area
    if (area.width, area.height) == (plan.width, plan.height):
        return ""
    return f",pad={plan.width}:{plan.height}:{area.x}:{area.y}:black"


def _ass(plan: RenderPlan) -> str:
    """The plan's captions and hook as an ASS script for libass, in output pixels: a Dialogue event
    for each Word of each caption line, while that Word is highlighted, and the hook's (_hook_events).
    A text Watermark comes first, under them; Text Layers come between them (_text_events)."""
    caption, hook = plan.caption_style, plan.hook_style
    watermark = _text_watermark(plan)
    script = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {plan.width}",
        f"PlayResY: {plan.height}",
        # No wrapping: a line is set smaller instead (see the planner's _caption_size). No colour conversion.
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: None",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
        "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
        "MarginR, MarginV, Encoding",
        # Not bold: the bundled fonts are heavy already, and libass would embolden them further.
        # Centred (5) on \pos.
        _caption_style(caption),
        f"Style: Hook,{font(hook.font).family},{hook.size},{_style_colour(hook.colour)},{_style_colour(hook.colour)},"
        f"{_style_colour(hook.outline_colour)},{_style_colour(hook.shadow_colour)},0,0,0,0,100,100,0,0,1,"
        f"{hook.outline},{hook.shadow},5,0,0,0,1",
        *([_watermark_style(plan.watermark_style)] if watermark else []),
        *(_text_style(f"Text{i}", event.layer) for i, event in enumerate(plan.texts)),
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if watermark:
        script.append(_watermark_event(watermark, plan.watermark_style, plan.duration))
    for event in plan.captions:
        script.extend(_caption_events(event, caption))
    for i, event in enumerate(plan.texts):
        script.extend(_text_events(event, f"Text{i}", TEXT_LAYER_BASE + 2 * i))
    if plan.hook:
        # Above every Text Layer's layers.
        script.extend(_hook_events(plan.hook, hook, 2 * len(plan.texts) + 1 if plan.texts else 0))
    return "\n".join(script) + "\n"


# The ASS layer of the first Text Layer's box (its lines are one above), above the captions' 0 and 1.
TEXT_LAYER_BASE = 2


def _text_style(name: str, layer: TextLayer) -> str:
    text, edge = _style_colour(layer.colour), _style_colour(layer.outline_colour)
    return (
        f"Style: {name},{font(layer.font).family},{layer.size},{text},{text},{edge},{edge},0,0,0,0,100,100,0,0,1,"
        f"{layer.outline},0,5,0,0,0,1"
    )


def _text_events(event: TextEvent, style: str, base: int) -> list[str]:
    """A Text Layer's Dialogue events in its `style`: its box drawn on ASS layer `base` and its lines,
    each centred on its anchor, on the layer above; animated on and off as the hook is (_hook_phases)."""
    layer = event.layer
    metrics = font_metrics(layer.font)
    size = event.size
    elements: list[tuple[int, int, float, float, str, str | None, str, str]] = []
    if event.box is not None:
        box = event.box
        alpha = f"&H{round(255 * (1 - layer.box_opacity)):02X}&"
        tags = f"\\p1\\bord0\\shad0\\c{_tag_colour(layer.box_colour)}\\alpha{alpha}"
        drawing = f"{_rounded_box(box.width, box.height, min(round(TEXT_RADIUS * size), box.height // 2))}{{\\p0}}"
        if Animation.POP in (layer.animation_in, layer.animation_out):
            elements.append((base, 5, box.x + box.width / 2, box.y + box.height / 2, "g", alpha, tags, drawing))
        else:
            elements.append((base, 7, box.x, box.y, "g", alpha, tags, drawing))
    for line, (x, baseline) in zip(event.lines, event.anchors):
        if not line:
            continue
        centre_y = baseline - metrics.ascent / metrics.units * size + size / 2
        tags = f"\\fs{size:g}" if size != layer.size else ""
        elements.append((base + 1, 5, x, centre_y, ".1f", None, tags, _ass_text(line)))
    events = []
    for order, (ass_layer, align, x, y, y_format, alpha, tags, body) in enumerate(elements):
        for part, (begin, finish, phase) in enumerate(_hook_phases(event, layer)):
            start, end = _ass_time(begin), _ass_time(finish)
            if start >= end:
                continue
            place, motion = _hook_motion(phase, round((finish - begin) * 1000), x, y, y_format, alpha, layer)
            # A box's tags (its own alpha) come before the motion's, as the hook's boxes do.
            if ass_layer == base:
                text = f"{{\\an{align}{place}{tags}{motion}}}{body}"
            else:
                text = f"{{\\an{align}{place}{motion}{tags}}}{body}"
            events.append((part, order, f"Dialogue: {ass_layer},{start},{end},{style},,0,0,0,,{text}"))
    return [event for _, _, event in sorted(events)]


def _caption_style(style: CaptionStyle) -> str:
    text, edge, shadow = _style_colour(style.colour), _style_colour(style.outline_colour), _style_colour(style.shadow_colour)
    return (
        f"Style: Caption,{font(style.font).family},{style.size},{text},{text},{edge},{shadow},0,0,0,0,100,100,0,0,1,"
        f"{style.outline},{style.shadow},5,0,0,0,1"
    )


def _watermark_style(style: WatermarkStyle) -> str:
    text, edge = _style_colour(style.colour), _style_colour("#000000")
    outline = max(1, round(style.size / 20)) if style.outline else 0
    return (
        f"Style: Watermark,{font(style.font).family},{style.size},{text},{text},{edge},{edge},0,0,0,0,100,100,0,0,1,"
        f"{outline},0,5,0,0,0,1"
    )


def _watermark_event(event: WatermarkEvent, style: WatermarkStyle, duration: float) -> str:
    """The text Watermark's one Dialogue event, centred in its area for the whole Clip at its opacity."""
    area = event.area
    place = f"\\pos({area.x + area.width / 2:g},{area.y + area.height / 2:g})\\alpha&H{round((1 - event.opacity) * 255):02X}&"
    if event.size != style.size:
        place += f"\\fs{event.size:g}"
    return f"Dialogue: 0,{_ass_time(0)},{_ass_time(duration)},Watermark,,0,0,0,,{{{place}}}{_ass_text(event.text)}"


def _caption_events(event: CaptionEvent, style: CaptionStyle) -> list[str]:
    """A caption line's Dialogue events: one per Word, while it is highlighted, showing the whole line
    with that Word in the active colour (Colour), the line as it is over a box of the active colour
    behind the Word (Box), or the line as it is for the whole line's time (None)."""
    area = event.area
    centre_x, centre_y = area.x + area.width / 2, area.y + area.height / 2
    place = f"\\pos({centre_x:g},{centre_y:g})"
    if event.size != style.size:
        place += f"\\fs{event.size:g}"
    if style.highlight is Highlight.NONE:
        start, end = _ass_time(event.start), _ass_time(event.end)
        line = " ".join(_ass_text(word.text) for word in event.words)
        return [f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{{place}}}{line}"] if start < end else []
    events = []
    plain = " ".join(_ass_text(word.text) for word in event.words)
    for i, word in enumerate(event.words):
        start, end = _ass_time(word.start), _ass_time(word.end)
        if start >= end:
            continue
        if style.highlight is Highlight.BOX:
            events.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{_highlight_box(event, i, style)}")
            events.append(f"Dialogue: 1,{start},{end},Caption,,0,0,0,,{{{place}}}{plain}")
            continue
        text = " ".join(
            f"{{\\c{_tag_colour(style.active_colour)}}}{_ass_text(other.text)}{{\\c{_tag_colour(style.colour)}}}"
            if j == i else _ass_text(other.text)
            for j, other in enumerate(event.words)
        )
        events.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{{place}}}{text}")
    return events


def _highlight_box(event: CaptionEvent, index: int, style: CaptionStyle) -> str:
    """An ASS drawing of the box behind the line's Word `index`: the Word's width (measured like the
    line, from the centred line's left edge) and the capitals' height, padded, with rounded corners."""
    metrics, size = font_metrics(style.font), event.size
    words = [word.text for word in event.words]
    line = metrics.width(" ".join(words), size)
    before = metrics.width(" ".join(words[:index]) + (" " if index else ""), size)
    word = metrics.width(words[index], size)
    pad_x, pad_y = HIGHLIGHT_PAD_X * size, HIGHLIGHT_PAD_Y * size
    area = event.area
    # The line is centred on the area's middle: its letters' vertical middle is where the middle of
    # its ascent-plus-descent box is, and capitals sit on the baseline below the ascent's top.
    baseline = area.y + area.height / 2 - size / 2 + metrics.ascent / metrics.units * size
    cap = metrics.cap_height / metrics.units * size
    left = area.x + area.width / 2 - line / 2 + before - pad_x
    top = baseline - cap - pad_y
    width, height = round(word + 2 * pad_x), round(cap + 2 * pad_y)
    radius = round(HIGHLIGHT_RADIUS * size)
    return (
        f"{{\\an7\\pos({left:.1f},{top:.1f})\\p1\\bord0\\shad0\\c{_tag_colour(style.active_colour)}}}"
        f"{_rounded_box(width, height, min(radius, height // 2))}{{\\p0}}"
    )


def _hook_events(hook: HookEvent, style: HookStyle, raised: int = 0) -> list[str]:
    """The hook's Dialogue events: its boxes and its Kicker's pill, drawn, and over them each line and
    the Kicker's text centred on its anchor; then its Quote Mark's badge and marks over everything.
    All animated on and off as the style says (_hook_phases), on ASS layers 1 to 4, `raised` higher."""
    metrics = font_metrics(style.font)
    size = hook.size
    # (layer, its position as alignment and point with the y's format, its alpha, its tags, what
    # follows its tags, its step in a staggered entrance), for each box and each line. A box that
    # pops is placed by its centre, so that it grows from there. The Kicker comes on first, then
    # the lines one by one, each strip with its line and a block and a Quote Mark with the first.
    elements: list[tuple[int, int, float, float, str, str | None, str, str, int]] = []
    first = 1 if hook.kicker is not None else 0
    strips = len(hook.boxes) > 1
    if style.box_opacity > 0:
        alpha = f"&H{round(255 * (1 - style.box_opacity)):02X}&"
        # The text's outline and shadow are the style's; a box has neither.
        bare = "\\bord0\\shad0" if style.outline or style.shadow else ""
        tags = f"\\p1{bare}\\c{_tag_colour(style.box_colour)}\\alpha{alpha}"
        for i, box in enumerate(hook.boxes):
            drawing = f"{_rounded_box(box.width, box.height, min(style.radius, box.height // 2))}{{\\p0}}"
            step = first + i if strips else first
            if Animation.POP in (style.animation_in, style.animation_out):
                elements.append((1, 5, box.x + box.width / 2, box.y + box.height / 2, "g", alpha, tags, drawing, step))
            else:
                elements.append((1, 7, box.x, box.y, "g", alpha, tags, drawing, step))
    if hook.kicker is not None:
        kicker = hook.kicker
        box = kicker.box
        drawing = f"{_rounded_box(box.width, box.height, box.height // 2)}{{\\p0}}"
        tags = f"\\p1\\bord0\\shad0\\c{_tag_colour(style.kicker_box_colour)}\\alpha&H00&"
        if Animation.POP in (style.animation_in, style.animation_out):
            elements.append((1, 5, box.x + box.width / 2, box.y + box.height / 2, "g", None, tags, drawing, 0))
        else:
            elements.append((1, 7, box.x, box.y, "g", None, tags, drawing, 0))
        x, baseline = kicker.anchor
        centre_y = baseline - metrics.ascent / metrics.units * kicker.size + kicker.size / 2
        tags = f"\\fs{kicker.size:g}\\bord0\\shad0\\c{_tag_colour(style.kicker_colour)}"
        elements.append((2, 5, x, centre_y, ".1f", None, tags, _ass_text(kicker.text), 0))
    if hook.quote is not None:
        # Both by the badge's top-left corner (a drawing is placed by its origin there, the marks'
        # being on the badge's grid), so that a pop grows them together from it.
        badge = hook.quote
        drawing = f"{_rounded_box(badge.width, badge.height, round(QUOTE_RADIUS * badge.width))}{{\\p0}}"
        tags = f"\\p1\\bord0\\shad0\\c{_tag_colour(style.quote_colour)}"
        elements.append((3, 7, badge.x, badge.y, "g", None, tags, drawing, first))
        marks = f"{_quote_marks(badge.width)}{{\\p0}}"
        elements.append((4, 7, badge.x, badge.y, "g", None, "\\p1\\bord0\\shad0\\c&HFFFFFF&", marks, first))
    for i, (line, (x, baseline), spans) in enumerate(zip(hook.lines, hook.anchors, hook.emphasis)):
        # A line is centred (5) on the middle of its height: its ascent above the baseline and its
        # descent below, which together are the font size.
        centre_y = baseline - metrics.ascent / metrics.units * size + size / 2
        tags = f"\\fs{size:g}" if size != style.size else ""
        elements.append((2, 5, x, centre_y, ".1f", None, tags, _emphasised(line, spans, style), first + i))

    step = _stagger(hook, style, first + len(hook.lines) - 1)
    # By part of the hook's time, then by element, as the parts are in time.
    events = []
    for order, (layer, align, x, y, y_format, alpha, tags, body, rank) in enumerate(elements):
        for part, (begin, finish, phase) in enumerate(_hook_phases(hook, style, rank * step)):
            start, end = _ass_time(begin), _ass_time(finish)
            if start >= end:
                continue
            length = round((finish - begin) * 1000)
            place, motion = _hook_motion(phase, length, x, y, y_format, alpha, style)
            if layer == 1:
                text = f"{{\\an{align}{place}{tags}{motion}}}{body}"
            else:
                text = f"{{\\an{align}{place}{motion}{tags}}}{body}"
            events.append((part, order, f"Dialogue: {layer + raised},{start},{end},Hook,,0,0,0,,{text}"))
    return [event for _, _, event in sorted(events)]


def _emphasised(line: str, spans: list[tuple[int, int]], style: HookStyle) -> str:
    """A hook line as ASS text, its emphasised runs in the style's emphasis colour."""
    text, at = "", 0
    for start, end in spans:
        text += (
            f"{_ass_text(line[at:start])}{{\\c{_tag_colour(style.emphasis_colour)}}}{_ass_text(line[start:end])}"
            f"{{\\c{_tag_colour(style.colour)}}}"
        )
        at = end
    return text + _ass_text(line[at:])


# The Quote Mark's badge has corners of this share of its width. On a badge 100 units wide its marks
# are two dots of radius QUOTE_DOT_RADIUS at QUOTE_DOTS, each with a tail rising from its left side
# to above its right, like "66"; together about centred on the badge.
QUOTE_RADIUS = 0.22
QUOTE_DOT_RADIUS = 11
QUOTE_DOTS = ((35, 58.8), (65, 58.8))


def _quote_marks(width: int) -> str:
    """An ASS drawing of the Quote Mark's two marks, on a badge `width` pixels wide."""
    scale, r = width / 100, QUOTE_DOT_RADIUS
    # How far from each quarter's ends its curve's control points are.
    c = 0.5523 * r

    def at(x: float, y: float) -> str:
        return f"{x * scale:.1f} {y * scale:.1f}"

    shapes = []
    for x, y in QUOTE_DOTS:
        shapes.append(
            f"m {at(x + r, y)} b {at(x + r, y + c)} {at(x + c, y + r)} {at(x, y + r)} "
            f"b {at(x - c, y + r)} {at(x - r, y + c)} {at(x - r, y)} b {at(x - r, y - c)} {at(x - c, y - r)} {at(x, y - r)} "
            f"b {at(x + c, y - r)} {at(x + r, y - c)} {at(x + r, y)}"
        )
        shapes.append(
            f"m {at(x - r, y)} b {at(x - r, y - 1.5 * r)} {at(x - 0.4 * r, y - 2.3 * r)} {at(x + 0.8 * r, y - 2.6 * r)} "
            f"l {at(x + 0.8 * r, y - 1.9 * r)} b {at(x + 0.1 * r, y - 1.7 * r)} {at(x - 0.1 * r, y - 1.3 * r)} {at(x - 0.1 * r, y - r)}"
        )
    return " ".join(shapes)


# In a staggered entrance, each element comes on this long after the one before.
HOOK_STAGGER_SECS = 0.08
# A popping hook grows from (or shrinks to) this share of its size, in percent; a sliding one comes
# up from (or goes down to) this many pixels below its place.
POP_FROM = 70
SLIDE_PX = 60


# What is animated as the hook is: the hook in its style, or a Text Layer in its own.
type _Shown = HookEvent | TextEvent
type _Motion = HookStyle | TextLayer


def _hook_ends(hook: _Shown, style: _Motion) -> tuple[float, float]:
    """How long the hook's entrance and exit take, in seconds: the style's animation_ms each, at most
    half the hook's time; none without an animation."""
    most = (hook.end - hook.start) / 2
    on = min(style.animation_ms / 1000, most) if style.animation_in != Animation.NONE else 0.0
    off = min(style.animation_ms / 1000, most) if style.animation_out != Animation.NONE else 0.0
    return on, off


def _stagger(hook: HookEvent, style: HookStyle, steps: int) -> float:
    """How long after each other the `steps` + 1 elements of a staggered entrance start, in seconds:
    HOOK_STAGGER_SECS, or less in a hook too short for every element to be on before its exit.
    Nothing without an entrance."""
    if style.animation_in == Animation.NONE or not steps:
        return 0.0
    on, off = _hook_ends(hook, style)
    return max(0.0, min(HOOK_STAGGER_SECS, (hook.end - hook.start - on - off) / steps))


def _hook_phases(hook: _Shown, style: _Motion, delay: float = 0.0) -> list[tuple[float, float, str]]:
    """The parts of an element's time that are drawn differently, as (start, end, phase), for one
    coming on `delay` seconds after the hook starts. Fading alone (or no animation) is one part,
    "fade", where \\fad does both ends. Popping or sliding at either end splits it into "in", "hold"
    and "out", each animation taking _hook_ends' time."""
    animated = {Animation.POP, Animation.SLIDE}
    if style.animation_in not in animated and style.animation_out not in animated:
        return [(hook.start + delay, hook.end, "fade")]
    on, off = _hook_ends(hook, style)
    begin = hook.start + delay
    return [(begin, begin + on, "in"), (begin + on, hook.end - off, "hold"), (hook.end - off, hook.end, "out")]


def _hook_motion(
    phase: str, length: int, x: float, y: float, y_format: str, alpha: str | None, style: _Motion
) -> tuple[str, str]:
    """The position tag and the animation tags of a hook element at (x, y) (y written in `y_format`)
    in a part of `length` ms (see _hook_phases), its own alpha being `alpha` (None: opaque)."""
    shown = alpha or "&H00&"
    place = f"\\pos({x:g},{y:{y_format}})"
    if phase == "fade":
        on = style.animation_ms if style.animation_in == Animation.FADE else 0
        off = style.animation_ms if style.animation_out == Animation.FADE else 0
        return place, f"\\fad({on},{off})" if on or off else ""
    animation = style.animation_in if phase == "in" else style.animation_out if phase == "out" else Animation.NONE
    if animation == Animation.FADE:
        return place, f"\\fad({length},0)" if phase == "in" else f"\\fad(0,{length})"
    if animation == Animation.POP:
        if phase == "in":
            return place, f"\\fscx{POP_FROM}\\fscy{POP_FROM}\\alpha&HFF&\\t(\\fscx100\\fscy100\\alpha{shown})"
        return place, f"\\t(\\fscx{POP_FROM}\\fscy{POP_FROM}\\alpha&HFF&)"
    if animation == Animation.SLIDE:
        here, below = f"{x:g},{y:{y_format}}", f"{x:g},{y + SLIDE_PX:{y_format}}"
        if phase == "in":
            return f"\\move({below},{here})", f"\\alpha&HFF&\\t(\\alpha{shown})"
        return f"\\move({here},{below})", "\\t(\\alpha&HFF&)"
    return place, ""


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


def last_lines(text: str, count: int = 3) -> str:
    """The last `count` lines of what ffmpeg said, on one line, for an error message."""
    return " ".join(text.strip().splitlines()[-count:])
