"""Seam A: steering Selection with the Channel Profile, the Brief and few-shot examples, through
the HTTP API, with a fake LLM that records the requests it gets."""

import json
import re

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ports import Ports
from conftest import caption_track
from test_evaluation import entry
from test_jobs_api import URL, create_job
from test_selection import analyzed

EMPTY = {"niche": "", "audience": "", "clip_style": "", "avoid": ""}
PROFILE = {
    "niche": "Podcast bisnis dan karier anak muda",
    "audience": "Pekerja kantoran umur 20-an",
    "clip_style": "Cerita personal yang jujur",
    "avoid": "Politik dan gosip artis",
}

EVAL = "https://www.youtube.com/watch?v=EEEEEEEEEEE"
F = "https://www.youtube.com/watch?v=FFFFFFFFFFF"
G = "https://www.youtube.com/watch?v=GGGGGGGGGGG"
H = "https://www.youtube.com/watch?v=HHHHHHHHHHH"

# Caption lines of a fewshot episode, 3 s each with their Words 0.5 s apart.
FEWSHOT_LINES = [
    (10, "ini contoh lucu banget"),
    (14, "terus dia ketawa"),
    (18, "habis itu selesai"),
    (30, "momen kedua yang seru"),
    (34, "beneran deh"),
]
EXAMPLE_10_18 = '<example duration="8 s">\nNote: ketawanya pecah\nTranscript: ini contoh lucu banget terus dia ketawa\n</example>'
EXAMPLE_30_38 = '<example duration="8 s">\nNote: pengakuan jujur\nTranscript: momen kedua yang seru beneran deh\n</example>'


def put_profile(client, **fields) -> dict:
    response = client.put("/api/profile", json=fields)
    assert response.status_code == 200, response.text
    return response.json()


def test_channel_profile_is_empty_until_replaced_and_is_kept_across_restarts(
    client, settings, video_source, transcriber, llm
):
    assert client.get("/api/profile").json() == EMPTY

    assert put_profile(client, **PROFILE) == PROFILE
    assert client.get("/api/profile").json() == PROFILE

    # A PUT replaces the whole profile: a field it leaves out is emptied. Edges are trimmed.
    assert put_profile(client, niche="  Podcast bisnis \n") == EMPTY | {"niche": "Podcast bisnis"}
    assert client.put("/api/profile", json={"niche": 5}).status_code == 422
    assert client.get("/api/profile").json() == EMPTY | {"niche": "Podcast bisnis"}

    assert json.loads((settings.data_dir / "profile.json").read_text())["niche"] == "Podcast bisnis"
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        assert restarted.get("/api/profile").json() == EMPTY | {"niche": "Podcast bisnis"}


def test_a_job_keeps_the_profile_it_was_created_with(client, video_source, llm, wait_for_status):
    put_profile(client, **PROFILE)
    video_source.hold()
    job = create_job(client)
    assert job["profile"] == PROFILE

    put_profile(client, niche="Podcast horor")
    video_source.release()
    job = wait_for_status(job["id"], "review", "error")
    assert job["profile"] == PROFILE
    assert "Podcast bisnis dan karier anak muda" in llm.detail_requests[0].prompt
    assert "horor" not in llm.detail_requests[0].prompt

    later = analyzed(client, wait_for_status)
    assert later["profile"] == EMPTY | {"niche": "Podcast horor"}
    assert "- Niche: Podcast horor\n" in llm.detail_requests[1].prompt
    assert client.get(f"/api/jobs/{job['id']}").json()["profile"] == PROFILE


def test_brief_and_profile_reach_both_passes_the_score_pass_getting_the_profile_in_short(
    client, from_episode, llm, wait_for_status
):
    clip_style = "Cerita personal yang jujur\n\n- buka dengan pengakuan\n- tutup dengan pelajaran"
    avoid = "Politik praktis, gosip artis, " + ", ".join(f"topik sensitif nomor {i}" for i in range(12))
    assert len(avoid) > 200
    put_profile(client, niche="Podcast bisnis", clip_style=clip_style, avoid=avoid)
    brief = "cari momen yang lucu"
    job = analyzed(client, wait_for_status, brief=f"  {brief} ")
    assert job["options"]["brief"] == brief

    assert len(llm.score_requests) > 1
    for request in llm.score_requests:
        prompt = request.prompt
        assert f'BRIEF for this episode, from the channel\'s owner: "{brief}"' in prompt
        assert (
            "Niche: Podcast bisnis. Clip style: Cerita personal yang jujur - buka dengan pengakuan - "
            "tutup dengan pelajaran. Avoid: Politik praktis, gosip artis, topik sensitif nomor 0, "
        ) in prompt
        shortened = re.search(r"Avoid: (.*)…\n", prompt)[1]
        assert len(shortened) <= 200 and avoid.startswith(shortened)
        assert avoid not in prompt

    [detail] = llm.detail_requests
    prompt = detail.prompt
    profile = (
        "- Niche: Podcast bisnis\n- Clip style: Cerita personal yang jujur\n  - buka dengan pengakuan\n"
        f"  - tutup dengan pelajaran\n- Avoid: {avoid}\n"
    )
    assert profile in prompt
    assert f'BRIEF for this episode, from the channel\'s owner: "{brief}"' in prompt
    # The steering sits between the episode's material and the rules.
    positions = [prompt.index(text) for text in ("SHORTLISTED WINDOWS", profile, brief, "TIME CONTRACT")]
    assert positions == sorted(positions)


