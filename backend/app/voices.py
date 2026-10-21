"""The speech engines a Narration is read by (GLOSSARY.md, Narration and Voice; docs/adr/0019), behind
one small interface, and the engines this Mac offers.

An engine names itself, says whether it is ready, lists its Voices, says whether it takes a Style, and
reads one sentence into mono 16-bit PCM at its own sample rate. The Narration runner (app/narration.py)
splits the script, joins and levels the sentences, so an engine only ever reads one sentence.

The cloud engines are configured apart from the LLM: Gemini TTS is offered whenever GEMINI_API_KEY is
set, whatever LLM_PROVIDER says.
"""

import base64
import re
from dataclasses import dataclass, field
from typing import Protocol

import httpx
import numpy as np

from app.config import Settings

GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
# A sentence is short; Gemini can still take a while to start speaking under load.
_TIMEOUT_SECS = 60
# Gemini TTS answers raw 16-bit PCM, its rate in the MIME type ("audio/L16;codec=pcm;rate=24000").
_GEMINI_RATE = 24_000
_RATE = re.compile(r"rate=(\d+)")


@dataclass(frozen=True)
class Voice:
    """One built-in speaker of an engine."""

    id: str
    # What the Voice list shows: its name, and a detail line such as "Firm · female".
    name: str
    detail: str
    # The language it speaks, as a Job's language is written; None for one that reads any (Gemini's).
    language: str | None = None


@dataclass(frozen=True)
class Pcm:
    """One read sentence: mono 16-bit samples at `rate` Hz."""

    samples: np.ndarray = field(repr=False)
    rate: int

    @property
    def secs(self) -> float:
        return len(self.samples) / self.rate


class SpeechError(RuntimeError):
    """An engine couldn't read a sentence; its message names the engine and what to fix."""


