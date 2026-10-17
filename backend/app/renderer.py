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
a Face (app/fonts.py), bundled or imported: the Faces the script sets text in are given to libass
through a `fontsdir` made for the render, so no system font is needed. A line too wide for its area
is set at the smaller size the plan gives it.

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
silence. A Freeze frame (docs/adr/0009) reads a moment of its video at its frame and holds the
first frame for its hold (`tpad`), in silence. A join with a Transition is an
xfade of the pictures (each Segment first brought to the Clip's frame rate and time base, which
xfade needs) and an acrossfade of the sounds, over the length the two overlap.

A Segment at a Speed (docs/adr/0009) has its frames' times divided by it and then brought to the
Clip's frame rate (frames dropped or repeated, none blended); its sound is played at it, its pitch
kept by a chain of `atempo` stages or changed with it by `asetrate`, before its volume and volume
Keyframes, which are in Timeline seconds. The Clip's sound is resampled once more before its
loudness is measured and normalized: that keeps `atempo`'s fractional timestamps from cutting it
short, as Concat found. A reversed Segment is read forwards from its Retimed copy (app/retimed.py's
`read_from_copies`): a video's as its video, the Source's (`read_from`) in place of the Source, still
drawn in its Scenes' panels and heard at the Clip's own volume.

Overlays are more inputs (a video read from its offset for as long as it shows, or an image), each
drawn as its Picture (`_picture`: cropped, scaled, flipped, rounded and bordered, turned with a
transparent fill, shadowed, faded) and laid over the joined frames at its centre while it shows,
before the Logo and the captions. A picture that is only scaled keeps the graph it had: a scale and
an overlay.

A keyed Overlay (docs/adr/0008) is drawn by a frame process instead (app/frames.py): a thread of
this process that draws the picture as it is at each frame of its span with OpenCV (a video's frames
decoded for it by an ffmpeg of their own), decorated, and writes it, the whole frame in raw RGBA, to a
pipe that the encode reads as one more input, laid over at 0, 0 in the same place of the graph, each
frame over the Clip's frame of its number. With any, the joined
frames are first brought to the Clip's frame rate (`fps`), so that frame n is at n / fps exactly, the
time its picture is sampled at. A frame process that fails stops the encode, and an encode that fails
or is stopped ends its frame processes. Without keyed pictures the command is as it was.

A keyed video Segment's picture is drawn by a frame process too, in seconds into its Segment, and
laid over its Background inside its Segment's own chain (`_keyed_scene`, its frames first brought to
the Clip's frame rate from 0 s), so that its Transitions see the picture move. Its keyed volume is
an expression of its own time in its own sound's chain, as a Music Clip's is.

