"""Seam A with the real OpenAI-compatible port: the HTTP API, with DeepSeek's Chat Completions API
answered by an httpx mock transport, so the port's requests and its handling of failures are real
but no network is used.
"""

import json
import re
from dataclasses import replace

import httpx
import pytest

from app.config import LlmChoice
from app.jobs import JobStore
from app.llm import ClipProposal, DetailResponse, GeminiLlm, LlmRequest, OpenAiLlm, ScoreResponse
from app.ports import real_ports
from fakes import windows_in
from test_jobs_api import create_job
from test_selection import clip

DEEPSEEK = "https://api.deepseek.com"
WINDOW = '<window id="w001" start="0:00" end="1:30">\nhalo semua\n</window>'


def answer(content: str | None, finish_reason: str = "stop") -> httpx.Response:
    message = {"role": "assistant", "content": content}
    choice = {"index": 0, "message": message, "finish_reason": finish_reason}
    return httpx.Response(200, json={"id": "c1", "object": "chat.completion", "model": "deepseek-flash", "choices": [choice]})


def error(code: int, message: str, headers: dict[str, str] | None = None) -> httpx.Response:
    body = {"error": {"message": message, "type": "invalid_request_error", "param": None, "code": "invalid_request_error"}}
    return httpx.Response(code, headers=headers, json=body)


class FakeChatApi:
    """chat/completions, answered the way DeepSeek does in JSON mode: a Score prompt gets a score of
    50 per Window, a Detail prompt gets `clips`. `fail_with(failure, ...)` answers the next requests
    with those responses instead, or raises them if they're exceptions. Every request is recorded."""

    def __init__(self) -> None:
        self.clips: list[dict] = []
        self.requests: list[httpx.Request] = []
        self._failures: list[httpx.Response | Exception] = []

    def fail_with(self, *failures: httpx.Response | Exception) -> None:
        self._failures += failures

    def bodies(self) -> list[dict]:
        return [json.loads(request.content) for request in self.requests]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self._failures:
            failure = self._failures.pop(0)
            if isinstance(failure, Exception):
                raise failure
            return failure
        prompt = json.loads(request.content)["messages"][-1]["content"]
        if windows := windows_in(prompt):
            return answer(json.dumps({"windows": [{"id": id, "reason": "obrolan biasa", "score": 50} for id, *_ in windows]}))
        return answer(json.dumps({"clips": self.clips}))


@pytest.fixture
def settings(settings):
    """conftest's settings, with DeepSeek as the LLM."""
    return replace(
        settings,
        llm_provider="openai",
        llm_base_url=DEEPSEEK,
        llm_api_key="test-key",
        llm_model="deepseek-flash",
        llm_thinking=False,
        selection_audio_signal=False,
    )


@pytest.fixture
def api() -> FakeChatApi:
    return FakeChatApi()


@pytest.fixture
def llm(settings, api) -> OpenAiLlm:
    """The real OpenAI-compatible port, talking to `api`. Overrides conftest's fake LLM."""
    return OpenAiLlm(settings, http_client=httpx.Client(transport=httpx.MockTransport(api.handle)))


def test_job_reaches_review_through_the_openai_port_and_records_the_llm(
    client, from_episode, api, settings, wait_for_status
):
    api.clips = [clip("10:00", "10:44", 80)]
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert job["status"] == "review", job["error"]
    assert [(c["start"], c["end"], c["predicted_score"]) for c in job["candidates"]] == [(599.65, 643.45, 80)]
    for request in api.requests:
        assert str(request.url) == "https://api.deepseek.com/chat/completions"
        assert request.headers["authorization"] == "Bearer test-key"
    *scores, detail = api.bodies()
    assert {body["temperature"] for body in scores} == {0.2}
    assert detail["temperature"] == 0.9
    for body, schema in [*((body, ScoreResponse) for body in scores), (detail, DetailResponse)]:
        assert body["model"] == "deepseek-flash"
        assert body["response_format"] == {"type": "json_object"}
        assert body["max_tokens"] == 16_384
        assert body["thinking"] == {"type": "disabled"}
        system, user = body["messages"]
        assert system["role"] == "system"
        assert "JSON" in system["content"]
        assert json.dumps(schema.model_json_schema()) in system["content"]
        # The prompt goes as Selection wrote it, with nothing about JSON added.
        assert user["role"] == "user"
        assert "json" not in user["content"].lower()

    selection = JobStore(settings.data_dir / "jobs").load_selection(job["id"])
    assert selection.llm == LlmChoice("openai", "deepseek-flash", thinking=False)


@pytest.mark.parametrize(
    ("base_url", "url", "thinking", "max_tokens"),
    [
        (DEEPSEEK, "https://api.deepseek.com/chat/completions", {"type": "enabled"}, 65_536),
        ("https://api.openai.com/v1/", "https://api.openai.com/v1/chat/completions", None, 16_384),
    ],
    ids=["deepseek", "other-host"],
)
def test_the_port_parses_both_answers_and_sends_thinking_to_deepseek_only(
    llm, api, settings, base_url, url, thinking, max_tokens
):
    llm.settings = replace(settings, llm_base_url=base_url, llm_thinking=True)
    api.clips = [clip("0:10", "0:50", 80)]

    assert llm.score(LlmRequest(f"Score these.\n{WINDOW}", 0.2)) == ScoreResponse.model_validate(
        {"windows": [{"id": "w001", "reason": "obrolan biasa", "score": 50}]}
    )
    [proposal] = llm.detail(LlmRequest("Choose clips.", 0.9)).clips
    assert proposal == ClipProposal.model_validate(api.clips[0])

    assert [str(request.url) for request in api.requests] == [url, url]
    for body in api.bodies():
        assert body.get("thinking") == thinking
        assert body["max_tokens"] == max_tokens


