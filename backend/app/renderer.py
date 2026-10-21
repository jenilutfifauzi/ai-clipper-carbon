"""The Renderer: executes a Render Plan with the configured ffmpeg, making a Clip's MP4 and poster.

Each Clip is one encode, a single ffmpeg process that cuts the range (an accurate seek: ffmpeg
decodes from the keyframe before the start and drops what comes before it), draws each Scene in its
Layout, normalizes the audio, and writes the poster from the same frames. It is encoded as its
Export Settings say (app/encoding.py): their codec's encoders are tried in turn, the hardware one
first. Before it, an audio-only pass measures the range's loudness, so that the encode can apply the
gain that takes it to the settings' loudness target, −14 LUFS by default (loudnorm's two-pass linear
mode). One pass would have to adjust the gain as it goes (loudnorm's dynamic mode), which can pump
and lands less exactly on the target; the measurement only decodes the range's audio, which takes
about a second for a 90 s Clip. Without a target, nothing is measured and the mix is left as it is.
The same mix, measured and normalized the same way, is what "Save audio" writes alone
(`Renderer.render_audio`).

The Render Plan is in 1080×1920 output pixels; the Clip is the Export Settings' size, and the plan
is drawn at it (app/scaled_plan.py, docs/adr/0021): every coordinate and size the filter graph is
given comes from the plan scaled to that size, the keyed pictures' frames are that size, and the
picture layers' pictures are rasterised at it (`picture_layouts` names them; they are made before
the render). The ASS script for the captions, the hook and a text Watermark is written from the plan
in its own pixels, and libass scales it to the frame (its PlayRes), drawing the text sharp at any
size. The poster is a frame of the Clip, at its size.

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
the same way from its own frames. With videos among them (or a Segment's own volume, or fades),
each Segment's sound is set to its volume (a Source Segment's also at the Clip's own) and faded in
and out (linear `afade`s from its start on the Timeline, a Transition's overlap included, which the
crossfade multiplies) before the join, and a video without sound adds silence. A Freeze frame
(docs/adr/0009) reads a moment of its video at its frame and holds the first frame for its hold
(`tpad`), in silence; a Muted Segment (docs/adr/0016) is heard as silence too, and a Muted Music
Clip or Overlay is left out of the mix. A join with a Transition is drawn by its kind's recipe
(app/transitions.py, docs/adr/0012): its chains on the two pictures, then one xfade of them (each
Segment first brought to the Clip's frame rate and time base, which xfade needs); and an
acrossfade of the sounds, over the length the two overlap, along the Transition's sound: straight
lines, quarter sines, or a cut at the middle (`_sounds_crossed`).

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
frame over the Clip's frame of its number. So is one that comes on or goes off as a picture layer
does (Fade, Pop, Slide): faded, scaled and moved on top of its keyed values (`overlay_at`), its
sound left as it is. With any, the joined frames are first brought to the Clip's frame rate
(`fps`), so that frame n is at n / fps exactly, the time its picture is sampled at. A frame process that fails stops the encode, and an encode that fails
or is stopped ends its frame processes. Without keyed pictures the command is as it was.

A keyed video Segment's picture is drawn by a frame process too, in seconds into its Segment, and
laid over its Background inside its Segment's own chain (`_keyed_scene`, its frames first brought to
the Clip's frame rate from 0 s), so that its Transitions see the picture move. Its keyed volume is
an expression of its own time in its own sound's chain, as a Music Clip's is.

Music Clips are more inputs (their songs, from app/media.py), each trimmed to its part of the song,
set to its volume (a keyed one's by an expression of its own time, from its Keyframes), faded, and
delayed to where it is heard, then mixed with the Clip's own sound (at its volume) before the
loudness is measured and normalized, so that the mix lands at the loudness target.
Without music, and at its own volume, the Clip's sound goes as it did.

The plan's picture layers (its Shapes, docs/adr/0011, and its Text Layers, docs/adr/0010;
planner.py's `PictureLayer`) are pictures: each one's, made by app/layer_pictures.py before the
render, is one more input, drawn as an Overlay's image is (`_picture`) while it shows, over the
captions and under the hook, in the plan's order (its Shapes under its Text Layers). With any, the
script is cut in two: the Watermark's text and the captions are burned before them, and the hook
after. One that is keyed (docs/adr/0008), or comes on or goes off as the hook does (Fade, Pop,
Slide), is drawn by a frame process, as a keyed Overlay is: its picture sampled from its Keyframes,
then faded, scaled and moved by the hook's curves on top (`layer_at`). Without picture layers, the
command is as it was.
"""

import functools
import hashlib
import json
import logging
import math
import os
import shutil
import subprocess
import tempfile
import threading
from collections.abc import Callable, Iterator, Sequence
from contextlib import contextmanager
from dataclasses import replace
from fractions import Fraction
from functools import partial
from pathlib import Path
from typing import Literal, NamedTuple

import numpy as np

from app.ass import ass_alpha, ass_filter, ass_text, ass_time, rounded_box, shadow_tags, spacing, style_colour, tag_colour, tracked
from app.audio_effects import MEASURED_GAIN, NORMALIZE, effect_chain, normalize_gain
from app.config import FONTS_DIR, RenderTuning
from app.encoding import AUDIO_KBPS, Codec, ExportSettings, encoder_args, output_size
from app.fonts import font, registry
from app.frames import FrameFeed, PictureFrames, VideoDecode, graded_image, read_image, shadow_room
from app.grading import grade_filters
from app.video_effects import Clock, changes_with_time, video_effect_chain
from app.ducking import duck_steps
from app.keyframes import linear_steps
from app.segment_time import SegmentTime
from app.planner import (
    HOOK_LEADING,
    AudioEvent,
    SegmentPlan,
    HOOK_PAD_Y,
    AdjustmentEvent,
    Box,
    Cue,
    HookEvent,
    Panel,
    PictureLayout,
    RenderPlan,
    ScenePlan,
    PictureLayer,
    OverlayEvent,
    Picture,
    TransitionEvent,
    WatermarkEvent,
    font_metrics,
    on_frame,
    own_volume,
    picture_at,
)
from app.candidates import BlendMode, Keyframe, Shadow, Shape, TextLayer
from app.scaled_plan import drawn_scale, scaled_plan
from app.transition_kinds import TransitionSound
from app.transitions import RECIPES, Side
from app.styles import Animation, CaptionStyle, DropShadow, Highlight, HookStyle, WatermarkKind, WatermarkStyle

logger = logging.getLogger(__name__)

# The `blend` filter's mode of each Blend Mode but Normal (docs/adr/0014).
BLEND_MODES = {
    BlendMode.MULTIPLY: "multiply", BlendMode.SCREEN: "screen", BlendMode.ADD: "addition",
    BlendMode.LIGHTEN: "lighten", BlendMode.DARKEN: "darken",
}

# The highlight box's padding around its Word, in sizes of the line's font, and its corners' radius,
# unless its Caption Style gives its own.
HIGHLIGHT_PAD_X = 0.12
HIGHLIGHT_PAD_Y = 0.08
HIGHLIGHT_RADIUS = 0.12


# The formats a Clip's sound is saved alone in (`Renderer.render_audio`).
AudioFormat = Literal["wav", "m4a"]


class RenderStopped(RuntimeError):
    """The render was cut short because the app is stopping."""


class _Drawing(NamedTuple):
    """What an encode draws with (Renderer._drawing): the plan at the output's size, the scripts
    burned under and over its picture layers, the Faces they set text in, the Logo, and the keyed
    pictures' items."""

    plan: RenderPlan
    subtitles: Path | None
    above: Path | None
    fonts: Path
    logo: Path | None
    keyed: "dict[Keyed, np.ndarray | Path]"


