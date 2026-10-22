"""The external boundaries the pipeline talks to. Tests pass fakes in their place."""

from collections.abc import Sequence
from dataclasses import dataclass

from app.config import Settings
from app.kokoro import KokoroModel
from app.llm import GeminiLlm, Llm, OpenAiLlm
from app.matte import Matter, RvmMatter
from app.model_download import MODELS_DIR
from app.person_model import PersonModel
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
    # Kokoro's model (app/kokoro.py), downloaded on first use; Kokoro is offered only with it.
    kokoro: KokoroModel | None = None
    # The person model (app/person_model.py), downloaded on first use for Background removal's Matte.
    person_model: PersonModel | None = None
    # What makes a Matte from the person model's file (app/matte.py's matter seam): RVM through onnxruntime.
    matter: type[Matter] = RvmMatter


def real_ports(settings: Settings) -> Ports:
    return Ports(
        video_source=YtDlpVideoSource(settings),
        transcriber=WhisperTranscriber(settings),
        llm=GeminiLlm(settings) if settings.llm_provider == "gemini" else OpenAiLlm(settings),
        voices=voice_engines(settings),
        kokoro=KokoroModel(settings.data_dir / MODELS_DIR),
        person_model=PersonModel(settings.data_dir / MODELS_DIR),
    )