class TransientSpeechError(SpeechError):
    """A failure a retry may get past (a rate limit, a server error, the network): after
    `retry_after` seconds when the service said so."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        self.retry_after = retry_after


class VoiceEngine(Protocol):
    # Its id in requests ("gemini"), its label in the engine picker ("Gemini"), the service the words
    # are sent to ("Gemini", None for one on this Mac), and whether it runs on this Mac.
    id: str
    label: str
    service: str | None
    local: bool
    # Whether it takes a Style line, sent as the read's instruction.
    takes_style: bool

    def ready(self) -> bool: ...

    def voices(self) -> list[Voice]: ...

    def read(self, text: str, voice: str, style: str | None = None) -> Pcm:
        """`text`, one sentence, read by Voice `voice`. SpeechError (or TransientSpeechError) when it fails."""
        ...


# Gemini TTS's prebuilt Voices, each named for its character in Google's list. They are multilingual and
# read the script's language.
_GEMINI_VOICES = [
    ("Zephyr", "Bright", "female"),
    ("Puck", "Upbeat", "male"),
    ("Charon", "Informative", "male"),
    ("Kore", "Firm", "female"),
    ("Fenrir", "Excitable", "male"),
    ("Leda", "Youthful", "female"),
    ("Orus", "Firm", "male"),
    ("Aoede", "Breezy", "female"),
    ("Callirrhoe", "Easy-going", "female"),
    ("Autonoe", "Bright", "female"),
    ("Enceladus", "Breathy", "male"),
    ("Iapetus", "Clear", "male"),
    ("Umbriel", "Easy-going", "male"),
    ("Algieba", "Smooth", "male"),
    ("Despina", "Smooth", "female"),
    ("Erinome", "Clear", "female"),
    ("Algenib", "Gravelly", "male"),
    ("Rasalgethi", "Informative", "male"),
    ("Laomedeia", "Upbeat", "female"),
    ("Achernar", "Soft", "female"),
    ("Alnilam", "Firm", "male"),
    ("Schedar", "Even", "male"),
    ("Gacrux", "Mature", "female"),
    ("Pulcherrima", "Forward", "female"),
    ("Achird", "Friendly", "male"),
    ("Zubenelgenubi", "Casual", "male"),
    ("Vindemiatrix", "Gentle", "female"),
    ("Sadachbia", "Lively", "male"),
    ("Sadaltager", "Knowledgeable", "male"),
    ("Sulafat", "Warm", "female"),
]
GEMINI_VOICES = [Voice(name, name, f"{character} · {gender}") for name, character, gender in _GEMINI_VOICES]


class GeminiSpeech:
    """Gemini TTS through generateContent's REST API, with AUDIO as the response modality and a prebuilt
    Voice. A Style goes before the sentence as the read's instruction ("warm, unhurried: …"). Speed isn't
    native to it."""

    id = "gemini"
    label = "Gemini"
    service = "Gemini"
    local = False
    takes_style = True

    def __init__(self, settings: Settings, http_client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._http = http_client

    def ready(self) -> bool:
        return bool(self.settings.gemini_api_key)

    def voices(self) -> list[Voice]:
        return GEMINI_VOICES

    def read(self, text: str, voice: str, style: str | None = None) -> Pcm:
        prompt = f"{style.strip()}: {text}" if style and style.strip() else text
        body = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}},
            },
        }
        url = f"{GEMINI_API}/models/{self.settings.tts_gemini_model}:generateContent"
        headers = {"x-goog-api-key": self.settings.gemini_api_key or ""}
        try:
            response = self._client().post(url, json=body, headers=headers, timeout=_TIMEOUT_SECS)
        except httpx.TransportError as exc:
            raise TransientSpeechError(f"Couldn't reach Gemini TTS: {exc}") from exc
        if response.status_code != 200:
            raise _gemini_error(response)
        return _gemini_audio(response.json())

    def _client(self) -> httpx.Client:
        if self._http is None:
            self._http = httpx.Client()
        return self._http


def _gemini_error(response: httpx.Response) -> SpeechError:
    try:
        message = response.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        message = response.text[:200] or response.reason_phrase
    code = response.status_code
    # A key that isn't valid is a 400 (INVALID_ARGUMENT) from Gemini, one without access a 401 or 403.
    if code in (401, 403) or (code == 400 and "API key" in message):
        return SpeechError(f"Gemini TTS refused GEMINI_API_KEY: check the key in .env and restart ({message})")
    if code == 429 or code >= 500:
        return TransientSpeechError(f"Gemini TTS is busy ({code}): {message}", _retry_after(response))
    return SpeechError(f"Gemini TTS failed ({code}): {message}")


def _retry_after(response: httpx.Response) -> float | None:
    try:
        return max(0.0, float(response.headers["retry-after"]))
    except (KeyError, ValueError):
        return None


def _gemini_audio(answer: dict) -> Pcm:
    """The PCM in a generateContent answer: every inline audio part, one after another."""
    parts = [
        part["inlineData"]
        for candidate in answer.get("candidates") or []
        for part in (candidate.get("content") or {}).get("parts") or []
        if "inlineData" in part
    ]
    if not parts:
        finish = next((c.get("finishReason") for c in answer.get("candidates") or []), None)
        raise SpeechError(f"Gemini TTS gave no audio for a sentence ({finish or 'no answer'})")
    rate = _RATE.search(parts[0].get("mimeType", ""))
    data = b"".join(base64.b64decode(part["data"]) for part in parts)
    # An odd byte (a cut answer) can't be a sample.
    return Pcm(np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2"), int(rate.group(1)) if rate else _GEMINI_RATE)


def voice_engines(settings: Settings, http_client: httpx.Client | None = None) -> list[VoiceEngine]:
    """The engines this Mac offers, in the engine picker's order: the cloud ones set up in .env, then
    the local ones."""
    engines: list[VoiceEngine] = []
    if settings.gemini_api_key:
        engines.append(GeminiSpeech(settings, http_client))
    return engines


def default_engine(engines: list[VoiceEngine], language: str | None) -> str | None:
    """The engine a Job in `language` starts with: Indonesian (and any other language) the first ready
    cloud engine; English a ready local one, else the first ready cloud one. None when none is ready."""
    ready = [engine for engine in engines if engine.ready()]
    cloud = [engine for engine in ready if not engine.local]
    local = [engine for engine in ready if engine.local]
    first = (local + cloud) if language == "en" else (cloud + local)
    return first[0].id if first else None