class Encoded(NamedTuple):
    """What made a Clip: its video encoder, and whether that encoder did VBR where CBR was asked for."""

    encoder: str
    bitrate_fallback: bool


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
        export: ExportSettings = ExportSettings(),
        measured: Path | None = None,
    ) -> Encoded:
        """Write the Clip that `plan` describes to `video` (MP4, fast start) and its poster to `poster`
        (JPEG), encoded as `export` says, and return what made them: the first of its codec's encoders
        (RenderTuning.codec_encoders) that succeeds. The Clip is `export`'s size, the plan drawn at it
        (`scaled_plan`), at the plan's frame rate. `progress` is called with the share of the Clip
        encoded so far, from 0 to 1. `logo` is the PNG of the plan's Logo Watermark, which isn't drawn
        without it; `files` has the file of each Media Library item the plan plays (songs and videos),
        by its id; `pictures` the picture of each of its picture layers at that size
        (app/layer_pictures.py, of `picture_layouts`), by its name.

        Both files are written under temporary names and then renamed, so a Clip that is rendered
        again stays playable until its new files are complete. Raises RenderStopped after `stop()`.
        Its items' Normalize loudness measurements are kept in `measured` (`_levelled`).
        """
        _check(plan)
        files = files or {}
        pictures = pictures or {}
        plan = self._levelled(source, plan, files, measured)
        parts = video.with_name(f".{video.stem}.part{video.suffix}"), poster.with_name(f".{poster.stem}.part{poster.suffix}")
        failures = []
        try:
            with self._drawing(source, plan, video, logo, files, pictures, export) as drawing:
                loudness = None if export.loudness is None else self._measure(source, plan, export.loudness, files)
                for encoder in self.tuning.codec_encoders(export.codec):
                    feeds = _feeds(drawing.plan, drawing.keyed, self.ffmpeg)
                    command = self._command(
                        source, drawing.plan, loudness, encoder, *parts, drawing.subtitles, drawing.logo, files, feeds,
                        drawing.fonts, pictures, drawing.above, export,
                    )
                    stderr = self._run(command, plan.duration, progress, list(feeds.values()))
                    if stderr is None and parts[1].is_file():
                        os.replace(parts[0], video)
                        os.replace(parts[1], poster)
                        return Encoded(encoder, encoder_args(export, plan.fps, encoder).bitrate_fallback)
                    stderr = stderr or "no poster frame was written"
                    logger.warning("Rendering with %s failed: %s", encoder, stderr)
                    failures.append(f"{encoder}: {last_lines(stderr)}")
        finally:
            for part in parts:
                part.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg couldn't render the Clip ({'; '.join(failures)})")

    def frame(
        self,
        source: Path,
        plan: RenderPlan,
        at: float,
        still: Path,
        logo: Path | None = None,
        files: dict[str, Path] | None = None,
        pictures: dict[str, Path] | None = None,
        export: ExportSettings = ExportSettings(),
    ) -> None:
        """Write the frame of the Clip `render` would make that shows at `at` seconds into it
        (`shown_frame`) to `still` (PNG): the same graph at `export`'s size, without the sound. The
        other arguments are `render`'s. It is written under a temporary name and then renamed."""
        _check(plan)
        files = files or {}
        pictures = pictures or {}
        # Between the frame before it and it, which a frame's time rounded either way still selects.
        between = max(0.0, (shown_frame(at, plan.fps, plan.duration) - 0.5) / plan.fps)
        part = still.with_name(f".{still.stem}.part{still.suffix}")
        stderr = None
        try:
            with self._drawing(source, plan, still, logo, files, pictures, export) as drawing:
                feeds = _feeds(drawing.plan, drawing.keyed, self.ffmpeg)
                command = self._command(
                    source, drawing.plan, None, "png", part, part, drawing.subtitles, drawing.logo, files, feeds,
                    drawing.fonts, pictures, drawing.above, export, still_at=between,
                )
                stderr = self._run(command, plan.duration, lambda done: None, list(feeds.values()))
                if stderr is None and part.is_file():
                    os.replace(part, still)
                    return
        finally:
            part.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg couldn't draw the frame at {at:.3f} s ({last_lines(stderr or 'no frame was written')})")

    @contextmanager
    def _drawing(
        self,
        source: Path,
        plan: RenderPlan,
        output: Path,
        logo: Path | None,
        files: dict[str, Path],
        pictures: dict[str, Path],
        export: ExportSettings,
    ) -> Iterator["_Drawing"]:
        """What an encode of `plan` as `export` says draws with: its scripts and Faces written beside
        `output` for as long as the block runs."""
        # The plan at the output's size, which the graph and the frame processes draw; the ASS script
        # is written from the plan in its own pixels, which libass scales to the frame.
        drawn = scaled_plan(plan, output_size(export))
        if missing := [event.layer.id for event in drawn.picture_layers if event.image not in pictures]:
            raise RuntimeError(f"The pictures of picture layers {', '.join(missing)} weren't made")
        # With picture layers, the script is cut in two about them: what they are drawn over, then the hook.
        below, above = (replace(plan, hook=None), replace(plan, captions=[], watermark=None)) if plan.picture_layers else (plan, None)
        scripts = {
            name: (output.with_name(f".{output.stem}.part{suffix}.ass"), script)
            for name, suffix, script in (("below", "", below), ("above", "-above", above))
            if script is not None and (script.captions or script.hook or _text_watermark(script))
        }
        fonts = output.with_name(f".{output.stem}.part.fonts")
        if plan.watermark is None or plan.watermark.kind is not WatermarkKind.LOGO:
            logo = None
        # The keyed pictures' items: an image read once for every encode, a video decoded for each.
        keyed = _keyed_items(drawn, files, source, pictures, self.ffmpeg)
        try:
            if scripts:
                registry().gather(_faces(plan), fonts)
            for path, script in scripts.values():
                path.write_text(_ass(script), encoding="utf-8")
            subtitles, above_script = (scripts[name][0] if name in scripts else None for name in ("below", "above"))
            yield _Drawing(drawn, subtitles, above_script, fonts, logo, keyed)
        finally:
            for path, _ in scripts.values():
                path.unlink(missing_ok=True)
            shutil.rmtree(fonts, ignore_errors=True)

    def render_audio(
        self,
        source: Path,
        plan: RenderPlan,
        audio: Path,
        format: AudioFormat,
        lufs: float | None,
        files: dict[str, Path] | None = None,
        measured: Path | None = None,
    ) -> None:
        """Write the Clip's sound alone to `audio`, mixed as the Clip's own is (the Clip's sound or
        its Segments', its Music Clips and its Overlays' sound) and normalized to `lufs` (left as it is
        without one): a 48 kHz 16-bit WAV, or AAC in an M4A. Nothing of the picture is decoded.
        Written under a temporary name and then renamed, as a Clip's files are. Its items' Normalize
        loudness measurements are kept in `measured` (`_levelled`)."""
        tuning = self.tuning
        files = files or {}
        plan = self._levelled(source, plan, files, measured)
        loudness = None if lufs is None else self._measure(source, plan, lufs, files)
        sources, inputs, _, heard = _sound(plan, source, files, tuning.audio_rate)
        part = audio.with_name(f".{audio.stem}.part{audio.suffix}")
        encode = ["-c:a", "pcm_s16le", "-f", "wav"] if format == "wav" else ["-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k", "-f", "mp4"]
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y", *sources, *inputs,
            "-filter_complex", f"{heard}{_normalized(tuning, lufs, loudness)}[a]",
            "-map", "[a]", "-map_metadata", "-1", *encode, str(part),
        ]
        try:
            result = subprocess.run(command, capture_output=True, text=True, errors="replace")
            if result.returncode:
                raise RuntimeError(f"ffmpeg couldn't render the sound: {last_lines(result.stderr)}")
            os.replace(part, audio)
        finally:
            part.unlink(missing_ok=True)

    def save_sound(self, source: Path, plan: RenderPlan, wav: Path, files: dict[str, Path] | None = None, measured: Path | None = None) -> None:
        """Write the sound of `plan`'s one item to `wav`, 16-bit PCM at the Clip's sample rate in
        stereo, as `_alone_sound` hears it. Nothing is normalized but by its own Normalize loudness,
        whose measurements are kept in `measured` (`_levelled`). Read from the Source, or from its
        video or song in `files`."""
        rate = self.tuning.audio_rate
        files = files or {}
        inputs, heard = _alone_sound(self._levelled(source, plan, files, measured), source, files, rate)
        part = wav.with_name(f".{wav.stem}.part{wav.suffix}")
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y",
            *inputs, "-filter_complex", f"{heard}aresample={rate}[a]", "-map", "[a]",
            "-map_metadata", "-1", "-c:a", "pcm_s16le", "-ar", str(rate), "-ac", "2", "-f", "wav", str(part),
        ]
        result = subprocess.run(command, capture_output=True, text=True, errors="replace")
        if result.returncode:
            part.unlink(missing_ok=True)
            raise RuntimeError(f"ffmpeg couldn't make the sound: {last_lines(result.stderr)}")
        os.replace(part, wav)

    def _levelled(self, source: Path, plan: RenderPlan, files: dict[str, Path], measured: Path | None) -> RenderPlan:
        """`plan` with each Normalize loudness entry of its items' stacks given its gain
        (MEASURED_GAIN, `normalize_gain`): the item's sound up to that entry, alone and before its
        volume, as `_unvolumed` hears it, is measured (`_loudness_of`). A measurement is kept in
        `measured` (made if need be) as a JSON file named by a hash of everything that sound is made
        from (`_measured_key`), and read from there when it is: so the Effected copy, Save sound as
        WAV and the render, which hear an item alike, measure it once, and agree."""
        segments = [
            segment if segment.silent or segment.hold is not None or segment.muted
            else self._item_levelled(source, plan, segment, files, measured)
            for segment in plan.segments
        ]
        audio = [event if event.muted else self._item_levelled(source, plan, event, files, measured) for event in plan.audio]
        return replace(plan, segments=segments, audio=audio)

    def _item_levelled[T: (SegmentPlan, AudioEvent)](
        self, source: Path, plan: RenderPlan, item: T, files: dict[str, Path], measured: Path | None
    ) -> T:
        stack = list(item.audio_effects)
        for i, applied in enumerate(stack):
            if applied.id != NORMALIZE or not applied.enabled or MEASURED_GAIN in applied.params:
                continue
            alone = _unvolumed(plan, replace(item, audio_effects=stack[:i]))
            path = None if measured is None else measured / f"{_measured_key(source, alone, files, self.tuning.audio_rate)}.json"
            if path is not None and path.is_file():
                loudness = json.loads(path.read_text())["lufs"]
            else:
                loudness = self._loudness_of(source, alone, files)
                if path is not None:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    part = path.with_name(f".{path.stem}.{threading.get_ident()}.part")
                    part.write_text(json.dumps({"lufs": loudness}))
                    os.replace(part, path)
            stack[i] = replace(applied, params={**applied.params, MEASURED_GAIN: normalize_gain(loudness, applied.params["target"])})
        return replace(item, audio_effects=stack)

    def _loudness_of(self, source: Path, alone: RenderPlan, files: dict[str, Path]) -> float | None:
        """The integrated loudness, in LUFS, of `alone`'s one item's sound (`_alone_sound`), as
        loudnorm measures it; None for one too quiet or too short to measure, which is left as it is."""
        rate = self.tuning.audio_rate
        inputs, heard = _alone_sound(alone, source, files, rate)
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "info", *inputs,
            "-filter_complex", f"{heard}aresample={rate},loudnorm=print_format=json[measured]", "-map", "[measured]", "-f", "null", "-",
        ]
        result = subprocess.run(command, capture_output=True, text=True, errors="replace")
        output = result.stderr
        if result.returncode or "{" not in output:
            raise RuntimeError(f"ffmpeg couldn't measure the loudness of a sound: {last_lines(output)}")
        loudness = float(json.loads(output[output.rindex("{") : output.rindex("}") + 1])["input_i"])
        return loudness if math.isfinite(loudness) and loudness > _SILENT_LUFS else None

    def stop(self) -> None:
        """Kill the running encode, if any; renders from now on raise RenderStopped."""
        self._stopping.set()
        with self._lock:
            if self._process is not None:
                self._process.kill()

    def _measure(self, source: Path, plan: RenderPlan, lufs: float, files: dict[str, Path] | None = None) -> dict[str, str] | None:
        """loudnorm's measurement of the range's audio, mixed with its music, for normalizing it to
        `lufs`; None when it is silent, with nothing to normalize."""
        tuning = self.tuning
        measure = f"loudnorm=I={lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}:print_format=json"
        sources, inputs, _, heard = _sound(plan, source, files or {}, tuning.audio_rate)
        command = [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "info", *sources, *inputs,
            "-filter_complex", f"{heard}aresample={tuning.audio_rate},{measure}[measured]", "-map", "[measured]", "-f", "null", "-",
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
        export: ExportSettings = ExportSettings(),
        still_at: float | None = None,
    ) -> list[str]:
        """The encode's command: `plan` (drawn at the Clip's size, its width x height) is encoded by
        `encoder` as `export` says, and the sound is normalized to its loudness target from the
        `loudness` measured (left as it is without one). `feeds` are the frame processes of the plan's
        keyed pictures (its Overlays', its keyed Scenes' and its animated picture layers', by their
        places among them); a keyed one without is drawn still, at its constants. `fonts` holds the
        Faces the `subtitles` set text in, burned under the picture layers (drawn from `pictures`, by
        their names), and `above` over them. With `still_at`, only the frame at that time is written,
        to `video` (PNG), and `encoder`, `poster` and the sound are unused."""
        tuning = self.tuning
        feeds = feeds or {}
        # The music's inputs come after the Source's and its videos', and the logo's.
        sources, inputs, songs, heard = _sound(plan, source, files or {}, tuning.audio_rate, between=0 if logo is None else 1)
        count = len(sources) // _INPUT_ARGS
        before_music = count + (1 if logo is not None else 0)
        layers, layered = _overlay_inputs(plan, files or {}, before_music + songs, feeds)
        scene_inputs, drawn = _scene_inputs(plan, before_music + songs + len(layered), feeds)
        picture_inputs, written = _layer_inputs(plan, pictures or {}, before_music + songs + len(layered) + len(drawn), feeds)
        frame = _segmented(plan, tuning, drawn) if plan.segments else _scenes(plan, tuning, keyed=drawn)
        poster_at = min(tuning.poster_secs, plan.duration / 2)
        joined = "[frame]"
        if graded := grade_filters(plan.grade):
            # The Candidate's Grade (docs/adr/0013) over the joined Main Track, the Segments' own Grades
            # and the Transitions drawn; the Overlays come after, never touched by it.
            frame += f";[frame]{graded}[graded]"
            joined = "[graded]"
        if any(feed is not None for _, _, feed in layered + written) or _resampled(plan):
            # At n / fps exactly, the times the Overlays' frame processes draw their frames at; and
            # at another rate than the Source's, the Clip's frames.
            frame += f";{joined}fps={_rate(plan)}[timed]"
            joined = "[timed]"
        for i, (event, number, feed) in enumerate(layered):
            frame += f";{_overlay(event, joined, f'[over{i}]', number, i, feed)}"
            joined = f"[over{i}]"
        for i, event in enumerate(plan.adjustment_layers):
            if adjusted := _adjustment(event, joined, f"[adjusted{i}]", i, (plan.width, plan.height), _rate_value(plan)):
                frame += f";{adjusted}"
                joined = f"[adjusted{i}]"
        if logo is not None and plan.watermark is not None:
            frame += f";{_logo_overlay(plan.watermark, joined, '[marked]', count)}"
            joined = "[marked]"
        # Captions and the hook are burned after the Scenes are joined, so that they follow the Clip's
        # timeline; the picture layers between them.
        if written:
            if subtitles is not None:
                frame += f";{joined}{ass_filter(subtitles, fonts)}[captioned]"
                joined = "[captioned]"
            for i, (event, number, feed) in enumerate(written):
                frame += f";{_picture_layer(event, joined, f'[with_layer{i}]', number, i, feed)}"
                joined = f"[with_layer{i}]"
            subtitles = above
        burned = "" if subtitles is None else f"{ass_filter(subtitles, fonts)},"
        if still_at is not None:
            frame += f";{joined}{burned}format=yuv420p,select='gte(t\\,{still_at:.4f})',trim=end_frame=1[still]"
            return [
                str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y", "-progress", "pipe:1",
                *sources, *([] if logo is None else ["-i", str(logo)]), *inputs, *layers, *scene_inputs, *picture_inputs,
                "-filter_complex", frame, "-map", "[still]", "-frames:v", "1", "-c:v", "png",
                "-f", "image2", "-update", "1", str(video),
            ]
        frame += f";{joined}{burned}format=yuv420p,split=2[v][still];[still]select='gte(t\\,{poster_at:.3f})',trim=end_frame=1[poster]"
        audio = f"{heard}{_normalized(tuning, export.loudness, loudness)}[a]"
        return [
            str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", "-v", "error", "-y", "-progress", "pipe:1",
            *sources, *([] if logo is None else ["-i", str(logo)]), *inputs, *layers, *scene_inputs, *picture_inputs,
            "-filter_complex", f"{frame};{audio}",
            "-map", "[v]", "-map", "[a]", "-map_metadata", "-1", "-map_chapters", "-1",
            *encoder_args(export, plan.fps, encoder).args, "-g", str(max(1, round(plan.fps * tuning.keyframe_secs))),
            "-c:a", "aac", "-b:a", f"{AUDIO_KBPS}k",
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


def shown_frame(at: float, fps: float, duration: float) -> int:
    """The number of the frame of a Clip `duration` long at `fps` that shows at `at` seconds into
    it: the last that starts by then, within the Clip."""
    return max(0, min(math.floor(at * fps + 1e-6), math.ceil(duration * fps - 1e-6) - 1))


def picture_layouts(plan: RenderPlan, export: ExportSettings) -> list[PictureLayout]:
    """The layouts of the pictures a render of `plan` as `export` says draws, rasterised at its size
    (docs/adr/0010, 0021): what to make (app/layer_pictures.py) before the render, which takes them
    by their names."""
    return [event.layout for event in scaled_plan(plan, output_size(export)).picture_layers]


def available_codecs(ffmpeg: Path, tuning: RenderTuning) -> frozenset[Codec]:
    """The codecs `ffmpeg` has at least one of the encoders of."""
    encoders = _encoders(ffmpeg)
    return frozenset(codec for codec in Codec if any(encoder in encoders for encoder in tuning.codec_encoders(codec)))


@functools.cache
def _encoders(ffmpeg: Path) -> frozenset[str]:
    """The names of `ffmpeg`'s encoders, read once per process from its list: a line each after the
    legend, its flags and then its name."""
    result = subprocess.run([str(ffmpeg), "-hide_banner", "-encoders"], capture_output=True, text=True, errors="replace")
    listed = result.stdout.partition("------")[2]
    return frozenset(line.split()[1] for line in listed.splitlines() if len(line.split()) > 1)


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
    the Segments, a Segment's own volume, Speed, fades or Audio Effects, a Muted one, or Transitions,
    each Segment's sound is first played at its Speed (`speed_filters`), through its Audio Effects
    (`effect_chain`, cut at its end), set to its volume (a Source Segment's also to the Clip's own,
    which the mix then leaves) and faded (`_fades`) in one format, and a video without sound, a
    Freeze frame and a Muted Segment give silence."""
    if not plan.segments:
        return [*_range(plan), "-i", str(source)], "", "[0:a:0]"
    inputs = []
    for segment in plan.segments:
        read = files[file] if (file := segment.media or segment.read_from) else source
        span = _HELD_READ_SECS if segment.hold is not None else segment.time.span
        inputs += ["-ss", f"{segment.source_start:.3f}", "-t", f"{span:.3f}", "-i", str(read)]
    count = len(plan.segments)
    plain = all(
        segment.media is None and segment.volume == 1 and segment.speed == 1 and segment.hold is None and not segment.gain
        and not (segment.fade_in or segment.fade_out) and not segment.muted and not segment.audio_effects
        and not segment.video_effects
        for segment in plan.segments
    )
    if plain and not plan.transitions:
        return inputs, "".join(f"[{i}:a:0]" for i in range(count)) + f"concat=n={count}:v=0:a=1[src];", "[src]"
    form = f"aformat=sample_rates={rate}:channel_layouts=stereo"
    chains = []
    for i, segment in enumerate(plan.segments):
        if segment.silent or segment.hold is not None or segment.muted:
            chains.append(f"anullsrc=r={rate}:cl=stereo,atrim=duration={segment.time.length:.3f}[a{i}]")
            continue
        sped = speed_filters(segment.speed, segment.pitch, rate)
        length = round(segment.end - segment.start, 3)
        faded = _fades(segment.fade_in, segment.fade_out, length)
        # Its Audio Effects (docs/adr/0017) after its Speed, cut at its end, before its volume and fades.
        effected = effect_chain(segment.audio_effects, rate, length)
        # Its time on the Timeline from 0 at its start (a Transition's overlap included), which its
        # Keyframes, fades and Audio Effects are in.
        zeroed = [*sped, "asetpts=PTS-STARTPTS", *effected] if segment.gain or faded or effected else sped
        # The Source's at the Clip's own volume too (`own_volume`), a keyed one's after its Keyframes.
        own = own_volume(segment, plan.source_volume)
        if segment.gain:
            volume = [*_volume(segment.gain, segment.volume), *([f"volume={own:g}"] if own != 1 else [])]
        else:
            volume = [f"volume={segment.volume * own:g}"]
        chains.append(f"[{i}:a:0]{','.join([*zeroed, *volume, *faded])},{form}[a{i}]")
    if plan.transitions:
        chains.append(_joins(plan, [f"[a{i}]" for i in range(count)], "a", "[srcv]"))
    else:
        chains.append("".join(f"[a{i}]" for i in range(count)) + f"concat=n={count}:v=0:a=1[srcv]")
    return inputs, ";".join(chains) + ";", "[srcv]"


def _sound(plan: RenderPlan, source: Path, files: dict[str, Path], rate: int, between: int = 0) -> tuple[list[str], list[str], int, str]:
    """The Clip's sound as the encode and the measurement hear it: the input options of the Source
    (`_source_inputs`), those its music reads (`_music_inputs`, after `between` other inputs), how
    many those are, and the filters that mix them (`_audio_mix`), ending with the link the mix is
    heard from, for the filters that follow."""
    sources, sounds, sound = _source_inputs(plan, source, files, rate)
    inputs, reads = _music_inputs(plan, files, len(sources) // _INPUT_ARGS + between, source)
    mix = _audio_mix(plan, reads, rate, sound)
    return sources, inputs, _music_count(reads), f"{sounds}{mix};[mix]" if mix is not None else f"{sounds}{sound}"


def _alone_sound(plan: RenderPlan, source: Path, files: dict[str, Path], rate: int) -> tuple[list[str], str]:
    """The input options and filters of `plan`'s one item's sound, ending with the link it is heard
    from: its one Segment (or its range) heard as the Clip's own sound is (`_source_inputs`, then
    `_audio_mix` without music); or its one sound of `audio`, mixed as the Clip's music is
    (`_music_inputs`, `_audio_mix`) over silence as long as it, in place of the Clip's own sound."""
    if plan.audio:
        [event] = plan.audio
        inputs, reads = _music_inputs(plan, files, 0, source)
        bed = f"anullsrc=r={rate}:cl=stereo,atrim=duration={event.end - event.start:.3f}[bed];"
        return inputs, f"{bed}{_audio_mix(plan, reads, rate, '[bed]')};[mix]"
    inputs, sounds, sound = _source_inputs(plan, source, files, rate)
    mix = _audio_mix(plan, {}, rate, sound)
    return inputs, f"{sounds}{mix};[mix]" if mix is not None else f"{sounds}{sound}"


