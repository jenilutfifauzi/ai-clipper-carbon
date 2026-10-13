"""The Video Source port: a URL in, a local video file, its metadata and captions out."""

import json
import logging
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from yt_dlp import YoutubeDL

from app.config import Settings

logger = logging.getLogger(__name__)

VIDEO_FILE = "source.mp4"


@dataclass(frozen=True)
class SourceMetadata:
    duration: float
    fps: float
    width: int
    height: int
    codec: str


@dataclass(frozen=True)
class Source:
    """What a Video Source fetched. File names are relative to the directory it wrote into."""

    video: str
    caption_track: str | None
    metadata: SourceMetadata


class VideoSource(Protocol):
    def fetch(self, url: str, language: str, dest: Path) -> Source:
        """Write the video and, if one exists, its json3 auto-caption track in `language` into `dest`."""
        ...


class YtDlpVideoSource:
    """YouTube via yt-dlp: at most 1080p, H.264 preferred, merged to mp4 with the configured ffmpeg."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def fetch(self, url: str, language: str, dest: Path) -> Source:
        caption_languages = [f"{language}-orig", language]
        with YoutubeDL(self._options(caption_languages, dest)) as ydl:
            ydl.download([url])

        video = dest / VIDEO_FILE
        if not video.is_file():
            raise RuntimeError(f"yt-dlp finished without writing {VIDEO_FILE}")
        tracks = (dest / f"source.{lang}.json3" for lang in caption_languages)
        caption_track = next((track.name for track in tracks if track.is_file()), None)
        return Source(VIDEO_FILE, caption_track, probe(self.settings.ffprobe_bin, video))

    def _options(self, caption_languages: list[str], dest: Path) -> dict[str, Any]:
        options: dict[str, Any] = {
            "format": "bv*[height<=1080]+ba/b[height<=1080]",
            "format_sort": ["res:1080", "vcodec:h264", "acodec:m4a"],
            "merge_output_format": "mp4",
            "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
            "ffmpeg_location": str(self.settings.ffmpeg_bin),
            "outtmpl": str(dest / "source.%(ext)s"),
            "writeautomaticsub": True,
            "subtitlesformat": "json3",
            "subtitleslangs": [re.escape(lang) for lang in caption_languages],  # yt-dlp reads these as regexes
            "noplaylist": True,
            "quiet": True,
            "noprogress": True,
            "logger": logger,
        }
        if self.settings.ytdlp_cookies_from_browser:
            options["cookiesfrombrowser"] = (self.settings.ytdlp_cookies_from_browser,)
        return options


def probe(ffprobe: Path, video: Path) -> SourceMetadata:
    """Metadata of the first video stream, read with the configured ffprobe."""
    command = [
        str(ffprobe), "-v", "error", "-select_streams", "v:0", "-of", "json",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate:format=duration", str(video),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffprobe failed on {video.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    if not info["streams"]:
        raise RuntimeError(f"{video.name} has no video stream")

    stream = info["streams"][0]
    numerator, denominator = (int(part) for part in stream["avg_frame_rate"].split("/"))
    return SourceMetadata(
        duration=float(info["format"]["duration"]),
        fps=round(numerator / denominator, 3),
        width=stream["width"],
        height=stream["height"],
        codec=stream["codec_name"],
    )
