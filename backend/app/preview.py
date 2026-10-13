"""The preview proxy: a 720p H.264 copy of a Source the browser can't play, for Review's player.
Clips are still rendered from the Source itself.

What counts as browser-playable is what Chrome, Safari and Firefox on a Mac all play in a <video>
element, served by /media:
- an ISO-BMFF file (ffprobe's mov/mp4 demuxer) named .mp4, .m4v or .mov;
- H.264, VP9 or AV1 video, 8-bit 4:2:0 (Chrome has no decoder for H.264's 10-bit or 4:2:2 profiles);
- AAC, MP3, Opus or FLAC audio, or none (not the PCM that ProRes masters usually carry).
Everything else gets a proxy: ProRes, DNxHD, MPEG-2, and HEVC too, which Chrome only plays where the
Mac decodes it in hardware and Firefox not at all; and MKV, MXF, AVI or WebM files.
"""

import json
import logging
import os
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from app.config import PreviewTuning
from app.video_source import SourceMetadata

logger = logging.getLogger(__name__)

PREVIEW_FILE = "preview.mp4"

PLAYABLE_SUFFIXES = frozenset({".mp4", ".m4v", ".mov"})
PLAYABLE_VIDEO = frozenset({"h264", "vp9", "av1"})
PLAYABLE_PIXELS = frozenset({"yuv420p", "yuvj420p"})
PLAYABLE_AUDIO = frozenset({"aac", "mp3", "opus", "flac"})


def unplayable(ffprobe: Path, video: Path) -> str | None:
    """Why the browser can't play `video`, such as "hevc video" or "MKV container"; None when it can."""
    command = [
        str(ffprobe), "-v", "error", "-of", "json",
        "-show_entries", "stream=codec_type,codec_name,pix_fmt:format=format_name", str(video),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffprobe failed on {video.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    streams = info["streams"]
    picture = next(stream for stream in streams if stream["codec_type"] == "video")
    sound = next((stream for stream in streams if stream["codec_type"] == "audio"), None)
    if "mp4" not in info["format"]["format_name"].split(",") or video.suffix.lower() not in PLAYABLE_SUFFIXES:
        return f"{video.suffix.lstrip('.').upper() or info['format']['format_name']} container"
    if picture["codec_name"] not in PLAYABLE_VIDEO:
        return f"{picture['codec_name']} video"
    if picture.get("pix_fmt") not in PLAYABLE_PIXELS:
        return f"{picture['codec_name']} video in {picture.get('pix_fmt')}"
    if sound and sound["codec_name"] not in PLAYABLE_AUDIO:
        return f"{sound['codec_name']} audio"
    return None


def make_preview(
    ffmpeg: Path,
    video: Path,
    metadata: SourceMetadata,
    tuning: PreviewTuning,
    progress: Callable[[float], None] = lambda done: None,
) -> str:
    """Write the proxy of `video` next to it, as PREVIEW_FILE, and return that name. `progress` is
    called with the share encoded so far, from 0 to 1. The proxy is written under a temporary name
    and renamed when complete, so a half-written one is never taken for it."""
    target = video.with_name(PREVIEW_FILE)
    part = video.with_name(f".{target.stem}.part{target.suffix}")
    failures = []
    try:
        for encoder in tuning.encoders:
            stderr = _run(_command(ffmpeg, video, metadata, tuning, encoder, part), metadata.duration, progress)
            if stderr is None:
                os.replace(part, target)
                return PREVIEW_FILE
            logger.warning("The preview proxy with %s failed: %s", encoder, stderr)
            failures.append(f"{encoder}: {stderr.splitlines()[-1]}")
    finally:
        part.unlink(missing_ok=True)
    raise RuntimeError(f"ffmpeg couldn't make a preview copy the browser can play ({'; '.join(failures)})")


def _command(
    ffmpeg: Path, video: Path, metadata: SourceMetadata, tuning: PreviewTuning, encoder: str, output: Path
) -> list[str]:
    # The shorter side shrinks to tuning.short_side (never grows); the other follows, kept even.
    if metadata.width >= metadata.height:
        size = f"-2:{min(tuning.short_side, metadata.height) // 2 * 2}"
    else:
        size = f"{min(tuning.short_side, metadata.width) // 2 * 2}:-2"
    if encoder == "libx264":
        codec = ["-c:v", "libx264", "-preset", tuning.x264_preset, "-crf", str(tuning.x264_crf)]
    else:
        codec = ["-c:v", encoder, "-b:v", tuning.bitrate]
    return [
        str(ffmpeg), "-v", "error", "-nostdin", "-y", "-i", str(video),
        "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn",
        "-vf", f"scale={size},setsar=1,format=yuv420p",
        *codec, "-profile:v", "high", "-force_key_frames", f"expr:gte(t,n_forced*{tuning.keyframe_secs})",
        "-c:a", "aac", "-b:a", tuning.audio_bitrate, "-ac", "2",
        "-movflags", "+faststart", "-map_metadata", "-1", "-map_chapters", "-1",
        "-progress", "pipe:1", "-nostats", str(output),
    ]


def _run(command: list[str], duration: float, progress: Callable[[float], None]) -> str | None:
    """Run an encode, reporting its progress; None when it succeeds, else what ffmpeg said."""
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors, text=True)
        assert process.stdout is not None
        for line in process.stdout:
            key, _, value = line.strip().partition("=")
            if key == "out_time_us" and value.isdigit():
                progress(min(1.0, int(value) / 1e6 / duration))
        process.wait()
        if process.returncode == 0:
            return None
        errors.seek(0)
        return errors.read().decode(errors="replace").strip() or f"exit code {process.returncode}"
