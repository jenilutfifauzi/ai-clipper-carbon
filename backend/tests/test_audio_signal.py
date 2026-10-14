"""Audio-signal mode (SELECTION_AUDIO_SIGNAL): the shortlisted Windows' audio goes to the Detail pass.

Seam A through the HTTP API, with the fake LLM, and with the real Gemini port against a mocked
generateContent (see test_gemini.py). The audio is extracted by the configured ffmpeg from the
62-minute episode with a tone added as its audio track.
"""

import base64
import json
import re
import subprocess
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app import audio
from app.audio import window_audio
from app.config import LlmChoice, Settings, load_settings
from app.evaluation import evaluate, gate, gate_summary
from app.llm import GeminiLlm, LlmRequest, OpenAiLlm, QuotaExceeded
from app.main import create_app
from app.ports import Ports
from app.prompts import DETAIL_AUDIO, PROMPT_VERSION
from conftest import EPISODE_SECS, wait_for
from fakes import FakeLlm
from test_evaluation import A, A_FOUND, A_MISSED, CLIPS
from test_gemini import FakeGeminiApi
from test_jobs_api import create_job

AUDIO_VERSION = f"{PROMPT_VERSION}-audio"
# A Score pass that notices three moments of the episode, as in test_selection.
MARKS = {"rugi": 95, "rahasia": 85, "nangis": 75}
# Gemini's fake scores, distinct for every Window and not in Transcript order.
SCORE = lambda id: int(id[1:]) * 37 % 101  # noqa: E731
SHORTLIST = re.compile(r"^- (w\d+) \[(\S+)–(\S+)\] ", re.M)


@pytest.fixture(scope="session")
def audible_episode(episode, tmp_path_factory) -> Path:
    """The 62-minute episode with a 220 Hz tone as its audio."""
    path = tmp_path_factory.mktemp("audible") / "episode.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-i", str(episode.video), "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=16000",
        "-t", str(EPISODE_SECS), "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "32k", str(path),
    ]
    subprocess.run(command, check=True)
    return path


@pytest.fixture
def settings(settings) -> Settings:
    """conftest's settings (Gemini) with audio-signal mode on."""
    return replace(settings, selection_audio_signal=True)


@pytest.fixture
def from_audible_episode(video_source, episode, audible_episode) -> None:
    video_source.video = audible_episode
    video_source.caption_track = episode.captions


@contextmanager
def app(settings: Settings, ports: Ports) -> Iterator[TestClient]:
    with TestClient(create_app(settings, ports)) as client:
        yield client


def gemini_port(settings: Settings, api: FakeGeminiApi) -> GeminiLlm:
    transport = httpx.MockTransport(api.handle)
    return GeminiLlm(replace(settings, gemini_api_key="test-key"), http_client=httpx.Client(transport=transport))


def job_dir(settings: Settings, job: dict) -> Path:
    return settings.data_dir / "jobs" / job["id"]


def selection(settings: Settings, job: dict) -> dict:
    return json.loads((job_dir(settings, job) / "selection.json").read_text())


def probe(settings: Settings, data: bytes) -> tuple[str, int, float]:
    """The codec, channels and duration of encoded audio."""
    with tempfile.NamedTemporaryFile(suffix=".ogg") as file:
        file.write(data)
        file.flush()
        command = [
            str(settings.ffprobe_bin), "-v", "error", "-show_entries", "format=duration:stream=codec_name,channels",
            "-of", "json", file.name,
        ]
        info = json.loads(subprocess.run(command, capture_output=True, check=True).stdout)
    [stream] = info["streams"]
    return stream["codec_name"], stream["channels"], float(info["format"]["duration"])


def analyzed(client: TestClient) -> dict:
    job = wait_for(client, create_job(client)["id"], "review", "error", timeout=30)
    assert job["status"] == "review", job["error"]
    return job


def marked(text: str) -> int:
    return max([score for word, score in MARKS.items() if word in text], default=30)


