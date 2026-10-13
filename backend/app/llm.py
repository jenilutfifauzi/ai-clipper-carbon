"""The LLM port: two structured calls, Score and Detail, and its two implementations: Gemini, and
an OpenAI-compatible Chat Completions API (DeepSeek's by default). LLM_PROVIDER picks one.

Prompts are built by Selection (app/prompts.py); the port only sends them and validates the
answer against the response schema below, which is also sent to constrain the model's output.
"""

import json
import math
import re
import threading
import time
from dataclasses import dataclass
from typing import Annotated, Protocol

import httpx
from google import genai
from google.genai import errors, types
from pydantic import AfterValidator, BaseModel, Field, ValidationError

from app.config import Settings

# Detail requests carry a whole episode's Transcript and can think for minutes.
_TIMEOUT_MS = 10 * 60 * 1000
# Room for the answer: a 3-hour episode's Detail answer of 20 clips is about 6,000 tokens. Thinking
# counts against the limit too, so with it the limit is DeepSeek's default for thinking.
_MAX_TOKENS = 16_384
_THINKING_MAX_TOKENS = 65_536
_JSON_INSTRUCTION = "Answer with one JSON object, and nothing else, that fits this JSON schema:\n{schema}"
_BLOCKED = {"SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"}

_CLOCK = re.compile(r"(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)")
_SECONDS = re.compile(r"\d+(?:\.\d+)?")
# A protobuf Duration in JSON, as RetryInfo's retryDelay is written: "32s", "0.5s".
_DELAY = re.compile(r"(\d+(?:\.\d+)?)s")


def parse_time(text: str) -> float:
    """Seconds from a time written like a Transcript label (m:ss or h:mm:ss, decimals allowed), or plain seconds."""
    text = text.strip()
    if match := _CLOCK.fullmatch(text):
        hours, minutes, seconds = match.groups()
        return int(hours or 0) * 3600 + int(minutes) * 60 + float(seconds)
    if _SECONDS.fullmatch(text):
        return float(text)
    raise ValueError(f"not a time: {text!r}")


def _time(text: str) -> str:
    parse_time(text)
    return text


Time = Annotated[str, AfterValidator(_time)]
Score = Annotated[int, Field(ge=0, le=100)]


class WindowScore(BaseModel):
    id: str
    reason: str
    score: Score


class ScoreResponse(BaseModel):
    windows: list[WindowScore]


# A clip as the Detail pass proposes it, before Selection snaps and checks it. (No docstring:
# pydantic would put it in the JSON schema, which the model reads.)
class ClipProposal(BaseModel):
    window_id: str
    start: Time
    end: Time
    reason: str
    emotion: str
    hook_strength: Score
    retention_notes: str
    predicted_score: Score
    viral_hook_text: str
    title: str
    tiktok_description: str
    instagram_description: str
    shorts_description: str
    hashtags: list[str]


class DetailResponse(BaseModel):
    clips: list[ClipProposal]


@dataclass(frozen=True)
class LlmRequest:
    prompt: str
    temperature: float


class Llm(Protocol):
    """Both calls raise `TransientLlmError` when a retry may succeed (`Overloaded` when the model is
    too busy to answer), `QuotaExceeded` when the quota is used up, and `LlmError` otherwise."""

    def score(self, request: LlmRequest) -> ScoreResponse:
        """A score for each Window in a Score prompt."""
        ...

    def detail(self, request: LlmRequest) -> DetailResponse:
        """The clips a Detail prompt asks for."""
        ...


class LlmError(RuntimeError):
    """The LLM gave no usable answer; the message says why."""


class TransientLlmError(LlmError):
    """A network failure, a timeout, a 5xx, or an answer that didn't fit the schema: worth retrying."""


class Overloaded(TransientLlmError):
    """The model is too busy to answer (HTTP 503 UNAVAILABLE, 504 DEADLINE_EXCEEDED). When it stays
    so past Selection's retries, the Job waits as for the quota."""


class QuotaExceeded(LlmError):
    """The API's rate limit or quota is used up (HTTP 429, RESOURCE_EXHAUSTED)."""

    def __init__(self, message: str, retry_after: float | None = None) -> None:
        super().__init__(message)
        # The wait in seconds that the API suggests, when it suggests one.
        self.retry_after = retry_after