# Quieter than this (loudnorm's and EBU R 128's absolute gate), a sound is silent: Normalize leaves it.
_SILENT_LUFS = -70.0
# Changed when what a Normalize loudness measurement is of changes for the same key.
_MEASURED_VERSION = 1


def _unvolumed[T: (SegmentPlan, AudioEvent)](plan: RenderPlan, item: T) -> RenderPlan:
    """`plan` with only `item`'s sound, from 0 s, before its volume: at 1, unkeyed, unfaded, unducked,
    not Muted, and a sound of the Source's not at the Clip's own volume."""
    length = round(item.end - item.start, 3)
    bare = replace(plan, segments=[], audio=[], transitions=[], source_volume=1.0)
    level = {"start": 0.0, "end": length, "volume": 1.0, "gain": [], "fade_in": 0.0, "fade_out": 0.0, "muted": False}
    if isinstance(item, SegmentPlan):
        return replace(bare, segments=[replace(item, **level)])
    return replace(bare, audio=[replace(item, **level, duck=None, speech=[], ducked=[])])


def _measured_key(source: Path, alone: RenderPlan, files: dict[str, Path], rate: int) -> str:
    """The name of the Normalize loudness measurement of `alone`'s one sound (`_unvolumed`): a hash of
    everything it is made from: the file it reads and where, its Speed and pitch (a reversed one's
    read forwards from its Retimed copy), its length, the stack before the entry and the sample rate."""
    if alone.segments:
        [segment] = alone.segments
        file = segment.media or segment.read_from
        item: dict = {
            "file": str(files[file] if file else source), "start": segment.source_start, "end": segment.source_end,
            "speed": segment.speed, "pitch": segment.pitch, "reverse": segment.reverse,
        }
    else:
        [event] = alone.audio
        item = {
            "file": str(source if event.media is None else files[event.media]), "offset": event.offset, "span": event.time.span,
            "speed": event.speed, "pitch": event.pitch, "reverse": event.reverse,
        }
    [sound] = alone.segments or alone.audio
    made = {
        "version": _MEASURED_VERSION, "rate": rate, **item, "secs": sound.end - sound.start,
        "effects": [[effect.id, sorted(effect.params.items())] for effect in sound.audio_effects if effect.enabled],
    }
    return hashlib.sha256(json.dumps(made, sort_keys=True).encode()).hexdigest()[:32]