def test_the_detail_pass_hears_exactly_the_shortlisted_windows(client, settings, from_audible_episode, llm, wait_for_status):
    llm.score_window = marked
    job = analyzed(client)

    [detail] = llm.detail_requests
    shortlist = SHORTLIST.findall(detail.prompt)
    assert len(shortlist) == 2 * 7
    assert [(part.window_id, part.label, part.mime_type) for part in detail.audio] == [
        (id, f"Audio of window {id} [{start}–{end}]:", "audio/ogg") for id, start, end in shortlist
    ]
    run = selection(settings, job)
    windows = {window["id"]: window for window in run["windows"]}
    for part in detail.audio:
        codec, channels, duration = probe(settings, part.data)
        window = windows[part.window_id]
        assert (codec, channels) == ("opus", 1)
        assert duration == pytest.approx(window["end"] - window["start"], abs=0.05)
    # Each range's audio is kept with the Job.
    assert len(list((job_dir(settings, job) / "window_audio").glob("*.ogg"))) == len(shortlist)

    # Only the Detail prompt gets the AUDIO section: with no profile, Brief or examples, right
    # before TIME CONTRACT. The Score pass is sent no audio.
    assert f"\n\n{DETAIL_AUDIO}\n\nTIME CONTRACT — STRICT:\n" in detail.prompt
    assert "laughter" in DETAIL_AUDIO and "pacing" in DETAIL_AUDIO
    assert all(request.audio == () and "AUDIO:" not in request.prompt for request in llm.score_requests)

    # The run records the flag, the provider and the Windows heard.
    assert job["prompt_version"] == AUDIO_VERSION
    assert (run["prompt_version"], run["audio_signal"], run["audio_windows"]) == (
        AUDIO_VERSION, True, [id for id, *_ in shortlist]
    )
    assert run["llm"]["provider"] == "gemini"
    assert job["warnings"] == []


def test_with_the_flag_off_the_requests_are_as_before(
    client, settings, from_audible_episode, video_source, transcriber, llm, wait_for_status, tmp_path
):
    llm.score_window = marked
    analyzed(client)
    [heard] = llm.detail_requests

    text_only = FakeLlm()
    text_only.score_window = marked
    off = replace(settings, selection_audio_signal=False, data_dir=tmp_path / "off")
    with app(off, Ports(video_source, transcriber, text_only)) as off_client:
        job = wait_for(off_client, create_job(off_client)["id"], "review", "error", timeout=30)

    assert job["status"] == "review", job["error"]
    [detail] = text_only.detail_requests
    # No audio, and the AUDIO section is all that told the prompts apart.
    assert detail == LlmRequest(heard.prompt.replace(f"{DETAIL_AUDIO}\n\n", ""), heard.temperature)
    assert "AUDIO" not in detail.prompt
    assert text_only.score_requests == llm.score_requests
    assert job["prompt_version"] == PROMPT_VERSION
    run = selection(off, job)
    assert (run["prompt_version"], run["audio_signal"], run["audio_windows"]) == (PROMPT_VERSION, False, [])
    assert not (job_dir(off, job) / "window_audio").exists()


def test_the_gemini_port_sends_each_recording_inline_after_its_label_and_before_the_prompt(
    settings, video_source, transcriber, from_audible_episode
):
    api = FakeGeminiApi()
    api.score_window = SCORE
    with app(settings, Ports(video_source, transcriber, gemini_port(settings, api))) as client:
        job = wait_for(client, create_job(client)["id"], "review", "error", timeout=30)

    assert job["status"] == "review", job["error"]
    *scores, detail = [json.loads(request.content) for request in api.requests]
    assert all(body["contents"] == [{"parts": [{"text": body["contents"][0]["parts"][0]["text"]}], "role": "user"}] for body in scores)
    [content] = detail["contents"]
    assert content["role"] == "user"
    *recordings, prompt = content["parts"]
    shortlist = SHORTLIST.findall(prompt["text"])
    assert len(shortlist) == 14
    assert prompt["text"].startswith("You are a senior short-form video editor")
    assert f"\n{DETAIL_AUDIO}\n" in prompt["text"]
    assert [part["text"] for part in recordings[::2]] == [f"Audio of window {id} [{start}–{end}]:" for id, start, end in shortlist]
    # Each recording is the Window's audio file, as URL-safe base64 (google-genai writes the MIME type's key
    # as mime_type, one of the two spellings the API accepts).
    kept = sorted((job_dir(settings, job) / "window_audio").glob("*.ogg"), key=lambda path: int(path.name.split("-")[0]))
    assert len(kept) == len(shortlist)
    assert recordings[1::2] == [
        {"inlineData": {"data": base64.urlsafe_b64encode(path.read_bytes()).decode(), "mime_type": "audio/ogg"}} for path in kept
    ]
    assert detail["generationConfig"]["temperature"] == 0.9
    assert selection(settings, job)["audio_windows"] == [id for id, *_ in shortlist]


