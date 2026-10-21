"""The speech engines a Narration is read by (GLOSSARY.md, Narration and Voice; docs/adr/0019), behind
one small interface, and the engines this Mac offers.

An engine names itself, says whether it is ready, lists its Voices, says whether it takes a Style and
a Speed, and reads one sentence into mono 16-bit PCM at its own sample rate. An engine without a
native Speed reads at 1×; the runner retimes it, its pitch kept. The Narration runner (app/narration.py)
splits the script, joins and levels the sentences, so an engine only ever reads one sentence.

The cloud engines are configured apart from the LLM: Gemini TTS is offered whenever GEMINI_API_KEY is
set, whatever LLM_PROVIDER says; an OpenAI-compatible /audio/speech service when TTS_BASE_URL,
TTS_API_KEY and TTS_MODEL are.
"""

import base64
import re
import struct
from dataclasses import dataclass, field
from typing import Protocol
from urllib.parse import urlsplit

import httpx
import numpy as np

from app.config import Settings

GEMINI_API = "https://generativelanguage.googleapis.com/v1beta"
# A sentence is short; Gemini can still take a while to start speaking under load.
_TIMEOUT_SECS = 60
# Gemini TTS answers raw 16-bit PCM, its rate in the MIME type ("audio/L16;codec=pcm;rate=24000").
_GEMINI_RATE = 24_000
_RATE = re.compile(r"rate=(\d+)")
# OpenAI's raw "pcm" answer: 24 kHz 16-bit mono, little-endian.
_OPENAI_PCM_RATE = 24_000
# OpenAI's speech models that take `instructions` (a Style): gpt-4o-mini-tts and its kind, not tts-1.
_INSTRUCTED_MODEL = re.compile(r"^gpt-.*tts", re.IGNORECASE)


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
    # Whether it takes a Style line, sent as the read's instruction; and a Speed of its own (else the
    # runner retimes what it reads at 1×).
    takes_style: bool
    takes_speed: bool

    def ready(self) -> bool: ...

    def voices(self) -> list[Voice]: ...

    def read(self, text: str, voice: str, style: str | None = None, speed: float = 1.0) -> Pcm:
        """`text`, one sentence, read by Voice `voice`, at `speed` (0.5–2, asked only of an engine that
        takes_speed). SpeechError (or TransientSpeechError) when it fails."""
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
    native to it: it reads at 1×, and the runner retimes it."""

    id = "gemini"
    label = "Gemini"
    service = "Gemini"
    local = False
    takes_style = True
    takes_speed = False

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


# OpenAI's standard Voices, with the character OpenAI's voice gallery gives each. Not every model has
# every one (tts-1 lacks ballad, verse, marin and cedar); TTS_VOICES replaces the list.
_OPENAI_VOICES = [
    ("alloy", "Neutral, balanced"),
    ("ash", "Warm, clear"),
    ("ballad", "Soft, melodic"),
    ("coral", "Bright, friendly"),
    ("echo", "Calm, even"),
    ("fable", "Expressive, storytelling"),
    ("nova", "Bright, youthful"),
    ("onyx", "Deep, steady"),
    ("sage", "Calm, thoughtful"),
    ("shimmer", "Clear, light"),
    ("verse", "Versatile, lively"),
    ("marin", "Natural, smooth"),
    ("cedar", "Natural, grounded"),
]
OPENAI_VOICES = [Voice(id, id.capitalize(), detail) for id, detail in _OPENAI_VOICES]
OPENAI_HOST = "api.openai.com"


class OpenAiSpeech:
    """An OpenAI-compatible speech service: POST {TTS_BASE_URL}/audio/speech with the model, the Voice
    and the sentence, answered as WAV (the format compatible services most often share), decoded by its
    header. A raw "pcm" answer is read as OpenAI's, 24 kHz. Its service is OpenAI, or the base URL's host.
    Speed goes in its `speed` field (left out at 1×, its default); a Style in `instructions`, when it
    takes one: TTS_STYLE, else whether the model takes instructions (gpt-4o-mini-tts does, tts-1 doesn't)."""

    id = "openai"
    local = False
    takes_speed = True

    def __init__(self, settings: Settings, http_client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._http = http_client
        host = urlsplit(settings.tts_base_url or "").hostname or settings.tts_base_url or "OpenAI-compatible"
        self.service = "OpenAI" if host == OPENAI_HOST else host
        self.label = self.service
        # How messages name it: "OpenAI TTS", "localhost TTS".
        self._name = f"{self.service} TTS"
        instructed = bool(_INSTRUCTED_MODEL.match(settings.tts_model or ""))
        self.takes_style = instructed if settings.tts_style is None else settings.tts_style

    def ready(self) -> bool:
        return bool(self.settings.tts_base_url and self.settings.tts_api_key and self.settings.tts_model)

    def voices(self) -> list[Voice]:
        if self.settings.tts_voices:
            return [Voice(voice, voice, "") for voice in self.settings.tts_voices]
        return OPENAI_VOICES

    def _body(self, text: str, voice: str, style: str | None, speed: float) -> dict:
        body: dict = {"model": self.settings.tts_model, "input": text, "voice": voice, "response_format": "wav"}
        if self.takes_style and style and style.strip():
            body["instructions"] = style.strip()
        if speed != 1:
            body["speed"] = speed
        return body

    def read(self, text: str, voice: str, style: str | None = None, speed: float = 1.0) -> Pcm:
        url = f"{self.settings.tts_base_url}/audio/speech"
        headers = {"Authorization": f"Bearer {self.settings.tts_api_key or ''}"}
        body = self._body(text, voice, style, speed)
        try:
            response = self._client().post(url, json=body, headers=headers, timeout=_TIMEOUT_SECS)
        except httpx.TransportError as exc:
            raise TransientSpeechError(f"Couldn't reach {self._name}: {exc}") from exc
        if response.status_code != 200:
            raise self._error(response)
        data = response.content
        if data[:4] == b"RIFF":
            return _wav(data, self._name)
        kind = response.headers.get("content-type", "")
        if "pcm" in kind or "L16" in kind:
            rate = _RATE.search(kind)
            return Pcm(np.frombuffer(data[: len(data) // 2 * 2], dtype="<i2"), int(rate.group(1)) if rate else _OPENAI_PCM_RATE)
        raise SpeechError(f"{self._name} gave audio that isn't WAV ({kind or 'no content type'})")

    def _error(self, response: httpx.Response) -> SpeechError:
        try:
            message = response.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            message = response.text[:200] or response.reason_phrase
        code = response.status_code
        if code in (401, 403):
            return SpeechError(f"{self._name} refused TTS_API_KEY: check the key in .env and restart ({message})")
        if code == 429 or code >= 500:
            return TransientSpeechError(f"{self._name} is busy ({code}): {message}", _retry_after(response))
        return SpeechError(f"{self._name} failed ({code}): {message}")

    def _client(self) -> httpx.Client:
        if self._http is None:
            self._http = httpx.Client()
        return self._http


def _wav(data: bytes, name: str) -> Pcm:
    """The mono PCM in a 16-bit WAV file, its channels averaged. A streamed file's sizes may be unknown
    (0xFFFFFFFF), so the data chunk is read to the end of what was sent, whatever its size says."""
    rate = channels = bits = None
    at = 12
    while at + 8 <= len(data):
        chunk, size = struct.unpack_from("<4sI", data, at)
        body = at + 8
        if chunk == b"fmt ":
            _format, channels, rate, _byte_rate, _align, bits = struct.unpack_from("<HHIIHH", data, body)
        elif chunk == b"data":
            if rate is None or channels is None:
                break
            if bits != 16:
                raise SpeechError(f"{name} gave {bits}-bit WAV audio; only 16-bit is read")
            frames = data[body : body + min(size, len(data) - body)]
            frames = frames[: len(frames) // (2 * channels) * (2 * channels)]
            samples = np.frombuffer(frames, dtype="<i2")
            if channels > 1:
                samples = samples.reshape(-1, channels).mean(axis=1).round().astype("<i2")
            return Pcm(samples, rate)
        at = body + size + (size & 1)
    raise SpeechError(f"{name} gave a WAV file without audio")


def voice_engines(settings: Settings, http_client: httpx.Client | None = None) -> list[VoiceEngine]:
    """The engines this Mac offers, in the engine picker's order: the cloud ones set up in .env, then
    the local ones."""
    engines: list[VoiceEngine] = []
    if settings.gemini_api_key:
        engines.append(GeminiSpeech(settings, http_client))
    openai = OpenAiSpeech(settings, http_client)
    if openai.ready():
        engines.append(openai)
    return engines


def default_engine(engines: list[VoiceEngine], language: str | None) -> str | None:
    """The engine a Job in `language` starts with: Indonesian (and any other language) the first ready
    cloud engine; English a ready local one, else the first ready cloud one. None when none is ready."""
    ready = [engine for engine in engines if engine.ready()]
    cloud = [engine for engine in ready if not engine.local]
    local = [engine for engine in ready if engine.local]
    first = (local + cloud) if language == "en" else (cloud + local)
    return first[0].id if first else None