def test_few_shot_examples_reach_the_detail_pass_only_from_captions_fetched_once(
    client, settings, video_source, llm, tmp_path, wait_for_status
):
    video_source.captions[F] = caption_track(tmp_path / "fewshot.json3", FEWSHOT_LINES)
    settings.reference_set.write_text(
        entry(EVAL, "1:00", "1:40", "klip eval")
        + entry("https://youtu.be/FFFFFFFFFFF", "0:10", "0:18", "ketawanya pecah", "fewshot")
        + entry(F, "0:30", "0:38", "pengakuan jujur", "fewshot")
    )
    first = analyzed(client, wait_for_status)

    [detail] = llm.detail_requests
    # Each clip's note and the Words of exactly its range: the line starting at 0:18 is left out.
    assert f"{EXAMPLE_10_18}\n{EXAMPLE_30_38}\n\nTIME CONTRACT" in detail.prompt
    assert not any("<example" in r.prompt or "ketawanya" in r.prompt for r in llm.score_requests)
    # Only the fewshot episode's captions are fetched, never its video, nor anything of the eval episode.
    assert video_source.calls == [(URL, "id")]
    assert video_source.caption_calls == [(F, "id")]

    second = analyzed(client, wait_for_status)
    assert video_source.caption_calls == [(F, "id")]
    assert f"{EXAMPLE_10_18}\n{EXAMPLE_30_38}\n" in llm.detail_requests[1].prompt
    assert first["warnings"] == second["warnings"] == []


def test_few_shot_clips_without_captions_are_left_out_with_a_warning(
    client, settings, video_source, llm, tmp_path, wait_for_status
):
    video_source.captions = {
        F: caption_track(tmp_path / "fewshot.json3", FEWSHOT_LINES),
        G: None,
        H: RuntimeError("Video unavailable"),
    }
    settings.reference_set.write_text(
        entry(G, "0:10", "0:18", "tanpa caption", "fewshot")
        + entry(H, "0:10", "0:18", "videonya hilang", "fewshot")
        + entry(F, "0:10", "0:18", "ketawanya pecah", "fewshot")
        + entry(F, "5:00", "5:10", "di luar caption", "fewshot")
    )
    job = analyzed(client, wait_for_status)

    assert job["warnings"] == [
        {"stage": "analyzing", "message": message}
        for message in [
            f"{G} has no 'id' YouTube captions: its clip is left out of the few-shot examples",
            f"Couldn't fetch the captions of {H} (Video unavailable): its clip is left out of the few-shot examples",
            f"{settings.reference_set}:16: the captions of {F} have no words between 5:00 and 5:10: "
            "that clip is left out of the few-shot examples",
        ]
    ]
    [detail] = llm.detail_requests
    assert detail.prompt.count("<example ") == 1
    assert EXAMPLE_10_18 in detail.prompt
    assert video_source.calls == [(URL, "id")]
    assert video_source.caption_calls == [(G, "id"), (H, "id"), (F, "id")]


@pytest.mark.parametrize(
    ("profile", "brief", "sections"),
    [
        ({}, None, set()),
        ({}, "cari momen yang lucu", {"brief"}),
        ({"audience": "Pekerja kantoran umur 20-an"}, None, {"profile"}),
    ],
)
def test_prompts_leave_out_the_sections_they_have_nothing_for(client, llm, wait_for_status, profile, brief, sections):
    put_profile(client, **profile)
    job = analyzed(client, wait_for_status, **({"brief": brief} if brief else {}))

    assert job["status"] == "review"
    assert job["profile"] == EMPTY | profile
    assert job["warnings"] == []
    for request in [*llm.score_requests, *llm.detail_requests]:
        prompt = request.prompt
        assert "\n\n\n" not in prompt
        assert ("BRIEF" in prompt) == ("brief" in sections)
        assert ("CHANNEL" in prompt or "channel profile" in prompt) == ("profile" in sections)
        assert "EXAMPLE" not in prompt and "<example" not in prompt
        assert "Niche" not in prompt and "Avoid" not in prompt and "avoids" not in prompt


def test_a_reference_set_listing_an_episode_under_both_roles_fails_the_job_before_any_fetch(
    client, settings, video_source, llm, wait_for_status
):
    settings.reference_set.write_text(
        entry(F, "1:00", "1:40", "klip eval") + entry("https://youtu.be/FFFFFFFFFFF", "0:10", "0:18", "contoh", "fewshot")
    )
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"]) == ("error", "analyzing")
    assert f"{settings.reference_set}:6: {F} is a fewshot episode here and an eval episode on line 1" in job["error"]
    assert video_source.caption_calls == []
    assert llm.score_requests == []