def _normalized(tuning: RenderTuning, lufs: float | None, loudness: dict[str, str] | None) -> str:
    """Filters that take the mix to `lufs` with the `loudness` measured of it (loudnorm's linear
    second pass), at the audio rate; only resampled without either."""
    if lufs is None or loudness is None:
        return f"aresample={tuning.audio_rate}"
    return (
        f"aresample={tuning.audio_rate},loudnorm=I={lufs}:TP={tuning.true_peak_db}:LRA={tuning.loudness_range}"
        f":measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}"
        f":measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}"
        f":offset={loudness['target_offset']}:linear=true,aresample={tuning.audio_rate}"
    )


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
    `out`, one after another: by the Transition at a join (its recipe's xfade, an acrossfade by its
    sound), else back to back."""
    into = {transition.start: transition for transition in plan.transitions}
    chains, joined = [], links[0]
    for i in range(1, len(links)):
        segment = plan.segments[i]
        label = out if i == len(links) - 1 else f"[{kind}j{i}]"
        transition = into.get(segment.start)
        if transition is None:
            chains.append(f"{joined}{links[i]}concat=n=2:v={int(kind == 'v')}:a={int(kind == 'a')}{label}")
        elif kind == "v":
            chains += _crossed(plan, transition, joined, links[i], label, f"x{i}")
        else:
            chains += _sounds_crossed(transition, joined, links[i], label, f"x{i}")
        joined = label
    return ";".join(chains)


# How long each side's sound takes to give way to the other's at the middle of a Cut.
_CUT_SECS = 0.02


def _sounds_crossed(transition: TransitionEvent, outgoing: str, incoming: str, out: str, name: str) -> list[str]:
    """Filters that join the sounds `outgoing` (in seconds into the Clip) and `incoming` (from 0 at its
    start) into `out` by `transition`'s sound: acrossfade's straight lines (its default `tri`), its
    quarter sines (`qsin`), or, for a Cut, each side switched off or on by a short afade at the
    overlap's middle (named after `name`), then summed as they are (`nofade`)."""
    length = transition.length
    if transition.sound == TransitionSound.CUT:
        middle = length / 2 - _CUT_SECS / 2
        return [
            f"{outgoing}afade=t=out:st={transition.start + middle:.3f}:d={_CUT_SECS}[{name}ao]",
            f"{incoming}afade=t=in:st={middle:.3f}:d={_CUT_SECS}[{name}ai]",
            f"[{name}ao][{name}ai]acrossfade=d={length:.3f}:c1=nofade:c2=nofade{out}",
        ]
    curves = ":c1=qsin:c2=qsin" if transition.sound == TransitionSound.EQUAL_POWER else ""
    return [f"{outgoing}{incoming}acrossfade=d={length:.3f}{curves}{out}"]


def _crossed(plan: RenderPlan, transition: TransitionEvent, outgoing: str, incoming: str, out: str, name: str) -> list[str]:
    """Filters that join the pictures `outgoing` (in seconds into the Clip) and `incoming` (from 0 at
    its start) into `out` by `transition`'s recipe: each side through its chain, if it has one, named
    after `name`; then the recipe's xfade."""
    recipe, chains = RECIPES[transition.kind], []
    if recipe.outgoing is not None:
        side = Side(transition.start, False, plan.width, plan.height, f"{name}o")
        chains.append(f"{outgoing}{recipe.outgoing(transition, side)}[{name}o]")
        outgoing = f"[{name}o]"
    if recipe.incoming is not None:
        side = Side(0.0, True, plan.width, plan.height, f"{name}i")
        chains.append(f"{incoming}{recipe.incoming(transition, side)}[{name}i]")
        incoming = f"[{name}i]"
    length = transition.length
    chains.append(f"{outgoing}{incoming}xfade=transition={recipe.xfade}:duration={length:.3f}:offset={transition.start:.3f}{out}")
    return chains


