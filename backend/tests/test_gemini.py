"""Seam A with the real Gemini port: the HTTP API, with Gemini's REST API answered by an httpx
mock transport, so the port's requests and its handling of failures are real but no network is used.
"""

import json
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


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (
            error(429, "RESOURCE_EXHAUSTED", "You exceeded your current quota."),
            "Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: You exceeded your current quota.",
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
