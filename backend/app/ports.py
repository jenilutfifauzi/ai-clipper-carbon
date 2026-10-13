"""The external boundaries the pipeline talks to. Tests pass fakes in their place."""

from dataclasses import dataclass

from app.config import Settings
from app.transcriber import Transcriber, WhisperTranscriber
from app.video_source import VideoSource, YtDlpVideoSource


@dataclass(frozen=True)
class Ports:
    video_source: VideoSource
    transcriber: Transcriber


def real_ports(settings: Settings) -> Ports:
    return Ports(video_source=YtDlpVideoSource(settings), transcriber=WhisperTranscriber(settings))