def _segmented(plan: RenderPlan, tuning: RenderTuning, drawn: dict[int, int] | None = None) -> str:
    """The filtergraph that draws a Clip of several Segments into [frame]: each Segment from its own
    input, its Scenes drawn as _scenes draws a Clip's (in seconds into the Segment; a Freeze frame's
    from its first frame, held), then graded (docs/adr/0013) and drawn through its Video Effects
    (docs/adr/0014), and the Segments joined back to back.
    A keyed Scene's picture is the input `drawn` gives by its place among the plan's Scenes, from
    its frame process."""
    chains, first = [], 0
    for i, segment in enumerate(plan.segments):
        scenes = plan.scenes[first : first + segment.scenes]
        keyed = {j: number for j in range(segment.scenes) if (number := (drawn or {}).get(first + j)) is not None}
        first += segment.scenes
        given = f"[{i}:v]"
        if segment.hold is not None:
            given += _held(segment.hold, _rate(plan) if _resampled(plan) else None)
        elif segment.speed != 1:
            # Its frames moved onto the Timeline, then dropped or repeated to the Clip's frame rate:
            # each frame is the last of the video's at or before its time, as a Retimed copy's (a
            # frame landing on one of the Clip's, a thousandth of a frame early against rounding, is that one).
            rate = _rate(plan)
            given += f"settb=AVTB,setpts=(PTS-STARTPTS)/{segment.speed:.6g}-{0.001 / _rate_value(plan):.6g}/TB,fps={rate}:round=up,"
        # Its Grade, then its Video Effects (docs/adr/0014), over its whole frame, before the joins,
        # so that a Transition blends pictures that carry them.
        graded = ",".join([
            *filter(None, [grade_filters(segment.grade)]), *video_effect_chain(segment.video_effects, (plan.width, plan.height), label=f"g{i}fx"),
        ])
        drawn_to = f"[g{i}u]" if graded else f"[g{i}]"
        chains.append(_scenes(plan, tuning, scenes, given, drawn_to, f"g{i}s", segment.start, keyed))
        if graded:
            chains.append(f"{drawn_to}{graded}[g{i}]")
    count = len(plan.segments)
    if not plan.transitions and not _resampled(plan):
        chains.append("".join(f"[g{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0[frame]")
        return ";".join(chains)
    if not plan.transitions:
        # At another rate than the Source's, each Segment is brought to it first, so that the cuts
        # are on the Clip's frames.
        chains += [f"[g{i}]fps={_rate(plan)},settb=AVTB,format=yuv420p[n{i}]" for i in range(count)]
        chains.append("".join(f"[n{i}]" for i in range(count)) + f"concat=n={count}:v=1:a=0[frame]")
        return ";".join(chains)
    # xfade takes pictures of one frame rate and time base.
    chains += [f"[g{i}]fps={_rate(plan)},settb=AVTB,format=yuv420p[n{i}]" for i in range(count)]
    chains.append(_joins(plan, [f"[n{i}]" for i in range(count)], "v", "[frame]"))
    return ";".join(chains)


def _held(hold: float, rate: str | None = None) -> str:
    """Filters that make a Freeze frame's picture of its input: the first frame, held `hold` seconds
    (in frames of `rate`, when given, else of its input's)."""
    timed = "" if rate is None else f"fps={rate},"
    return f"trim=end_frame=1,setpts=PTS-STARTPTS,{timed}tpad=stop_mode=clone:stop_duration={hold:.3f},trim=duration={hold:.3f},"


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
    picture = on_frame(scene.picture, (plan.width, plan.height))
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
        # Blurred small and scaled up: cheaper than blurring the full size, and as smooth. Shrunk by
        # the plan's scale too, so that the blur is the same at every output size.
        shrink = tuning.blur_shrink * drawn_scale(plan)
        small_width, small_height = (max(2, round(side / shrink / 2) * 2) for side in (area.width, area.height))
        drawn += (
            f"scale={small_width}:{small_height},gblur=sigma={tuning.blur_sigma},"
            f"eq=brightness={tuning.blur_brightness},scale={area.width}:{area.height}"
        )
    else:
        drawn += f"scale={area.width}:{area.height}:flags=lanczos"
    return drawn + ",setsar=1"


# Where a sound of the plan's audio is read: its input's number, and how far into that input its part starts.
Read = tuple[int, float]


def _music_inputs(plan: RenderPlan, music: dict[str, Path], first: int, source: Path) -> tuple[list[str], dict[int, Read]]:
    """The input options of what the plan's music plays, numbered from `first`: each song once,
    whole; and for each Music Clip of the Source, the Source (`source`) from its offset for its read,
    as a Segment's is, so that a long episode isn't decoded from its start. And where each sound of
    the plan's audio is read, by its place there; one of a song not in `music` isn't heard. A Muted
    sound is left out of the mix, and so is a song only it plays."""
    inputs: list[str] = []
    songs: dict[str, int] = {}
    reads: dict[int, Read] = {}
    count = 0
    for i, event in enumerate(plan.audio):
        if event.muted:
            continue
        if event.media is None:
            reads[i] = (first + count, 0.0)
            inputs += ["-ss", f"{event.offset:.3f}", "-t", f"{event.time.span:.3f}", "-i", str(source)]
            count += 1
        elif event.media in music:
            if event.media not in songs:
                songs[event.media] = first + count
                inputs += ["-i", str(music[event.media])]
                count += 1
            reads[i] = (songs[event.media], event.offset)
    return inputs, reads


def _music_count(reads: dict[int, Read]) -> int:
    """How many inputs the music reads (`_music_inputs`): each is read by a sound at least."""
    return len({number for number, _ in reads.values()})


def _audio_mix(plan: RenderPlan, reads: dict[int, Read], rate: int, source: str = "[0:a:0]") -> str | None:
    """Filters that mix the Clip's sound (the link `source`), at its volume, with its music into
    [mix]: each sound its part of what it reads (`reads`, by its place in the plan's audio), played
    at its Speed (`speed_filters`), through its Audio Effects (`effect_chain`, cut at its end), at
    its volume (a Music Clip of the Source's at the Clip's own too, as a Segment of it is) ducked
    under its speech (`duck_steps`), faded, delayed to its start.
    None without music at the Clip's own volume, where the sound goes as it is. The loudness passes
    hear the mix after ducking."""
    heard = [(event, reads[i]) for i, event in enumerate(plan.audio) if i in reads]
    # Segments' sounds set to their volumes already (with videos among them) aren't set again.
    volume = 1.0 if source == "[srcv]" else plan.source_volume
    if not heard and volume == 1:
        return None
    if not heard:
        return f"{source}volume={volume:g}[mix]"
    form = f"aformat=sample_rates={rate}:channel_layouts=stereo"
    chains = [f"{source}volume={volume:g},{form}[m0]"]
    for i, (event, (number, at)) in enumerate(heard, 1):
        length = round(event.end - event.start, 3)
        read = round(event.time.span, 3)
        sped = speed_filters(event.speed, event.pitch, rate)
        # The Source's at the Clip's own volume too (a keyed one's after its Keyframes, as a Segment's).
        own = own_volume(event, plan.source_volume)
        duck = duck_steps(event.speech_spans, event.duck, plan.ducking, event.start) if event.duck is not None else []
        if event.gain:
            level = [*_volume(event.gain, event.volume, duck), *([f"volume={own:g}"] if own != 1 else [])]
        else:
            level = _volume(event.gain, event.volume * own, duck)
        filters = [
            f"atrim=start={at:g}:end={at + read:g}", "asetpts=PTS-STARTPTS",
            # Then its time on the Timeline from 0 at its start, which its Keyframes and fades are in.
            *([*sped, "asetpts=PTS-STARTPTS"] if sped else []), *effect_chain(event.audio_effects, rate, length), *level,
            *_fades(event.fade_in, event.fade_out, length), f"adelay={round(event.start * 1000)}:all=1",
        ]
        chains.append(f"[{number}:a:0]{','.join(filters)},{form}[m{i}]")
    labels = "".join(f"[m{i}]" for i in range(len(heard) + 1))
    # The Clip's length is its own sound's; nothing is turned down to make room (normalize=0).
    chains.append(f"{labels}amix=inputs={len(heard) + 1}:duration=first:normalize=0[mix]")
    return ";".join(chains)


def _fades(fade_in: float, fade_out: float, length: float) -> list[str]:
    """Filters that fade a sound `length` seconds long, its time from 0 at its start, linearly in
    over `fade_in` seconds and out over `fade_out` to its end."""
    return [
        *([f"afade=t=in:st=0:d={fade_in:g}"] if fade_in else []),
        *([f"afade=t=out:st={length - fade_out:g}:d={fade_out:g}"] if fade_out else []),
    ]


# A keyed volume is worked out afresh for every block of this many samples (10 ms at 48 kHz).
_GAIN_BLOCK = 480


def _volume(gain: Sequence[Keyframe], volume: float, duck: Sequence[tuple[float, float]] = ()) -> list[str]:
    """Filters that set a sound to `volume`, or to its `gain` track (its volume Keyframes, in its own
    seconds, where its time starts at 0) when it has one, times its `duck` (the points of a ducked
    one's, `duck_steps`, in the same seconds) when it has one: straight lines between points of each
    curve (`linear_steps`, an eased span in 24), summed as one clipped ramp each, with no nesting,
    the two multiplied, evaluated per block of _GAIN_BLOCK samples."""
    if not gain and not duck:
        return [f"volume={volume:g}"]
    level = _ramps(linear_steps(gain)) if gain else f"{volume:.6g}"
    expression = f"({level})*({_ramps(duck)})" if duck else level
    return [f"asetnsamples=n={_GAIN_BLOCK}:p=0", f"volume=volume='{expression}':eval=frame"]


def _ramps(points: Sequence[tuple[float, float]]) -> str:
    """An expression of `t` that follows straight lines between `points` (time, value), holding the
    first's value before it and the last's after it: one clipped ramp for each change."""
    terms = [f"{points[0][1]:.6g}"]
    for (start, before), (end, after) in zip(points, points[1:]):
        if after != before and end > start:
            # A duck's lead may start before the sound does: t + 0.15 rather than t - -0.15.
            terms.append(f"{after - before:+.6g}*clip((t{-start:+.6g})/{end - start:.6g},0,1)")
    return "".join(terms)


def _overlay_inputs(
    plan: RenderPlan, files: dict[str, Path], first: int, feeds: "Feeds"
) -> tuple[list[str], list[tuple[OverlayEvent, int, FrameFeed | None]]]:
    """The input options of the plan's Overlays, one each, numbered from `first` (a video read from its
    offset for as long as it shows times its Speed; an image's one picture, or for as long as it shows
    at the Clip's frame rate when an effect of it changes with time (`_looped`); a keyed one's frames,
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
            elif _looped(event):
                inputs += ["-loop", "1", "-framerate", _rate(plan), "-t", f"{event.end - event.start:.3f}"]
            inputs += ["-i", str(files[event.media])]
        drawn.append((event, first + len(drawn), feed))
    return inputs, drawn


def _overlay(event: OverlayEvent, below: str, out: str, index: int, number: int, feed: FrameFeed | None = None) -> str:
    """Filters that draw an Overlay (input `index`) as its Picture over the frames `below` while it
    shows, into `out`: a video's frames moved to start when it does and timed by its Speed, an
    image's one picture held (or its looped frames moved to start when it does, `_looped`), graded after it is scaled and flipped and then drawn through its Video
    Effects (docs/adr/0014), at its drawn size. A keyed one's frames, drawn whole
    (graded and effected) by its frame process `feed`, are laid at 0, 0, each over the frame of its number (the
    frames below being at n / fps exactly)."""
    shows = f"enable='between(t\\,{event.start:.3f}\\,{event.end:.3f})'"
    if feed is not None:
        name = f"layer{number}"
        return f"[{index}:v]setpts=PTS-STARTPTS+{feed.first}[{name}];" + _laid(below, name, "0:0", f"{shows}:eof_action=pass", out, event.blend, shows)
    held = event.image and not _looped(event)
    played = "PTS-STARTPTS" if event.speed == 1 or event.image else f"(PTS-STARTPTS)/{event.speed:.6g}"
    timed = "" if held else f",setpts={played}+{event.start:.3f}/TB"
    ends = "repeat" if held else "pass"
    graded = grade_filters(event.grade, alpha=f"layer{number}g")
    # Its effects come before its frames are moved onto the Timeline: a video's are its video's, from
    # its offset, before its Speed.
    clock = Clock(rate=1 if event.image else 1 / event.speed)
    chain = video_effect_chain(event.video_effects, (event.picture.width, event.picture.height), label=f"layer{number}fx", clock=clock)
    effected = ",".join([*([graded] if graded else []), *chain])
    return _picture(
        event.picture, f"[{index}:v]", below, out, f"layer{number}", timed, f"{shows}:eof_action={ends}", effected, event.blend, shows
    )


def _looped(event: OverlayEvent) -> bool:
    """Whether an image Overlay is read as a stream of its frames over its span rather than once: an
    effect of it changes with time (docs/adr/0014), so that its grain moves."""
    return event.image and changes_with_time(event.video_effects)


def _adjustment(event: AdjustmentEvent, below: str, out: str, index: int, size: tuple[int, int], fps: float = 30) -> str:
    """Filters that lay an Adjustment Layer over the frames `below` (the Main Track and the Overlays,
    `size` large, `fps` frames a second) into `out` (docs/adr/0013): the stream split, its frames
    graded and drawn through its Video Effects (docs/adr/0014), given an alpha of its strength times
    its fade ramp (`fade` on the alpha alone, its times those of the Clip) and laid back over the
    frames as they were, only within its span. Outside its span the grade and the alpha pass the
    frames through untouched (`enable`). Its effects, whose filters can't all take `enable`, get its
    span's frames alone (`_spanned`). "" when it changes nothing (a neutral Grade and no enabled
    effects, or strength 0)."""
    span = f"between(t\\,{event.start:.3f}\\,{event.end:.3f})"
    effects = video_effect_chain(event.video_effects, size, enable=span, label=f"adjust{index}fx", clock=Clock(event.start))
    graded = ",".join([*filter(None, [grade_filters(event.grade, enable=span)]), *effects])
    if not graded or event.strength <= 0:
        return ""
    name = f"adjust{index}"
    # Straight to the 4:2:0 with alpha the overlay draws, the alpha scaled by a table.
    ramp = ["format=yuva420p"]
    if event.strength < 100:
        ramp.append(f"lut=a='val*{event.strength / 100:.6f}':enable='{span}'")
    if event.fade_in:
        ramp.append(f"fade=t=in:st={event.start:.3f}:d={event.fade_in:.3f}:alpha=1:enable='{span}'")
    if event.fade_out:
        ramp.append(f"fade=t=out:st={event.end - event.fade_out:.3f}:d={event.fade_out:.3f}:alpha=1:enable='{span}'")
    cut, padded = _spanned(event, span, fps) if effects else ([], [])
    return (
        f"{below}split[{name}a][{name}b];"
        f"[{name}b]{','.join([*cut, graded, *ramp, *padded])}[{name}g];"
        f"[{name}a][{name}g]overlay=0:0:enable='{span}':eof_action=pass{out}"
    )


def _spanned(event: AdjustmentEvent, span: str, fps: float) -> tuple[list[str], list[str]]:
    """The filters before and after an Adjustment Layer's effects that keep them to its `span`'s
    frames (docs/adr/0014), each at its own time, so that a chain with labels runs there alone. The
    frames before it are dropped (`select`, as `enable` picks them) and those after it end the branch
    (`trim`, then the overlay passes the rest). The overlay waits for the branch's next frame, so the
    dropped ones are stood in for by transparent frames from the Clip's start (`tpad`), set back
    before the span's (their `setpts` undoes the shift `tpad` gives the rest): a branch that sent
    nothing until its span would hold back every frame before it."""
    cut = [f"trim=end={event.end + 0.5 / fps:.6f}", f"select='{span}'"]
    pads = max(0, math.floor(event.start * fps) - 2)
    if not pads:
        return cut, []
    shifted = f"setpts='if(lt(N\\,{pads})\\,PTS\\,PTS-{pads}/(FRAME_RATE*TB))'"
    return cut, [f"tpad=start={pads}:color=black@0", shifted]


def _layer_inputs(
    plan: RenderPlan, pictures: dict[str, Path], first: int, feeds: "Feeds"
) -> tuple[list[str], list[tuple[PictureLayer, int, FrameFeed | None]]]:
    """The input options of the plan's picture layers, one each, numbered from `first` (its picture,
    or an animated one's frames, from the pipe of its frame process in `feeds`), and each picture
    layer with its input's number and its frame process."""
    inputs: list[str] = []
    drawn = []
    for i, event in enumerate(plan.picture_layers):
        feed = feeds.get(("layer", i))
        inputs += _piped(plan, feed) if feed is not None else ["-i", str(pictures[event.image])]
        drawn.append((event, first + i, feed))
    return inputs, drawn


