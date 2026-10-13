"""Seam A with the real Gemini port: the HTTP API, with Gemini's REST API answered by an httpx
mock transport, so the port's requests and its handling of failures are real but no network is used.
"""

import json
import re
from dataclasses import replace

import httpx
import pytest

from app.llm import GeminiLlm
from fakes import windows_in
from test_jobs_api import create_job
from test_selection import clip


def answer(text: str) -> httpx.Response:
    return httpx.Response(200, json={"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}}]})


def error(code: int, status: str, message: str) -> httpx.Response:
    return httpx.Response(code, json={"error": {"code": code, "message": message, "status": status}})


# The details of a 429 from the free tier, as Gemini sends them.
QUOTA_FAILURE = {
    "@type": "type.googleapis.com/google.rpc.QuotaFailure",
    "violations": [
        {
            "quotaMetric": "generativelanguage.googleapis.com/generate_content_free_tier_requests",
            "quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
            "quotaDimensions": {"location": "global", "model": "gemini-3.6-flash"},
            "quotaValue": "5",
        }
    ],
}
HELP = {
    "@type": "type.googleapis.com/google.rpc.Help",
    "links": [{"description": "Learn more about Gemini API quotas", "url": "https://ai.google.dev/gemini-api/docs/rate-limits"}],
}


def retry_info(delay: object) -> dict:
    return {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": delay}


def quota_error(details: object) -> httpx.Response:
    """A free-tier 429 with these `details`, or none when None."""
    message = (
        "You exceeded your current quota, please check your plan and billing details. For more information on this "
        "error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. To monitor your current usage, head to: "
        "https://ai.dev/rate-limit. \n* Quota exceeded for metric: "
        "generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.6-flash\n"
        "Please retry in 32.418734917s."
    )
    body = {"code": 429, "message": message, "status": "RESOURCE_EXHAUSTED"}
    return httpx.Response(429, json={"error": body if details is None else body | {"details": details}})


class FakeGeminiApi:
    """generateContent, answered the way Gemini does: a Score prompt gets a score of 50 per Window,
    a Detail prompt gets `clips`. `fail_with(failure, ...)` answers the next requests with those
    responses instead, or raises them if they're exceptions. Every request is recorded."""

    def __init__(self) -> None:
        self.clips: list[dict] = []
        self.requests: list[httpx.Request] = []
        self._failures: list[httpx.Response | Exception] = []

    def fail_with(self, *failures: httpx.Response | Exception) -> None:
        self._failures += failures

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self._failures:
            failure = self._failures.pop(0)
            if isinstance(failure, Exception):
                raise failure
            return failure
        prompt = json.loads(request.content)["contents"][0]["parts"][0]["text"]
        if windows := windows_in(prompt):
            return answer(json.dumps({"windows": [{"id": id, "reason": "obrolan biasa", "score": 50} for id, *_ in windows]}))
        return answer(json.dumps({"clips": self.clips}))


@pytest.fixture
def gemini() -> FakeGeminiApi:
    return FakeGeminiApi()


@pytest.fixture
def llm(settings, gemini) -> GeminiLlm:
    """The real Gemini port, talking to `gemini`. Overrides conftest's fake LLM."""
    transport = httpx.MockTransport(gemini.handle)
    return GeminiLlm(replace(settings, gemini_api_key="test-key"), http_client=httpx.Client(transport=transport))


def test_job_reaches_review_through_the_gemini_port(client, from_episode, gemini, settings, wait_for_status):
    gemini.clips = [clip("10:00", "10:44", 80)]
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert job["status"] == "review", job["error"]
    assert [(c["start"], c["end"], c["predicted_score"]) for c in job["candidates"]] == [(599.65, 643.45, 80)]
    for request in gemini.requests:
        assert request.url.path == f"/v1beta/models/{settings.gemini_model}:generateContent"
        assert request.headers["x-goog-api-key"] == "test-key"
    *scores, detail = [json.loads(request.content)["generationConfig"] for request in gemini.requests]
    assert {config["temperature"] for config in scores} == {0.2}
    assert detail["temperature"] == 0.9
    for config, answer_field in [*((config, "windows") for config in scores), (detail, "clips")]:
        assert config["responseMimeType"] == "application/json"
        assert set(config["responseJsonSchema"]["properties"]) == {answer_field}


@pytest.mark.parametrize(
    "failure",
    [
        error(503, "UNAVAILABLE", "The model is overloaded. Please try again later."),
        error(500, "INTERNAL", "An internal error has occurred."),
        httpx.ConnectError("Connection refused"),
        httpx.ReadTimeout("The read operation timed out"),
        answer('{"windows": [{"id": "w001", "reason": "seru", "score": "tinggi"}]}'),
    ],
    ids=["503", "500", "connection", "timeout", "off-schema"],
)
def test_transient_gemini_failures_are_retried(client, gemini, wait_for_status, failure):
    gemini.fail_with(failure, failure)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert job["status"] == "review", job["error"]
    assert len(gemini.requests) == 4  # the one Score request three times, then the Detail request


@pytest.mark.quota(wait_secs=0.2)
@pytest.mark.parametrize(
    ("code", "status", "message"),
    [
        (503, "UNAVAILABLE", "This model is currently experiencing high demand. Spikes in demand are usually temporary."),
        (504, "DEADLINE_EXCEEDED", "Deadline expired before operation could complete."),
    ],
    ids=["503", "504"],
)
def test_gemini_busy_past_the_retries_makes_the_job_wait_then_go_on(
    client, gemini, settings, wait_for_status, code, status, message
):
    gemini.fail_with(*[error(code, status, message)] * settings.selection.llm_attempts)
    job_id = create_job(client)["id"]

    waiting = wait_for_status(job_id, "waiting_quota", "review", "error")
    assert waiting["message"].endswith(f"(in 0.2 s). Gemini is busy. {code} {status}: {message}")
    job = wait_for_status(job_id, "review", "error")
    assert job["status"] == "review", job["error"]
    # The Score request until the retries ran out, then again after the wait, then the Detail request.
    assert len(gemini.requests) == settings.selection.llm_attempts + 2


@pytest.mark.quota(wait_secs=60, max_wait_secs=60)
@pytest.mark.parametrize(
    ("details", "wait"),
    [
        ([QUOTA_FAILURE, HELP, retry_info("32s")], "32 s"),
        ([retry_info("2.5s")], "2.51 s"),  # with the margin of 0.01 s
        # Without a usable suggestion, the first wait of the schedule.
        ([QUOTA_FAILURE, HELP], "1 min"),
        (None, "1 min"),
        ([retry_info("soon")], "1 min"),
        ([retry_info(32)], "1 min"),
        ([{"@type": "type.googleapis.com/google.rpc.RetryInfo"}], "1 min"),
        ("RetryInfo: 32s", "1 min"),
    ],
    ids=["free-tier", "fractional", "no-retry-info", "no-details", "text-delay", "number-delay", "no-delay", "text-details"],
)
def test_a_quota_error_waits_as_long_as_gemini_suggests(client, gemini, wait_for_status, details, wait):
    gemini.fail_with(quota_error(details))
    job = wait_for_status(create_job(client)["id"], "waiting_quota", "review", "error")

    assert job["status"] == "waiting_quota"
    expected = rf"Trying again at \d\d:\d\d:\d\d \(in {re.escape(wait)}\)\. Gemini's quota is used up; try again later\. 429 "
    assert re.match(expected, job["message"])
    assert len(gemini.requests) == 1


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        # With no time left to wait for the quota, the first quota error fails the Job.
        pytest.param(
            error(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota."),
            "Gave up after waiting 0 s for Gemini's quota. "
            "Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: You exceeded your current quota.",
            marks=pytest.mark.quota(give_up_secs=0),
        ),
        (
            error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."),
            "Gemini rejected the request. 400 INVALID_ARGUMENT: API key not valid. Please pass a valid API key.",
        ),
        (
            httpx.Response(200, json={"promptFeedback": {"blockReason": "PROHIBITED_CONTENT"}}),
            "Gemini refused to answer (PROHIBITED_CONTENT): its usage policies reject this content",
        ),
    ],
    ids=["quota", "bad-key", "blocked"],
)
def test_other_gemini_failures_put_the_job_in_error_at_once(client, gemini, wait_for_status, failure, message):
    gemini.fail_with(failure)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"], job["error"]) == ("error", "analyzing", message)
    assert len(gemini.requests) == 1


def test_missing_api_key_fails_analyzing_with_a_clear_message(client, llm, gemini, settings, wait_for_status):
    llm.settings = replace(settings, gemini_api_key=None)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"]) == ("error", "analyzing")
    assert job["error"] == (
        "GEMINI_API_KEY is not set: add your Gemini API key (https://aistudio.google.com/apikey) to .env and restart"
    )
    assert gemini.requests == []