class PacedLlm:
    """Any Llm, with its requests started at least `interval` seconds apart."""

    def __init__(self, llm: Llm, interval: float) -> None:
        self.llm = llm
        self.interval = interval
        self._lock = threading.Lock()
        self._last = -math.inf

    def score(self, request: LlmRequest) -> ScoreResponse:
        self._wait()
        return self.llm.score(request)

    def detail(self, request: LlmRequest) -> DetailResponse:
        self._wait()
        return self.llm.detail(request)

    def _wait(self) -> None:
        with self._lock:
            time.sleep(max(0.0, self._last + self.interval - time.monotonic()))
            self._last = time.monotonic()


class GeminiLlm:
    """Gemini via google-genai's generateContent, with the response schema as its JSON schema.

    The client is made on first use, so a missing API key fails the analyzing stage, not start-up.
    The SDK's own retries stay off: transient errors are retried by Selection.
    """

    def __init__(self, settings: Settings, http_client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._http_client = http_client
        self._client: genai.Client | None = None

    def score(self, request: LlmRequest) -> ScoreResponse:
        return self._generate(request, ScoreResponse)

    def detail(self, request: LlmRequest) -> DetailResponse:
        return self._generate(request, DetailResponse)

    def _generate[R: BaseModel](self, request: LlmRequest, schema: type[R]) -> R:
        config = types.GenerateContentConfig(
            temperature=request.temperature,
            response_mime_type="application/json",
            response_json_schema=schema.model_json_schema(),
        )
        try:
            response = self._connect().models.generate_content(
                model=self.settings.gemini_model, contents=request.prompt, config=config
            )
        except errors.APIError as exc:
            raise _classify(exc) from exc
        except httpx.TransportError as exc:
            raise TransientLlmError(f"Couldn't reach Gemini: {exc}") from exc

        blocked = response.prompt_feedback.block_reason if response.prompt_feedback else None
        finish = response.candidates[0].finish_reason if response.candidates else None
        if refusal := blocked or (finish if finish in _BLOCKED else None):
            raise LlmError(f"Gemini refused to answer ({refusal.value}): its usage policies reject this content")
        return _parse(schema, response.text or "", "Gemini")

    def _connect(self) -> genai.Client:
        if not self.settings.gemini_api_key:
            raise LlmError(
                "GEMINI_API_KEY is not set: add your Gemini API key (https://aistudio.google.com/apikey) "
                "to .env and restart"
            )
        if self._client is None:
            options = types.HttpOptions(timeout=_TIMEOUT_MS, httpx_client=self._http_client)
            self._client = genai.Client(api_key=self.settings.gemini_api_key, http_options=options)
        return self._client


class OpenAiLlm:
    """An OpenAI-compatible Chat Completions API at LLM_BASE_URL, in JSON mode.

    JSON mode takes no schema, so a system message asks for JSON that fits the response schema and
    holds the schema; the prompt is the user message, unchanged, so that both providers get the same
    prompt. DeepSeek's `thinking` parameter goes to DeepSeek only, as other hosts may reject it.
    A missing API key fails the analyzing stage, not start-up. Transient errors are retried by Selection.
    """

    def __init__(self, settings: Settings, http_client: httpx.Client | None = None) -> None:
        self.settings = settings
        self._client = http_client or httpx.Client()

    def score(self, request: LlmRequest) -> ScoreResponse:
        return self._generate(request, ScoreResponse)

    def detail(self, request: LlmRequest) -> DetailResponse:
        return self._generate(request, DetailResponse)

    def _generate[R: BaseModel](self, request: LlmRequest, schema: type[R]) -> R:
        settings, name = self.settings, self.settings.llm_name
        if settings.selection_audio_signal:
            raise LlmError(
                "SELECTION_AUDIO_SIGNAL=true needs LLM_PROVIDER=gemini: only Gemini is sent the Windows' audio. "
                "Set SELECTION_AUDIO_SIGNAL=false or LLM_PROVIDER=gemini in .env and restart"
            )
        if not settings.llm_api_key:
            raise LlmError(f"LLM_API_KEY is not set: add your API key for {settings.llm_base_url} to .env and restart")
        thinking = settings.llm.thinking
        body = {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": _JSON_INSTRUCTION.format(schema=json.dumps(schema.model_json_schema()))},
                {"role": "user", "content": request.prompt},
            ],
            "temperature": request.temperature,
            "max_tokens": _THINKING_MAX_TOKENS if thinking else _MAX_TOKENS,
            "response_format": {"type": "json_object"},
        }
        if thinking is not None:
            body["thinking"] = {"type": "enabled" if thinking else "disabled"}
        try:
            response = self._client.post(
                f"{settings.llm_base_url.rstrip('/')}/chat/completions",
                json=body,
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                timeout=_TIMEOUT_MS / 1000,
            )
        except httpx.TransportError as exc:
            raise TransientLlmError(f"Couldn't reach {name}: {exc}") from exc
        if response.is_error:
            raise _http_error(response, name)

        try:
            choice = response.json()["choices"][0]
            content, finish = choice["message"]["content"] or "", choice["finish_reason"]
        except (ValueError, LookupError, TypeError) as exc:
            raise TransientLlmError(f"{name}'s answer is not a chat completion: {response.text[:200]}") from exc
        if not content.strip():
            raise TransientLlmError(f"{name}'s answer was empty (finish reason {finish})")
        return _parse(schema, content, name)