def _picture_layer(event: PictureLayer, below: str, out: str, index: int, number: int, feed: FrameFeed | None = None) -> str:
    """Filters that draw a picture layer (input `index`) as its picture over the frames `below` while it
    shows, into `out`: its one picture held, or an animated one's frames, drawn whole by its frame
    process `feed`, laid at 0, 0. An unturned picture whose corner is at an odd pixel is padded by a
    transparent one, since an overlay onto 4:2:0 frames moves a picture to the even pixel before."""
    shows = f"enable='between(t\\,{event.start:.3f}\\,{event.end:.3f})'"
    name = f"layer_picture{number}"
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


# What is animated as the hook is: the hook in its style, a picture layer in its item's, or an Overlay
# in its own.
type _Shown = HookEvent | PictureLayer | OverlayEvent
type _Motion = HookStyle | TextLayer | Shape | OverlayEvent


def layer_at(event: PictureLayer, time: float, drawn: float = 1.0) -> Picture:
    """A picture layer's picture as drawn at `time` seconds into the Clip, animated by its item's
    animations (`animated_at`), in a plan drawn `drawn` times its size."""
    return animated_at(event, event.layer, event.picture, time, drawn)


def overlay_at(event: OverlayEvent, time: float, drawn: float = 1.0) -> Picture:
    """An Overlay's picture as drawn at `time` seconds into the Clip, animated as a picture layer is
    (`animated_at`), in a plan drawn `drawn` times its size."""
    return animated_at(event, event, event.picture, time, drawn)


def animated_at(shown: _Shown, style: _Motion, picture: Picture, time: float, drawn: float = 1.0) -> Picture:
    """`picture`, of an item shown from `shown`'s start to its end and animated as `style` says, as
    drawn at `time` seconds into the Clip: as its Keyframes have it then (`picture_at`), and on top
    of that faded, scaled about its centre (its corners with it) and moved down as its animations
    have it (`animation_at`): its keyed opacity and scale multiplied, its drop added, `drawn` times
    as far for a plan drawn at another size (`drawn_scale`)."""
    opacity, scale, below = animation_at(shown, style, time)
    picture = picture_at(picture, time)
    if (opacity, scale, below) == (1.0, 1.0, 0.0):
        return picture
    x, y = picture.centre
    return replace(
        picture,
        width=picture.width * scale,
        height=picture.height * scale,
        radius=picture.radius * scale,
        centre=(x, y + below * drawn),
        opacity=picture.opacity * opacity,
    )


def animation_at(shown: _Shown, style: _Motion, time: float) -> tuple[float, float, float]:
    """An item's opacity, scale and how far below its place it is at `time` seconds into the Clip,
    coming on and going off as the hook does (_hook_phases, _hook_motion): faded in and out over its
    animation_ms (Fade alone), or for _hook_ends' time grown from POP_FROM percent (Pop) or risen
    SLIDE_PX (Slide) as it fades, each in a straight line. The preview's twin is hookLook in
    frontend/src/pages/job/editor/animation.ts."""
    moving = {Animation.POP, Animation.SLIDE}
    if style.animation_in not in moving and style.animation_out not in moving:
        ms = style.animation_ms / 1000
        on = (time - shown.start) / ms if style.animation_in == Animation.FADE else 1.0
        off = (shown.end - time) / ms if style.animation_out == Animation.FADE else 1.0
        return min(max(min(on, off), 0.0), 1.0), 1.0, 0.0
    on, off = _hook_ends(shown, style)
    if on and time < shown.start + on:
        return _animated(style.animation_in, (time - shown.start) / on)
    if off and time >= shown.end - off:
        return _animated(style.animation_out, (shown.end - time) / off)
    return 1.0, 1.0, 0.0


def _animated(animation: Animation, shown: float) -> tuple[float, float, float]:
    """The opacity, scale and drop of an element `shown` of the way on by `animation`."""
    shown = min(max(shown, 0.0), 1.0)
    if animation == Animation.POP:
        return shown, (POP_FROM + (100 - POP_FROM) * shown) / 100, 0.0
    if animation == Animation.SLIDE:
        return shown, 1.0, SLIDE_PX * (1 - shown)
    return shown, 1.0, 0.0


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
    """The input options that read a frame process's frames (of the Clip's size) from its pipe, at
    the Clip's frame rate."""
    return [
        "-f", "rawvideo", "-pixel_format", "rgba", "-video_size", f"{plan.width}x{plan.height}", "-framerate", _rate(plan),
        "-i", f"pipe:{feed.fd}",
    ]


# The NTSC rates, as the Export Settings name them, and as they are: so many thousand frames in 1001 s.
_NTSC_RATES = {23.976: "24000/1001", 29.97: "30000/1001", 59.94: "60000/1001"}


def _rate(plan: RenderPlan) -> str:
    """The Clip's frame rate, as the frame processes and the frames they are laid over keep it: an
    NTSC one exactly."""
    fps = plan.fps if plan.fps > 0 else 30
    return _NTSC_RATES.get(fps, f"{fps:.6g}")


def _rate_value(plan: RenderPlan) -> float:
    """The Clip's frame rate in frames a second, exactly as `_rate` gives it to ffmpeg."""
    return float(Fraction(_rate(plan)))


def _resampled(plan: RenderPlan) -> bool:
    """Whether the Clip is planned at another frame rate than its Source's (docs/adr/0021): its
    Segments, and then its frames, are brought to it, the Source's frames repeated or dropped."""
    return plan.fps != plan.source_fps


# A keyed picture of the plan: ("overlay", a keyed or animated Overlay's place among them), ("scene", its Scene's
# place among the Scenes) or ("layer", a keyed or animated picture layer's place among the plan's);
# and each one's frame process.
Keyed = tuple[str, int]
Feeds = dict[Keyed, FrameFeed]


def _keyed_items(
    plan: RenderPlan, files: dict[str, Path], source: Path, pictures: dict[str, Path] | None = None, ffmpeg: Path | None = None
) -> dict[Keyed, np.ndarray | Path]:
    """The items of the plan's keyed pictures that are in `files`, which their frame processes draw:
    a keyed or animated Overlay's image's pixels (graded once by `ffmpeg` by its Grade and drawn
    through its Video Effects), or a video's file (such an Overlay's or a keyed Segment's, or an
    Overlay's image whose effect changes with time, `_looped`), or the `source` for a Manual Scene; and a
    keyed or animated picture layer's picture's pixels, from `pictures`."""
    items: dict[Keyed, np.ndarray | Path] = {}
    for i, event in enumerate(plan.overlays):
        if not (_comes_animated(event) or event.picture.motion) or event.media not in files:
            continue
        if not event.image or _looped(event):
            items[("overlay", i)] = files[event.media]
            continue
        image = read_image(files[event.media])
        graded = grade_filters(event.grade, alpha="g")
        if (graded or event.video_effects) and ffmpeg is not None:
            image = graded_image(ffmpeg, image, event.picture, graded, event.video_effects)
        items[("overlay", i)] = image
    for i, (media, _) in _keyed_scenes(plan).items():
        if media is None:
            items[("scene", i)] = source
        elif media in files:
            items[("scene", i)] = files[media]
    for i, event in enumerate(plan.picture_layers):
        if (_comes_animated(event.layer) or event.picture.motion) and pictures and event.image in pictures:
            items[("layer", i)] = read_image(pictures[event.image])
    return items