@pytest.mark.parametrize(
    "failure",
    [
        error(500, "Server error"),
        error(502, "Bad gateway"),
        error(503, "Server overloaded, please retry shortly."),
        httpx.ConnectError("Connection refused"),
        httpx.ReadTimeout("The read operation timed out"),
        answer(""),
        answer(None),
        answer('{"windows": [{"id": "w001", "reason": "seru", "score": "tinggi"}]}'),
        answer('{"windows": [{"id": "w001", "reas', finish_reason="length"),
    ],
    ids=["500", "502", "503", "connection", "timeout", "empty", "null", "off-schema", "cut-off"],
)
def test_transient_failures_are_retried(client, api, wait_for_status, failure):
    api.fail_with(failure, failure)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert job["status"] == "review", job["error"]
    assert len(api.requests) == 4  # the one Score request three times, then the Detail request


@pytest.mark.quota(wait_secs=0.2)
@pytest.mark.parametrize(
    ("code", "phrase"), [(503, "Service Unavailable"), (504, "Gateway Timeout")], ids=["503", "504"]
)
def test_deepseek_busy_past_the_retries_makes_the_job_wait_then_go_on(
    client, api, settings, wait_for_status, code, phrase
):
    api.fail_with(*[error(code, "Server overloaded, please retry shortly.")] * settings.selection.llm_attempts)
    job_id = create_job(client)["id"]

    waiting = wait_for_status(job_id, "waiting_quota", "review", "error")
    assert waiting["message"].endswith(f"(in 0.2 s). DeepSeek is busy. {code} {phrase}: Server overloaded, please retry shortly.")
    job = wait_for_status(job_id, "review", "error")
    assert job["status"] == "review", job["error"]
    assert len(api.requests) == settings.selection.llm_attempts + 2


@pytest.mark.quota(wait_secs=60, max_wait_secs=60)
@pytest.mark.parametrize(
    ("headers", "wait"),
    [
        ({"Retry-After": "7"}, "7.01 s"),  # with the margin of 0.01 s
        # Without a wait in seconds, the first wait of the schedule.
        (None, "1 min"),
        ({"Retry-After": "Tue, 13 Oct 2026 07:28:00 GMT"}, "1 min"),
    ],
    ids=["retry-after", "none", "http-date"],
)
def test_a_rate_limit_waits_as_long_as_retry_after_says(client, api, wait_for_status, headers, wait):
    api.fail_with(error(429, "Rate Limit Reached", headers))
    job = wait_for_status(create_job(client)["id"], "waiting_quota", "review", "error")

    assert job["status"] == "waiting_quota"
    expected = (
        rf"Trying again at \d\d:\d\d:\d\d \(in {re.escape(wait)}\)\. "
        r"DeepSeek's rate limit is reached; try again later\. 429 Too Many Requests: Rate Limit Reached$"
    )
    assert re.match(expected, job["message"])
    assert len(api.requests) == 1


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (
            error(401, "Authentication Fails, Your api key: ****-key is invalid"),
            "DeepSeek rejected the API key (401 Unauthorized): check LLM_API_KEY in .env",
        ),
        (
            error(402, "Insufficient Balance"),
            "DeepSeek's balance is used up: top up the DeepSeek balance, then retry. "
            "402 Payment Required: Insufficient Balance",
        ),
        (
            error(422, "Invalid max_tokens value"),
            "DeepSeek rejected the request. 422 Unprocessable Entity: Invalid max_tokens value",
        ),
    ],
    ids=["bad-key", "no-balance", "bad-parameter"],
)
def test_other_failures_put_the_job_in_error_at_once(client, api, wait_for_status, failure, message):
    api.fail_with(failure)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"], job["error"]) == ("error", "analyzing", message)
    assert len(api.requests) == 1


@pytest.mark.parametrize(
    ("change", "message"),
    [
        (
            {"llm_api_key": None},
            "LLM_API_KEY is not set: add your API key for https://api.deepseek.com to .env and restart",
        ),
        (
            {"selection_audio_signal": True},
            "SELECTION_AUDIO_SIGNAL=true needs LLM_PROVIDER=gemini: only Gemini is sent the Windows' audio. "
            "Set SELECTION_AUDIO_SIGNAL=false or LLM_PROVIDER=gemini in .env and restart",
        ),
    ],
    ids=["missing-key", "audio-signal"],
)
def test_settings_the_port_cannot_work_with_fail_analyzing_with_a_clear_message(
    client, llm, api, settings, wait_for_status, change, message
):
    llm.settings = replace(settings, **change)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"], job["error"]) == ("error", "analyzing", message)
    assert api.requests == []


def test_real_ports_use_the_provider_the_settings_choose(settings):
    assert isinstance(real_ports(settings).llm, OpenAiLlm)
    assert isinstance(real_ports(replace(settings, llm_provider="gemini")).llm, GeminiLlm)