def test_past_the_size_cap_the_lowest_scored_windows_go_without_audio_and_the_job_warns(
    settings, video_source, transcriber, from_audible_episode, tmp_path
):
    def run(settings: Settings) -> tuple[dict, httpx.Request, dict]:
        api = FakeGeminiApi()
        api.score_window = SCORE
        with app(settings, Ports(video_source, transcriber, gemini_port(settings, api))) as client:
            job = wait_for(client, create_job(client)["id"], "review", "error", timeout=30)
        assert job["status"] == "review", job["error"]
        return job, api.requests[-1], selection(settings, job)

    _, full, first = run(settings)
    parts = json.loads(full.content)["contents"][0]["parts"]
    assert len(parts) == 2 * 14 + 1
    part_size = len(parts[1]["inlineData"]["data"])
    # Room for all but about two and a half recordings.
    cap = len(full.content) - int(2.5 * part_size)
    capped = replace(settings, data_dir=tmp_path / "capped", selection=replace(settings.selection, audio_request_max_bytes=cap))
    job, request, run_ = run(capped)

    assert len(request.content) <= cap
    shortlist = run_["shortlist"]
    assert shortlist == first["shortlist"]
    heard = run_["audio_windows"]
    sent = [part["text"].split()[3] for part in json.loads(request.content)["contents"][0]["parts"][:-1:2]]
    assert sent == heard
    # The best-scored are heard, in Transcript order; the 3 or 4 lowest-scored are not.
    ranked = sorted(shortlist, key=SCORE, reverse=True)
    assert 14 - 4 <= len(heard) <= 14 - 3
    assert set(heard) == set(ranked[: len(heard)])
    assert heard == [id for id in shortlist if id in heard]
    left_out = [id for id in shortlist if id not in heard]
    assert job["prompt_version"] == AUDIO_VERSION
    assert job["warnings"] == [
        {
            "stage": "analyzing",
            "message": f"Audio-signal mode: the audio of {len(left_out)} of the 14 shortlisted Windows "
            f"({', '.join(left_out)}, the lowest-scored) was left out, as the Detail request would pass "
            f"{cap / 1e6:g} MB, the size cap for Gemini's inline requests. They were judged on their transcript alone.",
        }
    ]


@pytest.fixture
def no_room(settings) -> Settings:
    return replace(settings, selection=replace(settings.selection, audio_request_max_bytes=1))


def test_with_no_room_for_any_audio_the_detail_request_is_text_only(
    no_room, video_source, transcriber, llm, from_audible_episode
):
    with app(no_room, Ports(video_source, transcriber, llm)) as client:
        job = wait_for(client, create_job(client)["id"], "review", "error", timeout=30)

    [detail] = llm.detail_requests
    assert detail.audio == ()
    assert "AUDIO:" not in detail.prompt
    assert job["prompt_version"] == PROMPT_VERSION
    run = selection(no_room, job)
    assert (run["audio_signal"], run["audio_windows"]) == (True, [])
    [warning] = job["warnings"]
    assert warning["message"].startswith(f"Audio-signal mode: the audio of 14 of the 14 shortlisted Windows ({', '.join(run['shortlist'])}, ")


@pytest.mark.quota(wait_secs=0.05)
def test_a_quota_error_on_the_detail_pass_waits_then_sends_the_same_audio(
    client, settings, from_audible_episode, llm, wait_for_status, monkeypatch
):
    detail = llm.detail
    requests: list[LlmRequest] = []

    def first_hits_the_quota(request: LlmRequest):
        requests.append(request)
        if len(requests) == 1:
            raise QuotaExceeded("Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: per minute")
        return detail(request)

    llm.detail = first_hits_the_quota
    encoded = []
    run = audio.subprocess.run
    monkeypatch.setattr(audio.subprocess, "run", lambda command, **kwargs: encoded.append(command) or run(command, **kwargs))
    job_id = create_job(client)["id"]

    assert wait_for_status(job_id, "waiting_quota", "review", "error", timeout=30)["status"] == "waiting_quota"
    job = wait_for_status(job_id, "review", "error", timeout=30)
    assert job["status"] == "review", job["error"]
    first, second = requests
    assert len(first.audio) == 14
    assert second == first
    # Each Window's audio was encoded once: the resumed run read it from the Job's files.
    assert len([command for command in encoded if "libopus" in command]) == 14


