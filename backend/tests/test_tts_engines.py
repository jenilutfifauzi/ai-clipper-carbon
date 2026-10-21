"""The cloud speech engines' adapters (app/voices.py, docs/adr/0019), with their REST APIs answered by an
httpx mock transport: the requests and the handling of answers and failures are real, no network is used."""

import base64
import json
from dataclasses import replace

import httpx
import numpy as np
import pytest

from app.voices import GeminiSpeech, SpeechError, TransientSpeechError


def pcm_answer(samples: np.ndarray, rate: int = 24_000) -> httpx.Response:
    """generateContent's answer with AUDIO, as Gemini TTS sends it: raw 16-bit PCM, base64."""
    data = base64.b64encode(samples.astype("<i2").tobytes()).decode()
    part = {"inlineData": {"mimeType": f"audio/L16;codec=pcm;rate={rate}", "data": data}}
    return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": [part]}, "finishReason": "STOP"}]})


def error(code: int, status: str, message: str, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(code, headers=headers, json={"error": {"code": code, "message": message, "status": status}})


def gemini(settings, answer: httpx.Response) -> tuple[GeminiSpeech, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return answer

    engine = GeminiSpeech(replace(settings, gemini_api_key="key-123"), httpx.Client(transport=httpx.MockTransport(handle)))
    return engine, requests


def test_gemini_is_sent_the_voice_and_the_sentence_and_its_audio_decodes_to_pcm_at_the_stated_rate(settings):
    tone = (np.sin(np.arange(2400) / 10) * 8000).astype("<i2")
    engine, requests = gemini(settings, pcm_answer(tone, rate=22_050))
    pcm = engine.read("Halo semua.", "Kore")
    assert pcm.rate == 22_050 and np.array_equal(pcm.samples, tone)
    assert pcm.secs == pytest.approx(2400 / 22_050)

    [request] = requests
    assert request.url.path == f"/v1beta/models/{settings.tts_gemini_model}:generateContent"
    assert request.headers["x-goog-api-key"] == "key-123"
    body = json.loads(request.content)
    assert body["contents"][0]["parts"] == [{"text": "Halo semua."}]
    config = body["generationConfig"]
    assert config["responseModalities"] == ["AUDIO"]
    assert config["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]["voiceName"] == "Kore"


def test_gemini_is_sent_the_style_before_the_sentence(settings):
    engine, requests = gemini(settings, pcm_answer(np.zeros(10)))
    engine.read("Halo semua.", "Puck", style="warm, unhurried")
    assert json.loads(requests[0].content)["contents"][0]["parts"] == [{"text": "warm, unhurried: Halo semua."}]


@pytest.mark.parametrize(
    "answer",
    [
        error(401, "UNAUTHENTICATED", "Request had invalid authentication credentials."),
        error(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers."),
        error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."),
    ],
)
def test_a_refused_key_says_to_check_gemini_api_key(settings, answer):
    engine, _ = gemini(settings, answer)
    with pytest.raises(SpeechError, match="GEMINI_API_KEY") as raised:
        engine.read("Halo.", "Kore")
    assert not isinstance(raised.value, TransientSpeechError)


def test_an_answer_without_audio_fails_naming_gemini(settings):
    engine, _ = gemini(settings, httpx.Response(200, json={"candidates": [{"finishReason": "OTHER"}]}))
    with pytest.raises(SpeechError, match="Gemini TTS gave no audio for a sentence \\(OTHER\\)"):
        engine.read("Halo.", "Kore")


@pytest.mark.parametrize(
    ("answer", "retry_after"),
    [
        (error(429, "RESOURCE_EXHAUSTED", "Quota exceeded.", headers={"Retry-After": "7"}), 7.0),
        (error(429, "RESOURCE_EXHAUSTED", "Quota exceeded."), None),
        (error(500, "INTERNAL", "Internal error."), None),
        (error(503, "UNAVAILABLE", "The model is overloaded.", headers={"Retry-After": "2"}), 2.0),
    ],
)
def test_a_rate_limit_or_a_server_error_is_transient_with_its_retry_after(settings, answer, retry_after):
    engine, _ = gemini(settings, answer)
    with pytest.raises(TransientSpeechError, match=f"Gemini TTS is busy \\({answer.status_code}\\)") as raised:
        engine.read("Halo.", "Kore")
    assert raised.value.retry_after == retry_after


def test_a_network_failure_is_transient(settings):
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    engine = GeminiSpeech(replace(settings, gemini_api_key="key"), httpx.Client(transport=httpx.MockTransport(handle)))
    with pytest.raises(TransientSpeechError, match="Couldn't reach Gemini TTS"):
        engine.read("Halo.", "Kore")
