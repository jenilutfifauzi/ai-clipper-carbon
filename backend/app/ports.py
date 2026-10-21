"""The external boundaries the pipeline talks to. Tests pass fakes in their place."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.config import Settings
from app.llm import GeminiLlm, Llm, OpenAiLlm
from app.transcriber import Transcriber, WhisperTranscriber
from app.video_source import VideoSource, YtDlpVideoSource
from app.voices import VoiceEngine, voice_engines


@dataclass(frozen=True)
class Ports:
    video_source: VideoSource
    transcriber: Transcriber
    llm: Llm
    # The speech engines Narrations are read by (app/voices.py): none unless given.
    voices: Sequence[VoiceEngine] = ()


def real_ports(settings: Settings) -> Ports:
    return Ports(
        video_source=YtDlpVideoSource(settings),
        transcriber=WhisperTranscriber(settings),
        llm=GeminiLlm(settings) if settings.llm_provider == "gemini" else OpenAiLlm(settings),
        voices=voice_engines(settings),
    )