def test_window_audio_is_encoded_once_per_range_and_a_source_without_audio_fails_clearly(
    settings, audible_episode, episode, tmp_path, monkeypatch
):
    def extract(media: Path, start: float, end: float) -> bytes:
        return window_audio(settings.ffmpeg_bin, media, start, end, tmp_path / "cache", "16k", 16_000)

    data = extract(audible_episode, 10, 145)
    codec, channels, duration = probe(settings, data)
    assert (codec, channels) == ("opus", 1)
    assert duration == pytest.approx(135, abs=0.05)
    # About 16 kb/s: 135 s in about 270 kB.
    assert 200_000 < len(data) < 340_000

    def no_ffmpeg(*args, **kwargs):
        raise AssertionError("ffmpeg ran again")

    monkeypatch.setattr(audio.subprocess, "run", no_ffmpeg)
    assert extract(audible_episode, 10, 145) == data
    with pytest.raises(AssertionError, match="ffmpeg ran again"):
        extract(audible_episode, 10, 146)
    monkeypatch.undo()

    with pytest.raises(RuntimeError, match=r"ffmpeg couldn't extract the audio of episode\.mp4 from 10 to 145 s: "):
        window_audio(settings.ffmpeg_bin, episode.video, 10, 145, tmp_path / "silent", "16k", 16_000)
    assert list((tmp_path / "silent").iterdir()) == []


def test_audio_signal_with_the_openai_provider_fails_analyzing_before_any_request(
    settings, video_source, transcriber, from_audible_episode
):
    deepseek = replace(
        settings, llm_provider="openai", llm_base_url="https://api.deepseek.com", llm_api_key="test-key",
        llm_model="deepseek-flash",
    )
    requests: list[httpx.Request] = []
    transport = httpx.MockTransport(lambda request: requests.append(request) or httpx.Response(500))
    port = OpenAiLlm(deepseek, http_client=httpx.Client(transport=transport))
    with app(deepseek, Ports(video_source, transcriber, port)) as client:
        job = wait_for(client, create_job(client)["id"], "review", "error", timeout=30)

    assert (job["status"], job["stage"], job["error"]) == (
        "error",
        "analyzing",
        "SELECTION_AUDIO_SIGNAL=true needs LLM_PROVIDER=gemini: only Gemini is sent the Windows' audio. "
        "Set SELECTION_AUDIO_SIGNAL=false or LLM_PROVIDER=gemini in .env and restart",
    )
    assert requests == []
    assert not (job_dir(deepseek, job) / "window_audio").exists()


def test_an_audio_eval_report_is_kept_apart_and_compared_with_the_best_text_only_report(
    settings, video_source, transcriber, llm, from_audible_episode, tmp_path
):
    references = tmp_path / "eval-references.yaml"
    references.write_text(A_FOUND + A_MISSED)
    reports = tmp_path / "reports"
    ports = Ports(video_source, transcriber, llm)
    text_only = replace(settings, selection_audio_signal=False)

    # Two text-only runs: the better one, with 1 of 2 found and 2 judged postable, and one finding nothing.
    llm.clips = CLIPS
    best, best_folder = evaluate(text_only, ports, references, reports)
    (best_folder / "postable.yaml").write_text(f'"{A}": 2\n')
    llm.clips = []
    worse, _ = evaluate(text_only, ports, references, reports)
    assert (best.recall, worse.recall) == (0.5, 0.0)
    assert not best.audio_signal and best.episodes[0].audio_windows is None
    best_text = (best_folder / "report.md").read_text()
    assert "Audio signal" not in best_text and "audio for" not in best_text and "Compared" not in best_text

    llm.clips = CLIPS
    report, folder = evaluate(settings, ports, references, reports)

    assert len(llm.detail_requests[-1].audio) == 14
    assert (report.prompt_version, report.audio_signal) == (AUDIO_VERSION, True)
    assert folder.parent == reports / AUDIO_VERSION
    assert report.llm == LlmChoice("gemini", settings.gemini_model)
    [episode] = report.episodes
    assert (episode.shortlisted, episode.audio_windows, episode.found) == (14, 14, 1)
    saved = json.loads((folder / "report.json").read_text())
    assert (saved["audio_signal"], saved["episodes"][0]["audio_windows"]) == (True, 14)

    comparison = (
        f"Best text-only report: {best_folder} (prompt {PROMPT_VERSION}, gemini {settings.gemini_model}), "
        "the highest recall, then the most postable\n"
        "- Recall: 50.0% (1 of 2) text-only, 50.0% (1 of 2) with audio\n"
        f"- {A}: found 1 of 2 text-only, 1 of 2 with audio; postable 2 text-only, "
    )
    text = (folder / "report.md").read_text()
    assert "\nAudio signal: on. The Detail pass also heard each shortlisted Window's audio" in text
    assert f"\n## Compared with text-only selection\n\n{comparison}not judged with audio\n" in text
    assert " · 3 Candidates · audio for 14 of 14 shortlisted Windows\n" in text

    (folder / "postable.yaml").write_text(f'"{A}": 3\n')
    summary = gate_summary(gate(folder), folder)
    assert summary.endswith(
        "Compared with text-only selection:\n  " + "\n  ".join(f"{comparison}3 with audio".split("\n"))
    )