def _parse[R: BaseModel](schema: type[R], text: str, name: str) -> R:
    try:
        return schema.model_validate_json(text)
    except ValidationError as exc:
        first = exc.errors()[0]
        where = ".".join(str(part) for part in first["loc"])
        raise TransientLlmError(
            f"{name}'s answer didn't fit the {schema.__name__} schema ({where}: {first['msg']})"
        ) from exc


def _http_error(response: httpx.Response, name: str) -> LlmError:
    code, phrase = response.status_code, response.reason_phrase
    if code == 401:
        return LlmError(f"{name} rejected the API key ({code} {phrase}): check LLM_API_KEY in .env")
    detail = f"{code} {phrase}: {_server_message(response)}"
    if code == 402:
        return LlmError(f"{name}'s balance is used up: top up the {name} balance, then retry. {detail}")
    if code == 429:
        return QuotaExceeded(f"{name}'s rate limit is reached; try again later. {detail}", _retry_after(response))
    if code in (503, 504):
        return Overloaded(f"{name} is busy. {detail}")
    if code == 408 or code >= 500:
        return TransientLlmError(f"{name} is unavailable. {detail}")
    return LlmError(f"{name} rejected the request. {detail}")


def _server_message(response: httpx.Response) -> str:
    try:
        return str(response.json()["error"]["message"])
    except (ValueError, LookupError, TypeError):
        return response.text.strip()


def _retry_after(response: httpx.Response) -> float | None:
    """The wait in seconds of a Retry-After header, if it has one (an HTTP date isn't read)."""
    try:
        return max(0.0, float(response.headers["retry-after"]))
    except (KeyError, ValueError):
        return None


def _classify(exc: errors.APIError) -> LlmError:
    detail = f"{exc.code} {exc.status}: {exc.message}"
    if exc.code == 429 or exc.status == "RESOURCE_EXHAUSTED":
        return QuotaExceeded(f"Gemini's quota is used up; try again later. {detail}", _retry_delay(exc))
    if exc.code in (503, 504):
        return Overloaded(f"Gemini is busy. {detail}")
    if exc.code == 408 or exc.code >= 500:
        return TransientLlmError(f"Gemini is unavailable. {detail}")
    return LlmError(f"Gemini rejected the request. {detail}")


def _retry_delay(exc: errors.APIError) -> float | None:
    """The wait suggested by the error's RetryInfo detail, if it has a usable one."""
    try:
        body = exc.details.get("error", exc.details)
        delay = next(d["retryDelay"] for d in body["details"] if d.get("@type", "").endswith("google.rpc.RetryInfo"))
        return float(_DELAY.fullmatch(delay)[1])
    except (AttributeError, KeyError, StopIteration, TypeError):
        return None
