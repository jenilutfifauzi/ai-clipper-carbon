"""The Video Source port: a URL in, a local video file, its metadata and captions out, or the
captions alone. YouTube's implementation downloads the video; the upload implementation takes a
master file the owner uploaded."""

import json
import logging
import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from yt_dlp import YoutubeDL
from yt_dlp.postprocessor import PostProcessor

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
    # A copy of the video that the browser can play, for Review's previews, when the video itself
    # can't be (app/preview.py); None when it can. Clips are always rendered from `video`.
    preview: str | None = None


class VideoSource(Protocol):
    def fetch(
        self, url: str, language: str, dest: Path, progress: Callable[[float], None] = lambda done: None
    ) -> Source:
        """Write the video and, if one exists, its json3 auto-caption track in `language` into `dest`.
        `progress` is called with the fraction of the download done, as it goes."""
        ...

    def fetch_captions(self, url: str, language: str, dest: Path) -> str | None:
        """Write only the json3 auto-caption track in `language` into `dest`, without the video, and
        return its file name (relative to `dest`); None when the video has no such track."""
        ...


class YtDlpVideoSource:
    """YouTube via yt-dlp: at most 1080p, H.264 preferred, merged to mp4 with the configured ffmpeg."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def fetch(
        self, url: str, language: str, dest: Path, progress: Callable[[float], None] = lambda done: None
    ) -> Source:
        tracker = DownloadProgress(progress)
        options = self._options(language, dest) | {
            "format": "bv*[height<=1080]+ba/b[height<=1080]",
            "format_sort": ["res:1080", "vcodec:h264", "acodec:m4a"],
            "merge_output_format": "mp4",
            "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
            "ffmpeg_location": str(self.settings.ffmpeg_bin),
            "progress_hooks": [tracker.hook],
        }
        with YoutubeDL(options) as ydl:
            ydl.add_post_processor(tracker, when="before_dl")
            ydl.download([url])

        video = dest / VIDEO_FILE
        if not video.is_file():
            raise RuntimeError(f"yt-dlp finished without writing {VIDEO_FILE}")
        return Source(VIDEO_FILE, _caption_track(dest, language), probe(self.settings.ffprobe_bin, video))

    def fetch_captions(self, url: str, language: str, dest: Path) -> str | None:
        # yt-dlp still selects a format when it skips the download, and a video with no
        # downloadable format can still have captions.
        options = self._options(language, dest) | {"skip_download": True, "ignore_no_formats_error": True}
        with YoutubeDL(options) as ydl:
            ydl.download([url])
        return _caption_track(dest, language)

    def _options(self, language: str, dest: Path) -> dict[str, Any]:
        """The options both fetches share: the auto-captions, named after the video, and the cookies setting."""
        options: dict[str, Any] = {
            "outtmpl": str(dest / "source.%(ext)s"),
            "writeautomaticsub": True,
            "subtitlesformat": "json3",
            "subtitleslangs": [re.escape(lang) for lang in _caption_languages(language)],  # read as regexes
            "noplaylist": True,
            "quiet": True,
            "noprogress": True,
            "logger": logger,
        }
        if self.settings.ytdlp_cookies_from_browser:
            options["cookiesfrombrowser"] = (self.settings.ytdlp_cookies_from_browser,)
        return options


class DownloadProgress(PostProcessor):
    """The bytes yt-dlp has downloaded, of all the formats it fetches, as one fraction for `report`.

    yt-dlp downloads a video and an audio stream one after the other, and reports each from zero, so
    run before the download (`when="before_dl"`) this reads the sizes of the formats it chose.
    Without them, it goes by the sizes each download reports. The caption track yt-dlp fetches
    first, through the same hook, doesn't count.
    """

    def __init__(self, report: Callable[[float], None]) -> None:
        super().__init__()
        self.report = report
        self.expected: int | None = None  # set when the download starts
        self.files: dict[str, tuple[int, int]] = {}  # file name: (downloaded, total) bytes

    def run(self, info: dict[str, Any]) -> tuple[list[str], dict[str, Any]]:
        formats = info.get("requested_formats") or [info]
        self.expected = sum(f.get("filesize") or f.get("filesize_approx") or 0 for f in formats)
        return [], info

    def hook(self, status: dict[str, Any]) -> None:
        if self.expected is None or status["status"] not in ("downloading", "finished"):
            return
        total = status.get("total_bytes") or status.get("total_bytes_estimate") or 0
        # A file found complete on disk (a download resumed after a restart) is reported finished,
        # without downloaded bytes.
        done = status.get("downloaded_bytes") or (total if status["status"] == "finished" else 0)
        self.files[status["filename"]] = (done, total)
        expected = max(self.expected, sum(total for _, total in self.files.values()))
        if expected:
            self.report(min(1.0, sum(done for done, _ in self.files.values()) / expected))


class UploadVideoSource:
    """A master file the owner uploaded, already stored in the Job directory (app/uploads.py). It
    has no captions, so the whole episode is transcribed locally."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def fetch(
        self, url: str, language: str, dest: Path, progress: Callable[[float], None] = lambda done: None
    ) -> Source:
        """`url` is the stored file's name in `dest`. It is already there, so there is no progress to report."""
        video = dest / url
        if not video.is_file():
            raise RuntimeError(f"The uploaded file {url} is missing: upload it again in a new Job")
        return Source(url, None, probe(self.settings.ffprobe_bin, video))

    def fetch_captions(self, url: str, language: str, dest: Path) -> str | None:
        return None


def _caption_languages(language: str) -> list[str]:
    """The caption tracks to ask for, best first."""
    return [f"{language}-orig", language]


def _caption_track(dest: Path, language: str) -> str | None:
    tracks = (dest / f"source.{lang}.json3" for lang in _caption_languages(language))
    return next((track.name for track in tracks if track.is_file()), None)


def probe(ffprobe: Path, video: Path) -> SourceMetadata:
    """Metadata of the first video stream, read with the configured ffprobe."""
    command = [
        str(ffprobe), "-v", "error", "-select_streams", "v:0", "-of", "json",
        "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate:format=duration", str(video),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(f"ffprobe failed on {video.name}: {result.stderr.strip()}")
    info = json.loads(result.stdout)
    if not info["streams"]:
        raise RuntimeError(f"{video.name} has no video stream")
    if "duration" not in info["format"]:
        raise RuntimeError(f"ffprobe found no duration in {video.name}")

    stream = info["streams"][0]
    # Some containers (MXF, some QuickTime files) leave the average frame rate unset, as 0/0.
    rate = stream["avg_frame_rate"] if not stream["avg_frame_rate"].startswith("0/") else stream["r_frame_rate"]
    numerator, denominator = (int(part) for part in rate.split("/"))
    return SourceMetadata(
        duration=float(info["format"]["duration"]),
        fps=round(numerator / denominator, 3),
        width=stream["width"],
        height=stream["height"],
        codec=stream["codec_name"],
    )