def _comes_animated(style: _Motion) -> bool:
    """Whether an item (a picture layer's, or an Overlay) comes on or goes off animated, so that a
    frame process draws it."""
    return style.animation_in != Animation.NONE or style.animation_out != Animation.NONE


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
    """A frame process for each keyed picture whose item is in `items`, over its span, drawing frames
    of the Clip's size: an image's pixels drawn, a video's frames decoded by `ffmpeg` (`VideoDecode`,
    an Overlay's graded by its Grade and drawn through its Video Effects; a Segment's is graded and
    effected with its whole frame, `_segmented`) and drawn. A Scene's are drawn in seconds into the Scene, its frame n at n / fps from its start,
    as the Scene's own frames are once brought to the Clip's frame rate (`_keyed_scene`)."""
    rate = _rate_value(plan)
    frame, drawn = (plan.width, plan.height), drawn_scale(plan)
    scenes = _keyed_scenes(plan)
    layers = plan.picture_layers
    feeds = {}
    for (kind, i), item in items.items():
        if kind == "scene":
            scene = plan.scenes[i]
            assert scene.picture is not None and isinstance(item, Path)
            picture = _later(scene.picture, -scene.start)
            length = scene.end - scene.start
            video = VideoDecode(ffmpeg, item, picture, 0.0, length, scenes[i][1], rate)
            feeds[(kind, i)] = FrameFeed(PictureFrames(picture, frame=frame), 0.0, length, rate, video)
            continue
        if kind == "layer":
            layer = layers[i]
            assert isinstance(item, np.ndarray)
            frames = PictureFrames(layer.picture, item, frame, lambda time, layer=layer: layer_at(layer, time, drawn))
            feeds[(kind, i)] = FrameFeed(frames, layer.start, layer.end, rate)
            continue
        event = plan.overlays[i]
        sampled = partial(overlay_at, event, drawn=drawn)
        if isinstance(item, Path):
            # An Overlay's video plays forwards from its offset at its Speed for as long as it shows; a
            # looped image's one picture is read over its span.
            frames = PictureFrames(event.picture, frame=frame, sampled=sampled)
            video = VideoDecode(
                ffmpeg, item, event.picture, event.start, event.end, event.time, rate, grade_filters(event.grade, alpha="g"), event.video_effects,
                looped=event.image,
            )
        else:
            frames, video = PictureFrames(event.picture, item, frame, sampled), None
        feeds[(kind, i)] = FrameFeed(frames, event.start, event.end, rate, video)
    return feeds


def _later(picture: Picture, by: float) -> Picture:
    """A keyed `picture` with its motion `by` seconds later."""
    return replace(picture, motion={prop: [replace(key, at=key.at + by) for key in keys] for prop, keys in picture.motion.items()})


def _picture(
    picture: Picture, source: str, below: str, out: str, name: str, after: str = "", laid: str = "", graded: str = "",
    blend: BlendMode = BlendMode.NORMAL, shows: str = "",
) -> str:
    """Filters that draw `picture` of the frames `source` over the frames `below`, into `out`, in the
    order of docs/adr/0007: crop, scale, flip, the filters `graded` (an Overlay's Grade, docs/adr/0013,
    then its Video Effects, docs/adr/0014),
    corners and border (`_corners`), rotate with a transparent fill, shadow (`_shadow`), opacity, then
    laid over at its centre. Steps that change nothing are left out. `after` is more filters of the
    picture's own frames, `laid` more options of the overlay; its own frames are labelled `name`.
    An Overlay's `blend` other than Normal lays it by its Blend Mode while it `shows` (`_laid`)."""
    crop = picture.crop
    steps = [] if (crop.width, crop.height) == picture.item_size else [f"crop={crop.width}:{crop.height}:{crop.x}:{crop.y}:exact=1"]
    steps.append(f"scale={picture.width}:{picture.height}:flags=lanczos")
    steps += ["hflip"] * picture.flip_h + ["vflip"] * picture.flip_v
    if graded:
        steps.append(graded)
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
    return f"{source}{','.join(steps)}{after}[{name}];" + _laid(below, name, at, laid, out, blend, shows)


def _laid(below: str, name: str, at: str, laid: str, out: str, blend: BlendMode = BlendMode.NORMAL, shows: str = "") -> str:
    """Filters that lay the frames `name` over the frames `below` at `at`, with more options `laid` of
    the overlay, into `out`. Normal covers what is under them by their alpha. Another Blend Mode
    (docs/adr/0014): they are padded to the frame with transparency (laid over a transparent copy of
    `below`: over a main of alpha 0, `overlay` takes their own colour wherever they have any alpha,
    so `below`'s colour isn't in it and is counted once), their colour is blended over `below` by the mode in planar RGB while they `shows`, and
    that is masked by their alpha and laid over `below`, so that the frame outside their alpha and
    span stays as it was. A `scale` before each change of format keeps `below`'s own format: `split`
    gives every branch the same one."""
    if blend is BlendMode.NORMAL:
        return f"{below}[{name}]overlay={at}{':' if laid else ''}{laid}{out}"
    return (
        f"{below}split=3[{name}under][{name}base][{name}clear];[{name}clear]scale,format=rgba,colorchannelmixer=aa=0[{name}canvas]"
        f";[{name}canvas][{name}]overlay={at}:format=rgb{':' if laid else ''}{laid},format=gbrap,split[{name}top][{name}cut]"
        f";[{name}base]scale,format=gbrap[{name}bottom];[{name}bottom][{name}top]blend=all_mode={BLEND_MODES[blend]}:{shows}[{name}mixed]"
        f";[{name}cut]alphaextract[{name}mask];[{name}mixed][{name}mask]alphamerge[{name}blended]"
        f";[{name}under][{name}blended]overlay=0:0:{shows}{out}"
    )


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
    for each Word of each Cue, while that Word is highlighted, and the hook's (_hook_events).
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
        f"Style: Hook,{font(hook.font).family},{hook.size},{style_colour(hook.colour)},{style_colour(hook.colour)},"
        f"{style_colour(hook.outline_colour)},{_back_colour(hook.shadow)},0,0,0,0,100,100,0,0,1,"
        f"{hook.outline},{_plain_shadow(hook.shadow):g},5,0,0,0,1",
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
    text, edge, shadow = style_colour(style.colour), style_colour(style.outline_colour), _back_colour(style.shadow)
    return (
        f"Style: Caption,{font(style.font).family},{style.size},{text},{text},{edge},{shadow},0,0,0,0,100,100,0,0,1,"
        f"{style.outline},{_plain_shadow(style.shadow):g},5,0,0,0,1"
    )


def _plain_shadow(shadow: DropShadow) -> float:
    """How far right and down libass draws the shadow of a caption or hook line as its own (\\shad):
    when it is on, unblurred and at 45°, as these styles' shadows were before drop shadows. 0
    otherwise: none, or one drawn as its own events (_drawn_shadow)."""
    x, y = shadow.offset
    return x if shadow.on and not shadow.blur and x == y > 0 else 0.0


def _drawn_shadow(shadow: DropShadow) -> DropShadow | None:
    """The shadow of a caption or hook line when it is drawn as an event of its own under the line
    (with shadow_tags): one that is on and not a plain \\shad (blurred, or at another angle)."""
    return shadow if shadow.on and not _plain_shadow(shadow) else None


def _back_colour(shadow: DropShadow) -> str:
    """An ASS style's BackColour, the colour of its \\shad: the shadow's, at its opacity when drawn so."""
    return style_colour(shadow.colour, shadow.opacity if _plain_shadow(shadow) else 1.0)


def _watermark_style(style: WatermarkStyle) -> str:
    text, edge = style_colour(style.colour), style_colour("#000000")
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
    return f"Dialogue: 0,{ass_time(0)},{ass_time(duration)},Watermark,,0,0,0,,{{{place}}}{ass_text(event.text)}"


def _caption_events(event: Cue, style: CaptionStyle) -> list[str]:
    """A Cue's Dialogue events, its lines one under another: one per Word, while it is highlighted,
    showing the whole Cue with that Word in the active colour (Colour), the Cue as it is over a box
    of the active colour behind the Word (Box), or the Cue as it is for the whole Cue's time (None).
    A shadow that isn't the style's plain one (_drawn_shadow) is the Cue again under each of these,
    over the box."""
    area = event.area
    centre_x, centre_y = area.x + area.width / 2, area.y + area.height / 2
    sized = (f"\\fs{event.size:g}" if event.size != style.size else "") + spacing(style.tracking)
    place = f"\\pos({tracked(centre_x, style.tracking):g},{centre_y:g})" + sized
    shadow = _drawn_shadow(style.shadow)

    def shown(active: int | None = None) -> str:
        # Its lines, the Word `active` (counted across them) in the active colour.
        words = iter(range(len(event.words)))
        return "\\N".join(
            " ".join(
                f"{{\\c{tag_colour(style.active_colour)}}}{ass_text(word.text)}{{\\c{tag_colour(style.colour)}}}"
                if next(words) == active else ass_text(word.text)
                for word in line
            )
            for line in event.lines
        )

    plain = shown()

    def shadowed(layer: int, start: str, end: str) -> list[str]:
        if shadow is None:
            return []
        dx, dy = shadow.offset
        under = f"\\pos({tracked(centre_x, style.tracking) + dx:g},{centre_y + dy:g}){sized}{shadow_tags(shadow, style.outline)}"
        return [f"Dialogue: {layer},{start},{end},Caption,,0,0,0,,{{{under}}}{plain}"]

    if style.highlight is Highlight.NONE:
        start, end = ass_time(event.start), ass_time(event.end)
        return [*shadowed(0, start, end), f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{{place}}}{plain}"] if start < end else []
    events = []
    for i, word in enumerate(event.words):
        start, end = ass_time(word.start), ass_time(word.end)
        if start >= end:
            continue
        if style.highlight is Highlight.BOX:
            events.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{_highlight_box(event, i, style)}")
            events.extend(shadowed(1, start, end))
            events.append(f"Dialogue: 1,{start},{end},Caption,,0,0,0,,{{{place}}}{plain}")
            continue
        events.extend(shadowed(0, start, end))
        events.append(f"Dialogue: 0,{start},{end},Caption,,0,0,0,,{{{place}}}{shown(i)}")
    return events


