"""Seam A: a Candidate's Canvas Aspect (docs/adr/0022) through the HTTP API and the MCP tools, with
fakes at the ports: chosen with the Job, saved with each Revision, checked against, and rendered at
its Canvas's shape by the real ffmpeg."""

import json

import pytest

from app.jobs import CANDIDATES_FILE
from test_jobs_api import create_job
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp, reviewed  # noqa: F401 (fixtures)
from conftest import wait_for
from test_render import add, probe, render, render_video, rendered  # noqa: F401 (fixtures)
from test_review import candidate_url, candidates, patch
from test_selection import analyzed, clip


@pytest.fixture
def short(video_source, render_video) -> None:
    """The Video Source returns test_render's 6-second 640x360 (16:9) Source, its Words halo..ya."""
    video_source.video = render_video


def reviewed_job(client, **options) -> dict:
    job = wait_for(client, create_job(client, **options)["id"], "review", "error")
    assert job["status"] == "review", job["error"]
    return job


def test_selections_candidates_take_the_jobs_aspect(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status, aspect="16:9")
    assert job["options"]["aspect"] == "16:9"
    [candidate] = job["candidates"]
    assert candidate["aspect"] == "16:9"


def test_a_job_is_9_16_unless_it_says_and_an_unknown_aspect_is_refused(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    assert job["options"]["aspect"] == "9:16"
    assert job["candidates"][0]["aspect"] == "9:16"
    response = client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=x", "options": {"aspect": "4:3"}})
    assert response.status_code == 422, response.text


def test_a_candidate_added_by_hand_takes_the_jobs_aspect(client, short):
    job = reviewed_job(client, aspect="1:1")
    candidate = add(client, job, "halo", "kabar", selected=False)
    assert candidate["aspect"] == "1:1"


def test_a_candidate_saved_before_aspects_reads_as_9_16(client, settings, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status, aspect="16:9")
    path = settings.data_dir / "jobs" / job["id"] / CANDIDATES_FILE
    saved = json.loads(path.read_text())
    for candidate in saved:
        del candidate["aspect"]
    path.write_text(json.dumps(saved))
    [candidate] = candidates(client, job)
    assert candidate["aspect"] == "9:16"


def test_changing_the_aspect_makes_a_revision_listed_under_layout_and_an_unknown_one_is_refused(
    client, from_episode, llm, wait_for_status
):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    changed = patch(client, job, candidate, aspect="16:9")
    assert (changed["aspect"], changed["revision"], changed["edited"]) == ("16:9", 2, True)
    [newest, *_] = client.get(f"{candidate_url(job, candidate)}/revisions").json()["revisions"]
    assert newest["parts"] == ["Layout"]

    response = client.patch(candidate_url(job, candidate), json={"aspect": "21:9"})
    assert response.status_code == 422, response.text
    # Restoring the first Revision brings 9:16 back.
    restored = client.post(f"{candidate_url(job, candidate)}/revisions/1/restore").json()
    assert (restored["aspect"], restored["revision"]) == ("9:16", 3)


def test_positions_are_kept_on_the_candidates_canvas(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    start = 0.0
    layer = {"id": "t", "text": "Judul", "start": start, "secs": 1, "transform": {"x": 1500, "y": 1800}, "keys": {"x": [{"at": 0, "value": 1700}]}}
    # On 9:16 a centre past the frame is brought onto it, as before.
    portrait = patch(client, job, candidate, text_layers=[layer])
    [placed] = portrait["text_layers"]
    assert (placed["transform"]["x"], placed["transform"]["y"], placed["keys"]["x"][0]["value"]) == (1080, 1800, 1080)
    # On 16:9 it is on the frame: 1920 wide, 1080 tall.
    landscape = patch(client, job, portrait, aspect="16:9", text_layers=[layer])
    [placed] = landscape["text_layers"]
    assert (placed["transform"]["x"], placed["transform"]["y"], placed["keys"]["x"][0]["value"]) == (1500, 1080, 1700)

    # A Cue Edit placed off the Canvas is refused, as one off the frame was.
    response = client.patch(candidate_url(job, candidate), json={"cue_edits": [{"at": 600.5, "x": 1500, "y": 500}]})
    assert response.status_code == 200, response.text
    assert response.json()["cue_edits"][0]["x"] == 1500
    response = client.patch(candidate_url(job, candidate), json={"cue_edits": [{"at": 600.5, "x": 500, "y": 1500}]})
    assert response.status_code == 422 and "1080" in response.text, response.text
    response = client.patch(candidate_url(job, candidate), json={"aspect": "9:16", "cue_edits": [{"at": 600.5, "x": 1500, "y": 500}]})
    assert response.status_code == 422 and "1080" in response.text, response.text


def test_the_clip_goes_stale_when_the_aspect_changes(client, short):
    job = reviewed_job(client)
    candidate = add(client, job, "halo", "kabar")
    render(client, job)
    [done] = rendered(client, job)["clips"]
    changed = patch(client, job, candidate, aspect="4:5")
    assert changed["revision"] == candidate["revision"] + 1
    [clip_now] = client.get(f"/api/jobs/{job['id']}").json()["clips"]
    assert clip_now["output"]["revision"] == done["output"]["revision"] != changed["revision"]


def test_the_preview_plan_is_on_the_candidates_canvas(client, short):
    job = reviewed_job(client, aspect="16:9")
    candidate = add(client, job, "halo", "kabar", selected=False)
    preview = client.post(f"{candidate_url(job, candidate)}/preview-plan").json()
    assert (preview["plan"]["width"], preview["plan"]["height"]) == (1920, 1080)
    # A draft's aspect is planned, not saved.
    square = client.post(f"{candidate_url(job, candidate)}/preview-plan", json={"aspect": "1:1"}).json()
    assert (square["plan"]["width"], square["plan"]["height"]) == (1080, 1080)
    assert candidates(client, job)[0]["aspect"] == "16:9"


# The render: the Canvas's shape at the Export Preset's short side


def video_size(settings, job: dict, clip: dict) -> tuple[int, int]:
    video = settings.data_dir / "jobs" / job["id"] / clip["output"]["video"]
    [picture] = [s for s in probe(settings, video)["streams"] if s["codec_type"] == "video"]
    return picture["width"], picture["height"]


def test_a_square_and_a_wide_candidate_render_at_their_shape(client, short, settings):
    job = reviewed_job(client, aspect="16:9")
    wide = add(client, job, "halo", "kabar")
    square = patch(client, job, add(client, job, "kita", "soal"), aspect="1:1")
    small = add(client, job, "Podcast", "ya", selected=False)
    render(client, job, [wide["id"], square["id"]])
    rendered(client, job, timeout=60)
    response = client.post(f"/api/jobs/{job['id']}/render", json={"candidate_ids": [small["id"]], "export_preset_id": "small"})
    assert response.status_code == 200, response.text
    clips = {clip["candidate_id"]: clip for clip in rendered(client, job, timeout=60)["clips"]}
    assert all(clip["status"] == "done" for clip in clips.values()), clips
    assert video_size(settings, job, clips[wide["id"]]) == (1920, 1080)
    assert video_size(settings, job, clips[square["id"]]) == (1080, 1080)
    assert video_size(settings, job, clips[small["id"]]) == (1280, 720)


# MCP


@pytest.mark.anyio
async def test_an_agent_makes_a_wide_job_and_reads_and_changes_a_candidates_aspect(mcp):
    job = await reviewed(mcp, aspect="16:9")
    assert job["options"]["aspect"] == "16:9"
    candidate = await manual(mcp, job, *HALO_KABAR)
    got = await call(mcp, "get_candidate", job_id=job["id"], candidate_id=candidate["id"])
    assert (got["aspect"], got["canvas"]) == ("16:9", {"width": 1920, "height": 1080})

    planned = await call(mcp, "edit_candidate", job_id=job["id"], candidate_id=candidate["id"], changes={"aspect": "4:5"}, dry_run=True)
    assert planned["canvas"] == {"width": 1080, "height": 1350, "safe_area": {"x": 54, "y": 68, "width": 972, "height": 1214}}
    changed = await call(mcp, "edit_candidate", job_id=job["id"], candidate_id=candidate["id"], changes={"aspect": "1:1"})
    assert (changed["aspect"], changed["revision"]) == ("1:1", candidate["revision"] + 1)
    assert "aspect" in await fails(mcp, "edit_candidate", job_id=job["id"], candidate_id=candidate["id"], changes={"aspect": "3:2"})
