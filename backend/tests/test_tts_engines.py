"""The cloud speech engines' adapters (app/voices.py, docs/adr/0019), with their REST APIs answered by an
httpx mock transport: the requests and the handling of answers and failures are real, no network is used."""

import base64
import io
import json
import struct
import wave
from dataclasses import replace

import httpx
import numpy as np
import pytest

from app.voices import OPENAI_VOICES, ElevenLabsSpeech, GeminiSpeech, OpenAiSpeech, SpeechError, TransientSpeechError, Voice


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


def test_gemini_takes_a_style_and_no_speed_of_its_own(settings):
    engine, requests = gemini(settings, pcm_answer(np.zeros(10)))
    assert (engine.takes_style, engine.takes_speed) == (True, False)
    engine.read("Halo semua.", "Puck", style="calm")
    # No speed anywhere in its request: the runner retimes what it reads.
    assert "speed" not in requests[0].content.decode().lower()


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


@pytest.mark.parametrize(
    ("header", "retry_after"),
    [("3600", 30.0), ("30.5", 30.0), ("12.5", 12.5), ("inf", None), ("nan", None), ("-5", None), ("soon", None)],
)
def test_a_retry_after_is_capped_at_thirty_seconds_and_one_that_isnt_a_wait_is_none(settings, header, retry_after):
    engine, _ = gemini(settings, error(429, "RESOURCE_EXHAUSTED", "Quota exceeded.", headers={"Retry-After": header}))
    with pytest.raises(TransientSpeechError) as raised:
        engine.read("Halo.", "Kore")
    assert raised.value.retry_after == retry_after


def test_a_network_failure_is_transient(settings):
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    engine = GeminiSpeech(replace(settings, gemini_api_key="key"), httpx.Client(transport=httpx.MockTransport(handle)))
    with pytest.raises(TransientSpeechError, match="Couldn't reach Gemini TTS"):
        engine.read("Halo.", "Kore")


def wav_answer(samples: np.ndarray, rate: int = 24_000, channels: int = 1, streamed: bool = False) -> httpx.Response:
    """/audio/speech's answer as a WAV file; `streamed` writes the sizes a streaming service can't know
    yet (0xFFFFFFFF), as OpenAI's does."""
    out = io.BytesIO()
    with wave.open(out, "wb") as file:
        file.setnchannels(channels)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(samples.astype("<i2").tobytes())
    data = out.getvalue()
    if streamed:
        data = data[:4] + struct.pack("<I", 0xFFFFFFFF) + data[8:40] + struct.pack("<I", 0xFFFFFFFF) + data[44:]
    return httpx.Response(200, headers={"content-type": "audio/wav"}, content=data)


def openai(settings, answer: httpx.Response, **changes) -> tuple[OpenAiSpeech, list[httpx.Request]]:
    requests: list[httpx.Request] = []

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return answer

    configured = replace(settings, **{"tts_base_url": "https://speech.example/v1", "tts_api_key": "sk-speech", "tts_model": "tts-model", **changes})
    return OpenAiSpeech(configured, httpx.Client(transport=httpx.MockTransport(handle))), requests


@pytest.mark.parametrize("streamed", [False, True])
def test_openai_is_sent_the_model_voice_and_sentence_and_its_wav_decodes_to_pcm_at_its_rate(settings, streamed):
    tone = (np.sin(np.arange(2400) / 10) * 8000).astype("<i2")
    engine, requests = openai(settings, wav_answer(tone, rate=22_050, streamed=streamed))
    pcm = engine.read("Halo semua.", "coral")
    assert pcm.rate == 22_050 and np.array_equal(pcm.samples, tone)

    [request] = requests
    assert (request.method, str(request.url)) == ("POST", "https://speech.example/v1/audio/speech")
    assert request.headers["authorization"] == "Bearer sk-speech"
    assert json.loads(request.content) == {"model": "tts-model", "input": "Halo semua.", "voice": "coral", "response_format": "wav"}