Music Clips are more inputs (their songs, from app/media.py), each trimmed to its part of the song,
set to its volume (a keyed one's by an expression of its own time, from its Keyframes), faded, and
delayed to where it is heard, then mixed with the Clip's own sound (at its volume) before the
loudness is measured and normalized, so that the mix lands at −14 LUFS.
Without music, and at its own volume, the Clip's sound goes as it did.

Text Layers are pictures (docs/adr/0010): each one's, made by app/text_pictures.py before the render,
is one more input, drawn as an Overlay's image is (`_picture`) while it shows, over the captions and
under the hook, in their order. With any, the script is cut in two: the Watermark's text and the
captions are burned before them, and the hook after. One that is keyed (docs/adr/0008), or comes on
or goes off as the hook does (Fade, Pop, Slide), is drawn by a frame process, as a keyed Overlay is:
its picture sampled from its Keyframes, then faded, scaled and moved by the hook's curves on top
(`text_at`). Without Text Layers, the command is as it was.
"""

import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable, Sequence
from dataclasses import replace
from pathlib import Path

import numpy as np

from app.config import FONTS_DIR, RenderTuning
from app.fonts import font, registry
from app.frames import FrameFeed, PictureFrames, VideoDecode, read_image, shadow_room
from app.keyframes import linear_steps
from app.segment_time import SegmentTime
from app.planner import (
    FRAME,
    HOOK_LEADING,
    HOOK_PAD_Y,
    Box,
    CaptionEvent,
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
    picture_at,
)
from app.candidates import Keyframe, Shadow, TextLayer
from app.styles import Animation, CaptionStyle, DropShadow, Highlight, HookStyle, WatermarkKind, WatermarkStyle

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
        pictures: dict[str, Path] | None = None,
    ) -> str:
        """Write the Clip that `plan` describes to `video` (MP4, fast start) and its poster to `poster`
        (JPEG), and return the video encoder that made them: the first of RenderTuning.encoders that
        succeeds. `progress` is called with the share of the Clip encoded so far, from 0 to 1. `logo`
        is the PNG of the plan's Logo Watermark, which isn't drawn without it; `files` has the file of
        each Media Library item the plan plays (songs and videos), by its id; `pictures` the picture of
        each of its Text Layers (app/text_pictures.py), by its name.

        Both files are written under temporary names and then renamed, so a Clip that is rendered
        again stays playable until its new files are complete. Raises RenderStopped after `stop()`.
        """
        _check(plan)
        files = files or {}
        pictures = pictures or {}
        if missing := [event.layer.id for event in plan.texts if event.image not in pictures]:
            raise RuntimeError(f"The pictures of Text Layers {', '.join(missing)} weren't made")
        loudness = self._measure(source, plan, files)
        parts = video.with_name(f".{video.stem}.part{video.suffix}"), poster.with_name(f".{poster.stem}.part{poster.suffix}")
        # With Text Layers, the script is cut in two about them: what they are drawn over, then the hook.
        below, above = (replace(plan, hook=None), replace(plan, captions=[], watermark=None)) if plan.texts else (plan, None)
        scripts = {
            name: (video.with_name(f".{video.stem}.part{suffix}.ass"), script)
            for name, suffix, script in (("below", "", below), ("above", "-above", above))
            if script is not None and (script.captions or script.hook or _text_watermark(script))
        }
        fonts = video.with_name(f".{video.stem}.part.fonts")
        if plan.watermark is None or plan.watermark.kind is not WatermarkKind.LOGO:
            logo = None
        # The keyed pictures' items: an image read once for every encode, a video decoded for each.
        keyed = _keyed_items(plan, files, source, pictures)
        failures = []
        try:
            if scripts:
                registry().gather(_faces(plan), fonts)
            for path, script in scripts.values():
                path.write_text(_ass(script), encoding="utf-8")
            subtitles, over = (scripts[name][0] if name in scripts else None for name in ("below", "above"))
            for encoder in self.tuning.encoders:
                feeds = _feeds(plan, keyed, self.ffmpeg)
                command = self._command(source, plan, loudness, encoder, *parts, subtitles, logo, files, feeds, fonts, pictures, over)
                stderr = self._run(command, plan.duration, progress, list(feeds.values()))
                if stderr is None and parts[1].is_file():
                    os.replace(parts[0], video)
                    os.replace(parts[1], poster)
                    return encoder
                stderr = stderr or "no poster frame was written"
                logger.warning("Rendering with %s failed: %s", encoder, stderr)
                failures.append(f"{encoder}: {last_lines(stderr)}")
        finally:
            for part in (*parts, *(path for path, _ in scripts.values())):
                part.unlink(missing_ok=True)
            shutil.rmtree(fonts, ignore_errors=True)
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
            audio = ["-filter_complex", f"{heard}aresample={tuning.audio_rate},{measure}[measured]", "-map", "[measured]"]
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
        feeds: "Feeds | None" = None,
        fonts: Path = FONTS_DIR,
        pictures: dict[str, Path] | None = None,
        above: Path | None = None,
    ) -> list[str]:
        """The encode's command. `feeds` are the frame processes of the plan's keyed pictures (its
        Overlays', its keyed Scenes' and its animated Text Layers', by their places among them); a
        keyed one without is drawn still, at its constants. `fonts` holds the Faces the `subtitles`
        set text in, burned under the Text Layers (drawn from `pictures`, by their names), and `above`
        over them."""
        tuning = self.tuning
        feeds = feeds or {}
        sources, sounds, sound = _source_inputs(plan, source, files or {}, tuning.audio_rate)
        count = len(sources) // _INPUT_ARGS
        # The music's first input: after the Source's and its videos', and the logo's.
        before_music = count + (1 if logo is not None else 0)
        inputs, index = _music_inputs(plan, files or {}, first=before_music)
        layers, layered = _overlay_inputs(plan, files or {}, before_music + len(index), feeds)
        scene_inputs, drawn = _scene_inputs(plan, before_music + len(index) + len(layered), feeds)
        texts, written = _text_inputs(plan, pictures or {}, before_music + len(index) + len(layered) + len(drawn), feeds)
        frame = _segmented(plan, tuning, drawn) if plan.segments else _scenes(plan, tuning, keyed=drawn)
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        joined = "[frame]"
        if any(feed is not None for _, _, feed in layered + written):
            # At n / fps exactly, the times the Overlays' frame processes draw their frames at.
            frame += f";[frame]fps={_rate(plan)}[timed]"
            joined = "[timed]"
        for i, (event, number, feed) in enumerate(layered):
            frame += f";{_overlay(event, joined, f'[over{i}]', number, i, feed)}"
            joined = f"[over{i}]"
        if logo is not None and plan.watermark is not None:
            frame += f";{_logo_overlay(plan.watermark, joined, '[marked]', count)}"
            joined = "[marked]"
        # Captions and the hook are burned after the Scenes are joined, so that they follow the Clip's
        # timeline; the Text Layers between them.
        if written:
            if subtitles is not None:
                frame += f";{joined}{_burned(subtitles, fonts)}[captioned]"
                joined = "[captioned]"
            for i, (event, number, feed) in enumerate(written):
                frame += f";{_text_layer(event, joined, f'[text{i}]', number, i, feed)}"
                joined = f"[text{i}]"
            subtitles = above
        burned = "" if subtitles is None else f"{_burned(subtitles, fonts)},"
        frame += f";{joined}{burned}format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
        mix = _audio_mix(plan, index, tuning.audio_rate, sound)
        heard = f"{sounds}{mix};[mix]" if mix is not None else f"{sounds}{sound}"
        audio = f"{heard}aresample={tuning.audio_rate}[a]"
        if loudness is not None:
            audio = (
                f"{heard}aresample={tuning.audio_rate},loudnorm=I={tuning.loudness_lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}"
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
            *sources, *([] if logo is None else ["-i", str(logo)]), *inputs, *layers, *scene_inputs, *texts,
            "-filter_complex", f"{frame};{audio}",
            "-map", "[v]", "-map", "[a]", "-map_metadata", "-1", "-map_chapters", "-1",
            *codec, "-profile:v", "high", "-g", str(max(1, round(plan.fps * tuning.keyframe_secs))),
            "-c:a", "aac", "-b:a", tuning.audio_bitrate,
            "-movflags", "+faststart", "-f", "mp4", str(video),
            "-map", "[poster]", "-frames:v", "1", "-q:v", "3", "-f", "image2", "-update", "1", str(poster),
        ]

    def _run(self, command: list[str], duration: float, progress: Callable[[float], None], feeds: Sequence[FrameFeed] = ()) -> str | None:
        """Run an encode, reporting its progress, with `feeds`, the frame processes that write to its
        pipes; None when it succeeds, else what ffmpeg (or a frame process that failed) said. A frame
        process that fails stops the encode, and an encode that stops ends the frame processes."""
        process = None
        try:
            with tempfile.TemporaryFile() as errors:
                with self._lock:
                    if self._stopping.is_set():
                        raise RenderStopped("The app is stopping")
                    process = self._process = subprocess.Popen(
                        command, stdout=subprocess.PIPE, stderr=errors, text=True, pass_fds=[feed.fd for feed in feeds],
                    )
                for feed in feeds:
                    feed.start(process.kill)
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
                if failed := next((feed.error for feed in feeds if feed.error is not None), None):
                    return f"A keyed picture couldn't be drawn: {failed}"
                if process.returncode == 0:
                    return None
                errors.seek(0)
                return errors.read().decode(errors="replace").strip() or f"exit code {process.returncode}"
        finally:
            # A frame process still writing waits on ffmpeg, which is gone once it has been waited for.
            if process is not None and process.poll() is None:
                process.kill()
                process.wait()
            for feed in feeds:
                feed.close()


def _check(plan: RenderPlan) -> None:
    """Refuse a Render Plan with nothing to draw."""
    if not plan.scenes or not all(scene.panels or scene.picture for scene in plan.scenes):
        raise ValueError("A Render Plan needs at least one scene, each with at least one panel or a picture")


# How many arguments read one input: -ss, its start, -t, its length, -i, the file.
_INPUT_ARGS = 6
# How much of its video a Freeze frame reads, of which it holds the first frame: a frame at any rate.
_HELD_READ_SECS = 0.5


def _source_inputs(plan: RenderPlan, source: Path, files: dict[str, Path], rate: int) -> tuple[list[str], str, str]:
    """The input options that read the Source (its one range, or each Segment's in order, from the
    Source or from its video in `files`: inputs 0, 1, ...), the filters that join the Segments'
    sounds (none for one range), and the link the Clip's sound is then heard from. With videos among
    the Segments, a Segment's own volume or Speed, or Transitions, each Segment's sound is first
    played at its Speed (`speed_filters`) and set to its volume (a Source Segment's also to the
    Clip's own, which the mix then leaves) in one format, and a video without sound, and a Freeze
    frame, give silence."""
    if not plan.segments:
        return [*_range(plan), "-i", str(source)], "", "[0:a:0]"
    inputs = []
    for segment in plan.segments:
        read = files[file] if (file := segment.media or segment.read_from) else source
        span = _HELD_READ_SECS if segment.hold is not None else segment.time.span
        inputs += ["-ss", f"{segment.source_start:.3f}", "-t", f"{span:.3f}", "-i", str(read)]
    count = len(plan.segments)
    plain = all(
        segment.media is None and segment.volume == 1 and segment.speed == 1 and segment.hold is None for segment in plan.segments
    )
    if plain and not plan.transitions:
        return inputs, "".join(f"[{i}:a:0]" for i in range(count)) + f"concat=n={count}:v=0:a=1[src];", "[src]"
    form = f"aformat=sample_rates={rate}:channel_layouts=stereo"
    chains = []
    for i, segment in enumerate(plan.segments):
        if segment.silent or segment.hold is not None:
            chains.append(f"anullsrc=r={rate}:cl=stereo,atrim=duration={segment.time.length:.3f}[a{i}]")
            continue
        sped = speed_filters(segment.speed, segment.pitch, rate)
        if segment.gain:
            # Its time on the Timeline from 0 at its start, which its Keyframes' are from.
            filters = [*sped, "asetpts=PTS-STARTPTS", *_volume(segment.gain, segment.volume)]
        else:
            filters = [*sped, f"volume={segment.volume * (1 if segment.media else plan.source_volume):g}"]
        chains.append(f"[{i}:a:0]{','.join(filters)},{form}[a{i}]")
    if plan.transitions:
        chains.append(_joins(plan, [f"[a{i}]" for i in range(count)], "a", "[srcv]"))
    else:
        chains.append("".join(f"[a{i}]" for i in range(count)) + f"concat=n={count}:v=0:a=1[srcv]")
    return inputs, ";".join(chains) + ";", "[srcv]"


def speed_filters(speed: float, pitch: bool, rate: int) -> list[str]:
    """Filters that play a sound at `speed`: its pitch kept, through `atempo` stages
    (`tempo_stages`); or, with `pitch`, changed with it as tape's is, its samples played at `speed`
    times its rate between two resamplings to `rate`. None at 1×."""
    if speed == 1:
        return []
    if not pitch:
        return [f"atempo={stage:.6g}" for stage in tempo_stages(speed)]
    return [f"aresample={rate}", f"asetrate={rate}*{speed:.6g}", f"aresample={rate}"]


def tempo_stages(speed: float) -> list[float]:
    """`speed` as factors within 0.5–2, which one `atempo` takes, whose product it is: 4× is 2, 2."""
    stages = []
    while speed > 2:
        stages.append(2.0)
        speed /= 2
    while speed < 0.5:
        stages.append(0.5)
        speed /= 0.5
    return [*stages, speed]


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


def _segmented(plan: RenderPlan, tuning: RenderTuning, drawn: dict[int, int] | None = None) -> str:
    """The filtergraph that draws a Clip of several Segments into [frame]: each Segment from its own
    input, its Scenes drawn as _scenes draws a Clip's (in seconds into the Segment; a Freeze frame's
    from its first frame, held), and the Segments joined back to back. A keyed Scene's picture is
    the input `drawn` gives by its place among the plan's Scenes, from its frame process."""
    chains, first = [], 0
    for i, segment in enumerate(plan.segments):
        scenes = plan.scenes[first : first + segment.scenes]
        keyed = {j: number for j in range(segment.scenes) if (number := (drawn or {}).get(first + j)) is not None}
        first += segment.scenes
        given = f"[{i}:v]"
        if segment.hold is not None:
            given += _held(segment.hold)
        elif segment.speed != 1:
            # Its frames moved onto the Timeline, then dropped or repeated to the Clip's frame rate:
            # each frame is the last of the video's at or before its time, as a Retimed copy's (a
            # frame landing on one of the Clip's, a thousandth of a frame early against rounding, is that one).
            rate = _rate(plan)
            given += f"settb=AVTB,setpts=(PTS-STARTPTS)/{segment.speed:.6g}-{0.001 / float(rate):.6g}/TB,fps={rate}:round=up,"
        chains.append(_scenes(plan, tuning, scenes, given, f"[g{i}]", f"g{i}s", segment.start, keyed))
    count = len(plan.segments)
    if not plan.transitions:
        chains.append("".join(f"[g{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0[frame]")
        return ";".join(chains)
    # xfade takes pictures of one frame rate and time base.
    rate = plan.fps if plan.fps > 0 else 30
    chains += [f"[g{i}]fps={rate:g},settb=AVTB,format=yuv420p[n{i}]" for i in range(count)]
    chains.append(_joins(plan, [f"[n{i}]" for i in range(count)], "v", "[frame]"))
    return ";".join(chains)


def _held(hold: float) -> str:
    """Filters that make a Freeze frame's picture of its input: the first frame, held `hold` seconds."""
    return f"trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={hold:.3f},trim=duration={hold:.3f},"


def _scenes(
    plan: RenderPlan,
    tuning: RenderTuning,
    scenes: list[ScenePlan] | None = None,
    given: str = "[0:v]",
    out: str = "[frame]",
    prefix: str = "s",
    offset: float = 0.0,
    keyed: dict[int, int] | None = None,
) -> str:
    """The filtergraph that draws the plan's Scenes (or `scenes`, starting `offset` seconds into the
    Clip) from `given` (by default [0:v]) into `out` (by default [frame]), its filters named from
    `prefix`. With several, the video is split into a branch per Scene, trimmed to it from half a
    frame before its first frame (so that rounding can't move a frame across a cut) and restarted at
    0 s, and the branches are concatenated. A Scene `keyed` (by its place among them) has its
    picture drawn by the frame process whose frames are that input."""
    scenes = plan.scenes if scenes is None else scenes
    keyed = keyed or {}
    if len(scenes) == 1:
        return _scene(plan, scenes[0], f"{prefix}0", given, out, tuning, keyed.get(0))
    count = len(scenes)
    chains = [f"{given}split={count}" + "".join(f"[{prefix}{i}]" for i in range(count))]
    for i, scene in enumerate(scenes):
        bounds = []
        if i > 0:
            bounds.append(f"start={scene.start - offset - 0.5 / plan.fps:.4f}")
        if i < count - 1:
            bounds.append(f"end={scene.end - offset - 0.5 / plan.fps:.4f}")
        chains.append(
            _scene(
                plan, scene, f"{prefix}{i}", f"[{prefix}{i}]trim={':'.join(bounds)},setpts=PTS-STARTPTS,", f"[{prefix}v{i}]", tuning,
                keyed.get(i),
            )
        )
    chains.append("".join(f"[{prefix}v{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0{out}")
    return ";".join(chains)


def _scene(plan: RenderPlan, scene: ScenePlan, name: str, given: str, out: str, tuning: RenderTuning, keyed: int | None = None) -> str:
    """Filters that draw `scene` from the frames `given` (a link label, then any filters to start
    with) into the link `out`: its first panel, padded to the frame unless it fills it, then each
    other panel laid over it in its area; or, for a Scene of one picture, as `_framed_scene` draws it
    (a keyed one's picture from input `keyed`, as `_keyed_scene` does)."""
    if scene.picture is not None and keyed is not None:
        return _keyed_scene(plan, scene, name, given, out, tuning, keyed)
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
        # Drawn in RGB: drawbox writes a YUV colour as limited range whatever the frames' range,
        # and a Clip's frames are full range (its poster is a JPEG), so black would show as grey.
        chains.append(f"[{name}b]crop=2:2:0:0,format=rgb24,drawbox=c=0x{colour}:t=fill,scale={plan.width}:{plan.height},setsar=1[{name}l]")
    chains.append(_picture(picture, f"[{name}f]", f"[{name}l]", out, f"{name}q"))
    return ";".join(chains)


def _keyed_scene(plan: RenderPlan, scene: ScenePlan, name: str, given: str, out: str, tuning: RenderTuning, index: int) -> str:
    """Filters that draw a Scene of one keyed picture (a video Segment's or a Manual Scene's) from the frames `given`
    into `out`: its Background as `_framed_scene` draws it (none at all when the plan has left it
    out: the picture covers the frame throughout), from the frames brought to the Clip's frame rate
    from 0 s, then its frame process's frames (input `index`) laid at 0, 0, frame n over frame n.
    The Transitions then see the picture move."""
    timed = f"{given}setpts=PTS-STARTPTS,fps={_rate(plan)}:start_time=0:round=up,"
    if scene.panels:
        panel = scene.panels[0]
        chains = [f"{timed}{_panel(plan, scene, f'{name}p0', panel, tuning)}{_pad(plan, panel)}[{name}l]"]
    else:
        colour = (scene.colour or "#000000").removeprefix("#")
        chains = [f"{timed}crop=2:2:0:0,format=rgb24,drawbox=c=0x{colour}:t=fill,scale={plan.width}:{plan.height},setsar=1[{name}l]"]
    chains.append(f"[{index}:v]setpts=PTS-STARTPTS[{name}q];[{name}l][{name}q]overlay=0:0{out}")
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
    `index[media]`), at its volume, faded, delayed to its start; an Overlay's sound played at its
    Speed first (`speed_filters`). None without music at the Clip's own volume, where the sound goes
    as it is."""
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
        read = round(event.time.span, 3)
        sped = speed_filters(event.speed, event.pitch, rate)
        filters = [
            f"atrim=start={event.offset:g}:end={event.offset + read:g}", "asetpts=PTS-STARTPTS",
            # Then its time on the Timeline from 0 at its start, which its Keyframes and fades are in.
            *([*sped, "asetpts=PTS-STARTPTS"] if sped else []), *_volume(event.gain, event.volume),
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


# A keyed volume is worked out afresh for every block of this many samples (10 ms at 48 kHz).
_GAIN_BLOCK = 480


def _volume(gain: Sequence[Keyframe], volume: float) -> list[str]:
    """Filters that set a sound to `volume`, or to its `gain` track (its volume Keyframes, in its own
    seconds, where its time starts at 0) when it has one: straight lines between points of the
    curve (`linear_steps`, an eased span in 24), summed as one clipped ramp each, with no nesting,
    evaluated per block of _GAIN_BLOCK samples."""
    if not gain:
        return [f"volume={volume:g}"]
    points = linear_steps(gain)
    terms = [f"{points[0][1]:.6g}"]
    for (start, before), (end, after) in zip(points, points[1:]):
        if after != before and end > start:
            terms.append(f"{after - before:+.6g}*clip((t-{start:.6g})/{end - start:.6g},0,1)")
    return [f"asetnsamples=n={_GAIN_BLOCK}:p=0", f"volume=volume='{''.join(terms)}':eval=frame"]


def _overlay_inputs(
    plan: RenderPlan, files: dict[str, Path], first: int, feeds: "Feeds"
) -> tuple[list[str], list[tuple[OverlayEvent, int, FrameFeed | None]]]:
    """The input options of the plan's Overlays, one each, numbered from `first` (a video read from its
    offset for as long as it shows times its Speed; an image's one picture; a keyed one's frames,
    from the pipe of its frame process in `feeds`, by its place among them), and each Overlay drawn
    with its input's number and its frame process. One whose file isn't in `files` isn't drawn."""
    inputs: list[str] = []
    drawn = []
    for i, event in enumerate(plan.overlays):
        if event.media not in files:
            continue
        feed = feeds.get(("overlay", i))
        if feed is not None:
            inputs += _piped(plan, feed)
        else:
            if not event.image:
                inputs += ["-ss", f"{event.offset:.3f}", "-t", f"{event.time.span:.3f}"]
            inputs += ["-i", str(files[event.media])]
        drawn.append((event, first + len(drawn), feed))
    return inputs, drawn


def _overlay(event: OverlayEvent, below: str, out: str, index: int, number: int, feed: FrameFeed | None = None) -> str:
    """Filters that draw an Overlay (input `index`) as its Picture over the frames `below` while it
    shows, into `out`: a video's frames moved to start when it does and timed by its Speed, an
    image's one picture held. A keyed one's frames, drawn whole by its frame process `feed`, are
    laid at 0, 0, each over the frame of its number (the frames below being at n / fps exactly)."""
    shows = f"enable='between(t\\,{event.start:.3f}\\,{event.end:.3f})'"
    if feed is not None:
        name = f"[layer{number}]"
        return f"[{index}:v]setpts=PTS-STARTPTS+{feed.first}{name};{below}{name}overlay=0:0:{shows}:eof_action=pass{out}"
    played = "PTS-STARTPTS" if event.speed == 1 else f"(PTS-STARTPTS)/{event.speed:.6g}"
    timed = "" if event.image else f",setpts={played}+{event.start:.3f}/TB"
    ends = "repeat" if event.image else "pass"
    return _picture(event.picture, f"[{index}:v]", below, out, f"layer{number}", timed, f"{shows}:eof_action={ends}")


def _text_inputs(
    plan: RenderPlan, pictures: dict[str, Path], first: int, feeds: "Feeds"
) -> tuple[list[str], list[tuple[TextEvent, int, FrameFeed | None]]]:
    """The input options of the plan's Text Layers, one each, numbered from `first` (its picture, or
    an animated one's frames, from the pipe of its frame process in `feeds`), and each Text Layer
    with its input's number and its frame process."""
    inputs: list[str] = []
    drawn = []
    for i, event in enumerate(plan.texts):
        feed = feeds.get(("text", i))
        inputs += _piped(plan, feed) if feed is not None else ["-i", str(pictures[event.image])]
        drawn.append((event, first + i, feed))
    return inputs, drawn


def _text_layer(event: TextEvent, below: str, out: str, index: int, number: int, feed: FrameFeed | None = None) -> str:
    """Filters that draw a Text Layer (input `index`) as its picture over the frames `below` while it
    shows, into `out`: its one picture held, or an animated one's frames, drawn whole by its frame
    process `feed`, laid at 0, 0. An unturned picture whose corner is at an odd pixel is padded by a
    transparent one, since an overlay onto 4:2:0 frames moves a picture to the even pixel before."""
    shows = f"enable='between(t\\,{event.start:.3f}\\,{event.end:.3f})'"
    name = f"text{number}"
    if feed is not None:
        return f"[{index}:v]setpts=PTS-STARTPTS+{feed.first}[{name}];{below}[{name}]overlay=0:0:{shows}:eof_action=pass{out}"
    picture = event.picture
    padded = ""
    if picture.rotation % 360 == 0:
        across = round(picture.centre[0] - picture.width / 2) % 2
        down = round(picture.centre[1] - picture.height / 2) % 2
        if across or down:
            padded = f",format=rgba,pad=iw+{2 * across}:ih+{2 * down}:{across}:{down}:color=black@0"
    return _picture(picture, f"[{index}:v]", below, out, name, padded, f"{shows}:eof_action=repeat")


def text_at(event: TextEvent, time: float) -> Picture:
    """A Text Layer's picture as drawn at `time` seconds into the Clip: as its Keyframes have it then
    (`picture_at`), and on top of that faded, scaled about its centre and moved down as its
    animations have it (`text_look`): its keyed opacity and scale multiplied, its drop added."""
    opacity, scale, below = text_look(event, time)
    picture = picture_at(event.picture, time)
    if (opacity, scale, below) == (1.0, 1.0, 0.0):
        return picture
    x, y = picture.centre
    return replace(
        picture, width=picture.width * scale, height=picture.height * scale, centre=(x, y + below), opacity=picture.opacity * opacity
    )


def text_look(event: TextEvent, time: float) -> tuple[float, float, float]:
    """A Text Layer's opacity, scale and how far below its place it is at `time` seconds into the
    Clip, coming on and going off as the hook does (_hook_phases, _hook_motion): faded in and out
    over its animation_ms (Fade alone), or for _hook_ends' time grown from POP_FROM percent (Pop) or
    risen SLIDE_PX (Slide) as it fades, each in a straight line. The preview's twin is hookLook in
    frontend/src/pages/job/editor/ClipPreview.tsx."""
    layer = event.layer
    moving = {Animation.POP, Animation.SLIDE}
    if layer.animation_in not in moving and layer.animation_out not in moving:
        ms = layer.animation_ms / 1000
        on = (time - event.start) / ms if layer.animation_in == Animation.FADE else 1.0
        off = (event.end - time) / ms if layer.animation_out == Animation.FADE else 1.0
        return min(max(min(on, off), 0.0), 1.0), 1.0, 0.0
    on, off = _hook_ends(event, layer)
    if on and time < event.start + on:
        return _animated(layer.animation_in, (time - event.start) / on)
    if off and time >= event.end - off:
        return _animated(layer.animation_out, (event.end - time) / off)
    return 1.0, 1.0, 0.0


def _animated(animation: Animation, shown: float) -> tuple[float, float, float]:
    """The opacity, scale and drop of an element `shown` of the way on by `animation`."""
    shown = min(max(shown, 0.0), 1.0)
    if animation == Animation.POP:
        return shown, (POP_FROM + (100 - POP_FROM) * shown) / 100, 0.0
    if animation == Animation.SLIDE:
        return shown, 1.0, SLIDE_PX * (1 - shown)
    return shown, 1.0, 0.0


def _burned(subtitles: Path, fonts: Path) -> str:
    """The filter that burns the ASS script `subtitles` into the frames, in the Faces in `fonts`."""
    return f"ass=filename={_filter_value(str(subtitles))}:fontsdir={_filter_value(str(fonts))}"


def _scene_inputs(plan: RenderPlan, first: int, feeds: "Feeds") -> tuple[list[str], dict[int, int]]:
    """The input options of the frame processes in `feeds` of the plan's keyed Scenes, numbered from
    `first`, and each one's input number by the Scene's place among the plan's Scenes."""
    inputs: list[str] = []
    numbers: dict[int, int] = {}
    for (kind, i), feed in feeds.items():
        if kind == "scene":
            numbers[i] = first + len(numbers)
            inputs += _piped(plan, feed)
    return inputs, numbers


def _piped(plan: RenderPlan, feed: FrameFeed) -> list[str]:
    """The input options that read a frame process's frames from its pipe, at the Clip's frame rate."""
    width, height = FRAME
    return [
        "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", f"{width}x{height}", "-framerate", _rate(plan), "-i", f"pipe:{feed.fd}",
    ]


def _rate(plan: RenderPlan) -> str:
    """The Clip's frame rate, as the frame processes and the frames they are laid over keep it."""
    return f"{plan.fps if plan.fps > 0 else 30:.6g}"


# A keyed picture of the plan: ("overlay", its place among the Overlays), ("scene", its Scene's
# place among the Scenes) or ("text", a keyed or animated Text Layer's place among them); and each one's
# frame process.
Keyed = tuple[str, int]
Feeds = dict[Keyed, FrameFeed]


def _keyed_items(
    plan: RenderPlan, files: dict[str, Path], source: Path, pictures: dict[str, Path] | None = None
) -> dict[Keyed, np.ndarray | Path]:
    """The items of the plan's keyed pictures that are in `files`, which their frame processes draw:
    an Overlay's image's pixels, or a video's file (an Overlay's or a Segment's), or the `source`
    for a Manual Scene; and a keyed or animated Text Layer's picture's pixels, from `pictures`."""
    items: dict[Keyed, np.ndarray | Path] = {
        ("overlay", i): read_image(files[event.media]) if event.image else files[event.media]
        for i, event in enumerate(plan.overlays)
        if event.picture.motion and event.media in files
    }
    for i, (media, _) in _keyed_scenes(plan).items():
        if media is None:
            items[("scene", i)] = source
        elif media in files:
            items[("scene", i)] = files[media]
    for i, event in enumerate(plan.texts):
        if (_animated_text(event) or event.picture.motion) and pictures and event.image in pictures:
            items[("text", i)] = read_image(pictures[event.image])
    return items


def _animated_text(event: TextEvent) -> bool:
    """Whether a Text Layer comes on or goes off animated, so that a frame process draws it."""
    return event.layer.animation_in != Animation.NONE or event.layer.animation_out != Animation.NONE


def _keyed_scenes(plan: RenderPlan) -> dict[int, tuple[str | None, SegmentTime]]:
    """The plan's Scenes of a keyed picture (a video Segment's, or a Manual Scene's of the Source), by
    their places among its Scenes, each with its video's Media Library id or the file its Segment is
    read from (None: the Source) and how the Scene plays it."""
    keyed: dict[int, tuple[str | None, SegmentTime]] = {}
    if not plan.segments:
        whole = SegmentTime(plan.start, plan.end)
        for i, scene in enumerate(plan.scenes):
            if scene.picture is not None and scene.picture.motion:
                keyed[i] = (None, whole.part(scene.start, scene.end))
        return keyed
    first = 0
    for segment in plan.segments:
        for i in range(first, first + segment.scenes):
            scene = plan.scenes[i]
            if scene.picture is not None and scene.picture.motion:
                keyed[i] = (segment.media or segment.read_from, segment.time.part(scene.start - segment.start, scene.end - segment.start))
        first += segment.scenes
    return keyed


def _feeds(plan: RenderPlan, items: dict[Keyed, np.ndarray | Path], ffmpeg: Path) -> Feeds:
    """A frame process for each keyed picture whose item is in `items`, over its span: an image's
    pixels drawn, a video's frames decoded by `ffmpeg` (`VideoDecode`) and drawn. A Scene's are
    drawn in seconds into the Scene, its frame n at n / fps from its start, as the Scene's own frames
    are once brought to the Clip's frame rate (`_keyed_scene`)."""
    rate = float(_rate(plan))
    scenes = _keyed_scenes(plan)
    feeds = {}
    for (kind, i), item in items.items():
        if kind == "scene":
            scene = plan.scenes[i]
            assert scene.picture is not None and isinstance(item, Path)
            picture = _later(scene.picture, -scene.start)
            length = scene.end - scene.start
            video = VideoDecode(ffmpeg, item, picture, 0.0, length, scenes[i][1], rate)
            feeds[(kind, i)] = FrameFeed(PictureFrames(picture), 0.0, length, rate, video)
            continue
        if kind == "text":
            text = plan.texts[i]
            assert isinstance(item, np.ndarray)
            frames = PictureFrames(text.picture, item, sampled=lambda time, text=text: text_at(text, time))
            feeds[(kind, i)] = FrameFeed(frames, text.start, text.end, rate)
            continue
        event = plan.overlays[i]
        if isinstance(item, Path):
            # An Overlay's video plays forwards from its offset at its Speed for as long as it shows.
            frames, video = PictureFrames(event.picture), VideoDecode(ffmpeg, item, event.picture, event.start, event.end, event.time, rate)
        else:
            frames, video = PictureFrames(event.picture, item), None
        feeds[(kind, i)] = FrameFeed(frames, event.start, event.end, rate, video)
    return feeds


def _later(picture: Picture, by: float) -> Picture:
    """A keyed `picture` with its motion `by` seconds later."""
    return replace(picture, motion={prop: [replace(key, at=key.at + by) for key in keys] for prop, keys in picture.motion.items()})


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
    room = shadow_room(shadow)
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


def _faces(plan: RenderPlan) -> set[str]:
    """The Faces the plan's ASS script (_ass) sets text in."""
    faces = set()
    if plan.captions:
        faces.add(plan.caption_style.font)
    if plan.hook:
        faces.add(plan.hook_style.font)
    if _text_watermark(plan):
        faces.add(plan.watermark_style.font)
    return faces


def _ass(plan: RenderPlan) -> str:
    """The plan's captions and hook as an ASS script for libass, in output pixels: a Dialogue event
    for each Word of each caption line, while that Word is highlighted, and the hook's (_hook_events).
    A text Watermark comes first, under them."""
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
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    if watermark:
        script.append(_watermark_event(watermark, plan.watermark_style, plan.duration))
    for event in plan.captions:
        script.extend(_caption_events(event, caption))
    if plan.hook:
        script.extend(_hook_events(plan.hook, hook))
    return "\n".join(script) + "\n"


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
    place = f"\\pos({_tracked(centre_x, style.tracking):g},{centre_y:g})"
    if event.size != style.size:
        place += f"\\fs{event.size:g}"
    place += _spacing(style.tracking)
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
    line, from the centred line's left edge, with its tracking) and the capitals' height, padded,
    with rounded corners."""
    metrics, size, tracking = font_metrics(style.font), event.size, style.tracking
    words = [word.text for word in event.words]
    line = metrics.width(" ".join(words), size, tracking)
    before = " ".join(words[:index]) + (" " if index else "")
    before = metrics.width(before, size) + tracking * len(before)
    word = metrics.width(words[index], size, tracking)
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


def _hook_events(hook: HookEvent, style: HookStyle) -> list[str]:
    """The hook's Dialogue events: its boxes and its Kicker's pill, drawn, and over them each line and
    the Kicker's text centred on its anchor; then its Quote Mark's badge and marks over everything.
    All animated on and off as the style says (_hook_phases), on ASS layers 1 to 4."""
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
        tags = (f"\\fs{size:g}" if size != style.size else "") + _spacing(style.tracking)
        elements.append((2, 5, _tracked(x, style.tracking), centre_y, ".1f", None, tags, _emphasised(line, spans, style), first + i))

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
            events.append((part, order, f"Dialogue: {layer},{start},{end},Hook,,0,0,0,,{text}"))
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


def _spacing(tracking: float) -> str:
    """The override tag that sets text `tracking` pixels apart; none for none."""
    return f"\\fsp{tracking:g}" if tracking else ""


def _tracked(x: float, tracking: float) -> float:
    """Where a centred line with `tracking` is placed for its letters to be centred on `x`: libass
    adds the tracking after its last letter too, and centres that."""
    return x + tracking / 2


# libass's \blur N is a Gaussian blur whose sigma is N times this.
LIBASS_BLUR_SIGMA = 2 / math.sqrt(math.log(256))


def _shadow_tags(shadow: DropShadow, stroke: float) -> str:
    """The override tags that draw text as its drop `shadow` (on), its `stroke` pixels wide stroke
    included: in the shadow's colour at its opacity, blurred as a CSS shadow of its blur is. With a
    stroke, only the stroke is drawn, over where the letters are too: a translucent fill would show
    where it meets the stroke, and libass blurs only the stroke of stroked text."""
    colour, alpha = _tag_colour(shadow.colour), f"&H{round(255 * (1 - shadow.opacity)):02X}&"
    blur = f"\\blur{shadow.blur / 2 / LIBASS_BLUR_SIGMA:.3g}" if shadow.blur else ""
    if stroke:
        return f"\\1a&HFF&\\3c{colour}\\3a{alpha}\\bord{stroke:g}\\shad0{blur}"
    return f"\\1c{colour}\\1a{alpha}\\bord0\\shad0{blur}"


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