def _highlight_box(event: Cue, index: int, style: CaptionStyle) -> str:
    """An ASS drawing of the box behind the Cue's Word `index` (counted across its lines): the Word's
    width (measured like its line, from the centred line's left edge, with its tracking) and the
    capitals' height, padded, with rounded corners (_highlight_shape)."""
    metrics, size, tracking = font_metrics(style.font), event.size, style.tracking
    row = 0
    while index >= len(event.lines[row]):
        index -= len(event.lines[row])
        row += 1
    words = [word.text for word in event.lines[row]]
    line = metrics.width(" ".join(words), size, tracking)
    before = " ".join(words[:index]) + (" " if index else "")
    before = metrics.width(before, size) + tracking * len(before)
    word = metrics.width(words[index], size, tracking)
    pad_x, pad_y, radius = _highlight_shape(style, size)
    area = event.area
    # The lines are centred on the area's middle, each as tall as the font size: a line's letters'
    # vertical middle is where the middle of its ascent-plus-descent box is, and capitals sit on the
    # baseline below the ascent's top.
    middle = area.y + area.height / 2 + (row - (len(event.lines) - 1) / 2) * size
    baseline = middle - size / 2 + metrics.ascent / metrics.units * size
    cap = metrics.cap_height / metrics.units * size
    left = area.x + area.width / 2 - line / 2 + before - pad_x
    top = baseline - cap - pad_y
    width, height = round(word + 2 * pad_x), round(cap + 2 * pad_y)
    return (
        f"{{\\an7\\pos({left:.1f},{top:.1f})\\p1\\bord0\\shad0\\c{tag_colour(style.active_colour)}}}"
        f"{rounded_box(width, height, min(round(radius), height // 2))}{{\\p0}}"
    )


def _highlight_shape(style: CaptionStyle, size: float) -> tuple[float, float, float]:
    """The highlight box's padding across and down and its corners' radius on a line set at `size`,
    in output pixels: the style's, given at its size, or HIGHLIGHT_PAD_X, HIGHLIGHT_PAD_Y and
    HIGHLIGHT_RADIUS of the size."""
    scale = size / style.size
    return (
        HIGHLIGHT_PAD_X * size if style.padding_x is None else style.padding_x * scale,
        HIGHLIGHT_PAD_Y * size if style.padding_y is None else style.padding_y * scale,
        HIGHLIGHT_RADIUS * size if style.radius is None else style.radius * scale,
    )


class _Element(NamedTuple):
    """One of the hook's Dialogue events before it is timed and animated: its ASS layer, its
    position as alignment and point with the y's format, its alpha (None: opaque), its tags, what
    follows its tags, its step in a staggered entrance, and the alpha tag its animation changes."""

    layer: int
    align: int
    x: float
    y: float
    y_format: str
    alpha: str | None
    tags: str
    body: str
    step: int
    alpha_tag: str = "\\alpha"


def _hook_events(hook: HookEvent, style: HookStyle) -> list[str]:
    """The hook's Dialogue events: its boxes and its Kicker's pill, drawn, and over them each line and
    the Kicker's text centred on its anchor (a shadow that isn't the style's plain one, _drawn_shadow,
    under the lines); then its Quote Mark's badge and marks over everything. All animated on and off
    as the style says (_hook_phases), on ASS layers 1 to 4."""
    metrics = font_metrics(style.font)
    size = hook.size
    # For each box and each line. A box that pops is placed by its centre, so that it grows from
    # there. The Kicker comes on first, then the lines one by one, each strip and shadow with its
    # line and a block and a Quote Mark with the first.
    elements: list[_Element] = []
    first = 1 if hook.kicker is not None else 0
    strips = len(hook.boxes) > 1
    if style.box_opacity > 0:
        alpha = ass_alpha(style.box_opacity)
        # The text's outline and shadow are the style's; a box has neither.
        bare = "\\bord0\\shad0" if style.outline or _plain_shadow(style.shadow) else ""
        tags = f"\\p1{bare}\\c{tag_colour(style.box_colour)}\\alpha{alpha}"
        for i, box in enumerate(hook.boxes):
            drawing = f"{rounded_box(box.width, box.height, min(style.radius, box.height // 2))}{{\\p0}}"
            step = first + i if strips else first
            if Animation.POP in (style.animation_in, style.animation_out):
                elements.append(_Element(1, 5, box.x + box.width / 2, box.y + box.height / 2, "g", alpha, tags, drawing, step))
            else:
                elements.append(_Element(1, 7, box.x, box.y, "g", alpha, tags, drawing, step))
    if hook.kicker is not None:
        kicker = hook.kicker
        box = kicker.box
        drawing = f"{rounded_box(box.width, box.height, box.height // 2)}{{\\p0}}"
        tags = f"\\p1\\bord0\\shad0\\c{tag_colour(style.kicker_box_colour)}\\alpha&H00&"
        if Animation.POP in (style.animation_in, style.animation_out):
            elements.append(_Element(1, 5, box.x + box.width / 2, box.y + box.height / 2, "g", None, tags, drawing, 0))
        else:
            elements.append(_Element(1, 7, box.x, box.y, "g", None, tags, drawing, 0))
        x, baseline = kicker.anchor
        centre_y = metrics.centre_y(baseline, kicker.size)
        tags = f"\\fs{kicker.size:g}\\bord0\\shad0\\c{tag_colour(style.kicker_colour)}"
        elements.append(_Element(2, 5, x, centre_y, ".1f", None, tags, ass_text(kicker.text), 0))
    if hook.quote is not None:
        # Both by the badge's top-left corner (a drawing is placed by its origin there, the marks'
        # being on the badge's grid), so that a pop grows them together from it.
        badge = hook.quote
        drawing = f"{rounded_box(badge.width, badge.height, round(QUOTE_RADIUS * badge.width))}{{\\p0}}"
        tags = f"\\p1\\bord0\\shad0\\c{tag_colour(style.quote_colour)}"
        elements.append(_Element(3, 7, badge.x, badge.y, "g", None, tags, drawing, first))
        marks = f"{_quote_marks(badge.width)}{{\\p0}}"
        elements.append(_Element(4, 7, badge.x, badge.y, "g", None, "\\p1\\bord0\\shad0\\c&HFFFFFF&", marks, first))
    sized = (f"\\fs{size:g}" if size != style.size else "") + spacing(style.tracking)
    # A line is centred (5) on the middle of its height (`centre_y`).
    centres = [(tracked(x, style.tracking), metrics.centre_y(baseline, size)) for x, baseline in hook.anchors]
    if (shadow := _drawn_shadow(style.shadow)) is not None:
        dx, dy = shadow.offset
        # Faded and popped by its own alpha, so that a stroked shadow's letters stay hidden.
        alpha_tag, alpha = ("\\3a" if style.outline else "\\1a"), ass_alpha(shadow.opacity)
        tags = sized + shadow_tags(shadow, style.outline)
        for i, (line, (x, y)) in enumerate(zip(hook.lines, centres)):
            elements.append(_Element(2, 5, x + dx, y + dy, ".1f", alpha, tags, ass_text(line), first + i, alpha_tag))
    for i, (line, (x, y), spans) in enumerate(zip(hook.lines, centres, hook.emphasis)):
        elements.append(_Element(2, 5, x, y, ".1f", None, sized, _emphasised(line, spans, style), first + i))

    step = _stagger(hook, style, first + len(hook.lines) - 1)
    # By part of the hook's time, then by element, as the parts are in time.
    events = []
    for order, (layer, align, x, y, y_format, alpha, tags, body, rank, alpha_tag) in enumerate(elements):
        for part, (begin, finish, phase) in enumerate(_hook_phases(hook, style, rank * step)):
            start, end = ass_time(begin), ass_time(finish)
            if start >= end:
                continue
            length = round((finish - begin) * 1000)
            place, motion = _hook_motion(phase, length, x, y, y_format, alpha, style, alpha_tag)
            # A box's (and a shadow's) own alpha is in its tags, which its animation then changes.
            if layer == 1 or alpha_tag != "\\alpha":
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
            f"{ass_text(line[at:start])}{{\\c{tag_colour(style.emphasis_colour)}}}{ass_text(line[start:end])}"
            f"{{\\c{tag_colour(style.colour)}}}"
        )
        at = end
    return text + ass_text(line[at:])


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
    phase: str, length: int, x: float, y: float, y_format: str, alpha: str | None, style: _Motion, alpha_tag: str = "\\alpha"
) -> tuple[str, str]:
    """The position tag and the animation tags of a hook element at (x, y) (y written in `y_format`)
    in a part of `length` ms (see _hook_phases), its own alpha being `alpha` (None: opaque), set by
    `alpha_tag` (all of its alphas, or one)."""
    shown = alpha or "&H00&"
    a = alpha_tag
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
            return place, f"\\fscx{POP_FROM}\\fscy{POP_FROM}{a}&HFF&\\t(\\fscx100\\fscy100{a}{shown})"
        return place, f"\\t(\\fscx{POP_FROM}\\fscy{POP_FROM}{a}&HFF&)"
    if animation == Animation.SLIDE:
        here, below = f"{x:g},{y:{y_format}}", f"{x:g},{y + SLIDE_PX:{y_format}}"
        if phase == "in":
            return f"\\move({below},{here})", f"{a}&HFF&\\t({a}{shown})"
        return f"\\move({here},{below})", f"\\t({a}&HFF&)"
    return place, ""


def _range(plan: RenderPlan) -> list[str]:
    """Input options that read just the Clip's range of the Source."""
    return ["-ss", f"{plan.start:.3f}", "-t", f"{plan.duration:.3f}"]


def last_lines(text: str, count: int = 3) -> str:
    """The last `count` lines of what ffmpeg said, on one line, for an error message."""
    return " ".join(text.strip().splitlines()[-count:])