@pytest.mark.parametrize(
    ("model", "tts_style", "takes_style"),
    [
        ("gpt-4o-mini-tts", None, True),
        ("tts-1", None, False),
        ("kokoro", None, False),
        ("kokoro", True, True),
        ("gpt-4o-mini-tts", False, False),
    ],
)
def test_openai_takes_a_style_by_tts_style_else_by_whether_the_model_takes_instructions(settings, model, tts_style, takes_style):
    engine, _ = openai(settings, wav_answer(np.zeros(1)), tts_model=model, tts_style=tts_style)
    assert (engine.takes_style, engine.takes_speed) == (takes_style, True)


def test_openai_is_sent_its_speed_and_the_style_as_instructions(settings):
    engine, requests = openai(settings, wav_answer(np.zeros(10)), tts_model="gpt-4o-mini-tts")
    engine.read("Halo semua.", "coral", style=" warm, unhurried ", speed=1.5)
    assert json.loads(requests[0].content) == {
        "model": "gpt-4o-mini-tts",
        "input": "Halo semua.",
        "voice": "coral",
        "response_format": "wav",
        "instructions": "warm, unhurried",
        "speed": 1.5,
    }


def test_openai_is_sent_no_instructions_when_it_takes_no_style_and_no_speed_at_1x(settings):
    engine, requests = openai(settings, wav_answer(np.zeros(10)), tts_model="tts-1")
    engine.read("Halo semua.", "coral", style="warm", speed=1.0)
    body = json.loads(requests[0].content)
    assert "instructions" not in body and "speed" not in body
    engine.read("Halo semua.", "coral", speed=0.5)
    assert json.loads(requests[1].content)["speed"] == 0.5


def test_openai_stereo_wav_is_mixed_down_to_mono(settings):
    left, right = np.full(100, 1000), np.full(100, 3000)
    engine, _ = openai(settings, wav_answer(np.column_stack([left, right]).ravel(), channels=2))
    pcm = engine.read("Halo.", "coral")
    assert len(pcm.samples) == 100 and set(pcm.samples.tolist()) == {2000}


def test_openai_raw_pcm_is_read_at_24_khz(settings):
    tone = np.arange(-50, 50).astype("<i2")
    engine, _ = openai(settings, httpx.Response(200, headers={"content-type": "audio/pcm"}, content=tone.tobytes()))
    pcm = engine.read("Halo.", "coral")
    assert pcm.rate == 24_000 and np.array_equal(pcm.samples, tone)


def test_openai_audio_it_cant_decode_fails_naming_the_service(settings):
    engine, _ = openai(settings, httpx.Response(200, headers={"content-type": "audio/mpeg"}, content=b"ID3\x04nope"))
    with pytest.raises(SpeechError, match="speech.example TTS gave audio that isn't WAV \\(audio/mpeg\\)"):
        engine.read("Halo.", "coral")


def openai_error(code: int, message: str, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(code, headers=headers, json={"error": {"message": message, "type": "invalid_request_error"}})


@pytest.mark.parametrize("code", [401, 403])
def test_openai_refused_key_says_to_check_tts_api_key(settings, code):
    engine, _ = openai(settings, openai_error(code, "Incorrect API key provided."))
    with pytest.raises(SpeechError, match="speech.example TTS refused TTS_API_KEY: check the key in .env and restart") as raised:
        engine.read("Halo.", "coral")
    assert not isinstance(raised.value, TransientSpeechError)


@pytest.mark.parametrize(
    ("answer", "retry_after"),
    [
        (openai_error(429, "Rate limit reached.", headers={"Retry-After": "7"}), 7.0),
        (openai_error(500, "The server had an error."), None),
        (httpx.Response(502, text="Bad Gateway"), None),
    ],
)
def test_openai_rate_limit_or_server_error_is_transient_with_its_retry_after(settings, answer, retry_after):
    engine, _ = openai(settings, answer)
    with pytest.raises(TransientSpeechError, match=f"speech.example TTS is busy \\({answer.status_code}\\)") as raised:
        engine.read("Halo.", "coral")
    assert raised.value.retry_after == retry_after


def test_openai_other_refusal_fails_with_its_message(settings):
    engine, _ = openai(settings, openai_error(400, "Invalid voice: zoe"))
    with pytest.raises(SpeechError, match="speech.example TTS failed \\(400\\): Invalid voice: zoe") as raised:
        engine.read("Halo.", "zoe")
    assert not isinstance(raised.value, TransientSpeechError)


def test_openai_network_failure_is_transient(settings):
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    configured = replace(settings, tts_base_url="https://speech.example/v1", tts_api_key="k", tts_model="m")
    engine = OpenAiSpeech(configured, httpx.Client(transport=httpx.MockTransport(handle)))
    with pytest.raises(TransientSpeechError, match="Couldn't reach speech.example TTS"):
        engine.read("Halo.", "coral")


def test_openai_names_its_service_and_lists_the_standard_voices_or_tts_voices(settings):
    engine, _ = openai(settings, wav_answer(np.zeros(1)))
    assert (engine.id, engine.label, engine.service, engine.local, engine.takes_style) == ("openai", "speech.example", "speech.example", False, False)
    assert engine.voices() == OPENAI_VOICES
    assert {"alloy", "coral", "nova", "onyx", "shimmer"} <= {voice.id for voice in engine.voices()}
    official, _ = openai(replace(settings, tts_voices=("Coral", "my-clone")), wav_answer(np.zeros(1)), tts_base_url="https://api.openai.com/v1")
    assert (official.label, official.service) == ("OpenAI", "OpenAI")
    assert [(voice.id, voice.name) for voice in official.voices()] == [("Coral", "Coral"), ("my-clone", "my-clone")]


ACCOUNT_VOICES = {
    "voices": [
        {"voice_id": "21m00Tcm4TlvDq8ikWAM", "name": "Rachel", "category": "premade", "labels": {"accent": "american", "gender": "female"}},
        {"voice_id": "my-clone-1", "name": "Jeni", "category": "cloned", "labels": {}},
    ]
}


def elevenlabs(settings, *answers: httpx.Response, voices: httpx.Response | None = None) -> tuple[ElevenLabsSpeech, list[httpx.Request]]:
    """ElevenLabs answering the account's Voices with `voices` (ACCOUNT_VOICES by default), and each
    read with the next of `answers`."""
    requests: list[httpx.Request] = []
    reads = list(answers)

    def handle(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path == "/v1/voices":
            return voices or httpx.Response(200, json=ACCOUNT_VOICES)
        return reads.pop(0)

    engine = ElevenLabsSpeech(replace(settings, elevenlabs_api_key="xi-123"), httpx.Client(transport=httpx.MockTransport(handle)))
    return engine, requests


def elevenlabs_error(code: int, status: str, message: str, headers: dict | None = None) -> httpx.Response:
    return httpx.Response(code, headers=headers, json={"detail": {"status": status, "message": message}})


def test_elevenlabs_is_sent_the_sentence_and_its_model_for_raw_pcm_at_24_khz(settings):
    tone = np.arange(-50, 50).astype("<i2")
    engine, requests = elevenlabs(settings, httpx.Response(200, headers={"content-type": "audio/pcm"}, content=tone.tobytes()))
    pcm = engine.read("Halo semua.", "21m00Tcm4TlvDq8ikWAM")
    assert pcm.rate == 24_000 and np.array_equal(pcm.samples, tone)

    [request] = requests
    assert request.url.path == "/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM"
    assert request.url.params["output_format"] == "pcm_24000"
    assert request.headers["xi-api-key"] == "xi-123"
    # At 1× no voice_settings: the Voice reads with its own.
    assert json.loads(request.content) == {"text": "Halo semua.", "model_id": "eleven_multilingual_v2"}


def test_elevenlabs_takes_a_speed_within_its_range_and_no_style(settings):
    engine, requests = elevenlabs(settings, httpx.Response(200, content=b"\0\0"))
    assert (engine.takes_style, engine.takes_speed, engine.speed_range) == (False, True, (0.7, 1.2))
    engine.read("Halo.", "my-clone-1", speed=1.2)
    assert json.loads(requests[0].content)["voice_settings"] == {"speed": 1.2}


def test_elevenlabs_lists_the_accounts_voices_with_their_labels_read_any_language(settings):
    engine, _ = elevenlabs(settings)
    assert (engine.id, engine.label, engine.service, engine.local) == ("elevenlabs", "ElevenLabs", "ElevenLabs", False)
    assert engine.voices() == [
        Voice("21m00Tcm4TlvDq8ikWAM", "Rachel", "Female · American · premade"),
        Voice("my-clone-1", "Jeni", "Cloned"),
    ]
    assert engine.ready()


def test_elevenlabs_voices_are_asked_once_and_kept(settings):
    engine, requests = elevenlabs(settings)
    engine.voices(), engine.ready(), engine.voices()
    [request] = requests
    assert request.headers["xi-api-key"] == "xi-123"


def test_elevenlabs_whose_voices_cant_be_listed_isnt_ready_and_is_asked_again_later(settings):
    engine, requests = elevenlabs(settings, voices=elevenlabs_error(401, "invalid_api_key", "Invalid API key"))
    assert engine.voices() == [] and not engine.ready()
    # Remembered a little while, so one listing of the engines doesn't ask three times...
    assert len(requests) == 1
    # ...then asked again.
    engine._failed_at -= 60
    engine.voices()
    assert len(requests) == 2


def test_elevenlabs_without_a_key_isnt_ready_and_asks_nothing(settings):
    requests: list[httpx.Request] = []
    engine = ElevenLabsSpeech(settings, httpx.Client(transport=httpx.MockTransport(lambda r: requests.append(r) or httpx.Response(500))))
    assert not engine.ready() and engine.voices() == [] and requests == []


@pytest.mark.parametrize("code", [401, 403])
def test_elevenlabs_refused_key_says_to_check_elevenlabs_api_key(settings, code):
    engine, _ = elevenlabs(settings, elevenlabs_error(code, "invalid_api_key", "Invalid API key"))
    with pytest.raises(SpeechError, match="ElevenLabs refused ELEVENLABS_API_KEY: check the key in .env and restart") as raised:
        engine.read("Halo.", "my-clone-1")
    assert not isinstance(raised.value, TransientSpeechError)


def test_elevenlabs_out_of_credits_says_so(settings):
    engine, _ = elevenlabs(settings, elevenlabs_error(401, "quota_exceeded", "This request exceeds your quota."))
    with pytest.raises(SpeechError, match="ElevenLabs is out of credits: This request exceeds your quota"):
        engine.read("Halo.", "my-clone-1")


@pytest.mark.parametrize(
    ("answer", "retry_after"),
    [
        (elevenlabs_error(429, "too_many_concurrent_requests", "Too many requests.", headers={"Retry-After": "4"}), 4.0),
        (httpx.Response(503, text="Service Unavailable"), None),
    ],
)
def test_elevenlabs_rate_limit_or_server_error_is_transient_with_its_retry_after(settings, answer, retry_after):
    engine, _ = elevenlabs(settings, answer)
    with pytest.raises(TransientSpeechError, match=f"ElevenLabs is busy \\({answer.status_code}\\)") as raised:
        engine.read("Halo.", "my-clone-1")
    assert raised.value.retry_after == retry_after


def test_elevenlabs_other_refusal_fails_with_its_message(settings):
    validation = httpx.Response(422, json={"detail": [{"loc": ["body", "text"], "msg": "field required"}]})
    engine, _ = elevenlabs(settings, elevenlabs_error(400, "voice_not_found", "A voice with that ID does not exist."), validation)
    with pytest.raises(SpeechError, match="ElevenLabs failed \\(400\\): A voice with that ID does not exist"):
        engine.read("Halo.", "nobody")
    with pytest.raises(SpeechError, match="ElevenLabs failed \\(422\\): field required"):
        engine.read("Halo.", "nobody")


def test_elevenlabs_network_failure_is_transient(settings):
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    engine = ElevenLabsSpeech(replace(settings, elevenlabs_api_key="xi"), httpx.Client(transport=httpx.MockTransport(handle)))
    with pytest.raises(TransientSpeechError, match="Couldn't reach ElevenLabs"):
        engine.read("Halo.", "my-clone-1")
    assert not engine.ready()
