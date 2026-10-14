"""Seam A: review operations through the HTTP API, with fakes at the ports.

Most tests use the 62-minute episode from conftest: line k starts at 4k s, its six Words last 0.5 s
each and touch, and the line ends in 1 s of silence. So an edge on a line's first Word takes the
whole 0.35 s lead-in, one on its last Word the whole 0.45 s tail, and one inside a line neither.
"""

import pytest
from fastapi.testclient import TestClient

from app.jobs import JobStore
from app.main import create_app
from app.pipeline import Pipeline
from app.ports import Ports
from test_jobs_api import create_job
from test_selection import analyzed, clip, spans


def candidate_url(job: dict, candidate: dict) -> str:
    return f"/api/jobs/{job['id']}/candidates/{candidate['id']}"


def patch(client, job: dict, candidate: dict, **change) -> dict:
    response = client.patch(candidate_url(job, candidate), json=change)
    assert response.status_code == 200, response.text
    return response.json()


def candidates(client, job: dict) -> list[dict]:
    return client.get(f"/api/jobs/{job['id']}").json()["candidates"]


def test_an_update_resnaps_the_bounds_to_words(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    assert (candidate["start"], candidate["end"], candidate["edited"]) == (599.65, 643.45, False)

    # Times inside Words mean those Words. Inside a line the Words touch: no lead-in or tail.
    moved = patch(client, job, candidate, start=601.2, end=630.1)
    assert (moved["start"], moved["end"], moved["edited"]) == (601.0, 630.5, True)
    # Times in a silence mean the Words after (start) and before (end) it, with lead-in and tail.
    moved = patch(client, job, candidate, start=599.2, end=635.5)
    assert (moved["start"], moved["end"]) == (599.65, 635.45)
    # An edge sent back as it is stays where it is.
    assert patch(client, job, candidate, start=599.65) == moved
    assert patch(client, job, candidate, end=635.45) == moved
    # A Word's start and another's end, as the Transcript Picker sends them, mean those Words. The
    # Job's 20–90 s range isn't enforced on the owner's edits.
    moved = patch(client, job, candidate, start=604.5, end=610.0)
    assert (moved["start"], moved["end"]) == (604.5, 610.0)

    [stored] = candidates(client, job)
    assert stored == moved
    words = job["transcript"]["words"]
    assert not any(word["start"] < edge < word["end"] for word in words for edge in spans({"candidates": [stored]})[0])
    # Only the edit changed: the AI's assessment and copy are as they were.
    assert {k: v for k, v in stored.items() if k not in {"start", "end", "edited"}} == {
        k: v for k, v in candidate.items() if k not in {"start", "end", "edited"}
    }


def test_hook_layout_and_selected_flag_are_saved_and_survive_a_restart(
    client, settings, video_source, transcriber, from_episode, llm, wait_for_status
):
    llm.clips = [clip("10:00", "10:44", 80), clip("20:00", "20:40", 70)]
    job = analyzed(client, wait_for_status)
    first, second = job["candidates"]

    edited = patch(client, job, first, hook_text="  Gue pernah\nrugi   500 juta ", layout="split")
    assert (edited["hook_text"], edited["layout"], edited["selected"], edited["edited"]) == (
        "Gue pernah rugi 500 juta", "split", False, True
    )
    # Selecting isn't an edit of the clip itself.
    chosen = patch(client, job, second, selected=True)
    assert (chosen["selected"], chosen["edited"]) == (True, False)
    assert patch(client, job, first, selected=True)["selected"] is True
    # The Job changed, as for any other change: its time moves and its listeners are told.
    assert client.get(f"/api/jobs/{job['id']}").json()["updated_at"] > job["updated_at"]

    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        stored = restarted.get(f"/api/jobs/{job['id']}").json()["candidates"]
    assert [(c["id"], c["hook_text"], c["layout"], c["selected"]) for c in stored] == [
        (first["id"], "Gue pernah rugi 500 juta", "split", True),
        (second["id"], second["hook_text"], "auto", True),
    ]
    # Back to auto, and unselected.
    patch(client, job, first, layout="auto", selected=False)
    assert [(c["layout"], c["selected"]) for c in candidates(client, job)] == [("auto", False), ("auto", True)]


def test_a_manual_candidate_is_added_snapped_and_listed_after_the_ai_ones(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)

    response = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": 1199.2, "end": 1230.2})
    assert response.status_code == 201, response.text
    manual = response.json()
    # From the first Word after the silence, less the lead-in, to the end of the Word holding 1230.2 s.
    assert (manual["start"], manual["end"]) == (1199.65, 1230.5)
    assert manual["origin"] == "manual"
    assert (manual["predicted_score"], manual["hook_strength"], manual["window_id"]) == (None, None, None)
    assert (manual["title"], manual["hook_text"], manual["layout"], manual["selected"]) == ("", "", "auto", False)

    listed = candidates(client, job)
    assert [c["origin"] for c in listed] == ["ai", "manual"]
    assert listed[1] == manual
    # It is edited like any other.
    assert patch(client, job, manual, hook_text="Momen yang terlewat", selected=True)["selected"] is True


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"start": 640.0, "end": 620.0}, "start before end"),
        ({"start": 630.0, "end": 630.0}, "start before end"),
        ({"start": -1.0}, "within the Source"),
        ({"end": 62 * 60 + 1.0}, "within the Source"),
        ({"start": 599.1, "end": 599.9}, "No Words between"),  # a silence
        ({"start": 600.0, "end": 900.0}, "at most 180 s"),
        ({"layout": "zoom"}, None),
        ({"hook_text": "x" * 201}, None),
        ({"selected": "maybe"}, None),
        ({"title": "Not editable"}, None),
    ],
)
def test_invalid_edits_are_rejected_and_change_nothing(client, from_episode, llm, wait_for_status, change, message):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]

    response = client.patch(candidate_url(job, candidate), json=change)
    assert response.status_code == 422, response.text
    if message:
        assert message in response.json()["detail"]
    if "start" in change and "end" in change:
        response = client.post(f"/api/jobs/{job['id']}/candidates", json=change)
        assert response.status_code == 422, response.text
    assert candidates(client, job) == [candidate]


def test_edits_need_a_known_candidate_of_a_job_in_review(client, video_source, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]

    assert client.patch(f"/api/jobs/{job['id']}/candidates/00000000", json={"selected": True}).status_code == 404
    assert client.patch(f"/api/jobs/0123456789ab/candidates/{candidate['id']}", json={}).status_code == 404
    assert client.post("/api/jobs/0123456789ab/candidates", json={"start": 600, "end": 630}).status_code == 404

    video_source.hold()
    running = create_job(client)
    wait_for_status(running["id"], "downloading")
    response = client.post(f"/api/jobs/{running['id']}/candidates", json={"start": 600, "end": 630})
    assert response.status_code == 409
    assert "while it is in review" in response.json()["detail"]
    video_source.release()


def test_analyzing_again_keeps_edited_selected_and_manual_candidates(
    client, settings, video_source, transcriber, from_episode, llm, wait_for_status
):
    llm.clips = [
        clip("10:00", "10:44", 90, title="A"),
        clip("20:00", "20:40", 80, title="B"),
        clip("30:00", "30:40", 70, title="C"),
    ]
    job = analyzed(client, wait_for_status)
    a, b, c = job["candidates"]
    a = patch(client, job, a, hook_text="Hook baru")
    b = patch(client, job, b, selected=True)
    manual = client.post(f"/api/jobs/{job['id']}/candidates", json={"start": 2400.0, "end": 2430.0}).json()

    # `make reanalyze`: Selection runs again and proposes other clips.
    llm.clips = [
        clip("10:20", "11:00", 95, title="A2"),  # shares Words with the edited A
        clip("40:00", "40:40", 85, title="M2"),  # shares Words with the manual one
        clip("30:00", "30:40", 70, title="C2"),  # where the untouched C was
        clip("50:00", "50:40", 60, title="D"),
    ]
    Pipeline(JobStore(settings.data_dir / "jobs"), Ports(video_source, transcriber, llm), settings).run(job["id"])

    after = candidates(client, job)
    # The reviewed ones are kept as they were; the untouched C is replaced; new clips on a kept one's
    # Words are left out. The AI's by predicted score, then the manual one.
    assert [candidate["title"] for candidate in after] == ["A", "B", "C2", "D", ""]
    assert after[0] == a and after[1] == b and after[4] == manual
    assert after[2]["id"] != c["id"]
    assert client.get(f"/api/jobs/{job['id']}").json()["status"] == "review"


def test_media_is_served_with_range_requests(client, wait_for_status, fixture_video):
    job = wait_for_status(create_job(client)["id"], "review", "error")
    url = f"/media/{job['id']}/{job['source']['video']}"
    data = fixture_video.read_bytes()

    whole = client.get(url)
    assert whole.status_code == 200
    assert whole.headers["accept-ranges"] == "bytes"
    assert whole.headers["content-type"] == "video/mp4"
    assert whole.content == data

    part = client.get(url, headers={"Range": "bytes=100-299"})
    assert part.status_code == 206
    assert part.headers["content-range"] == f"bytes 100-299/{len(data)}"
    assert part.content == data[100:300]

    tail = client.get(url, headers={"Range": f"bytes={len(data) - 10}-"})
    assert tail.status_code == 206
    assert tail.content == data[-10:]


@pytest.mark.parametrize(
    "path",
    [
        "..%2F{other}%2Fsource.mp4",  # another Job's video, through ..
        "%2E%2E%2F%2E%2E%2Fjobs%2F{other}%2Fsource.mp4",
        "%2F{root}%2F{other}%2Fsource.mp4",  # an absolute path
        "job.json",  # not media
        "missing.mp4",
    ],
)
def test_media_outside_a_job_or_not_media_is_refused(client, settings, wait_for_status, path):
    job = wait_for_status(create_job(client)["id"], "review", "error")
    other = wait_for_status(create_job(client)["id"], "review", "error")
    root = str(settings.data_dir / "jobs").strip("/").replace("/", "%2F")

    response = client.get(f"/media/{job['id']}/" + path.format(other=other["id"], root=root))
    assert response.status_code == 404
    assert client.get(f"/media/not-a-job/{job['source']['video']}").status_code == 404


def test_style_presets_are_listed_made_changed_and_deleted_but_not_builtin_ones(client):
    builtins = client.get("/api/presets").json()
    assert [preset["id"] for preset in builtins][:1] == ["default"] and all(preset["builtin"] for preset in builtins)
    assert builtins[0]["caption"]["size"] == 110 and builtins[0]["hook"]["size"] == 88

    made = client.post("/api/presets", json={"name": " Brand ", "caption": {"active_colour": "#00aaff"}})
    assert made.status_code == 201, made.text
    preset = made.json()
    assert (preset["name"], preset["caption"]["active_colour"], preset["builtin"]) == ("Brand", "#00AAFF", False)
    assert client.get("/api/presets").json() == [*builtins, preset]

    changed = client.put(f"/api/presets/{preset['id']}", json={"name": "Brand 2", "hook": {"radius": 0}}).json()
    assert (changed["name"], changed["hook"]["radius"], changed["caption"]["active_colour"]) == ("Brand 2", 0, "#FF9F0A")
    assert client.delete(f"/api/presets/{preset['id']}").status_code == 204
    assert client.get("/api/presets").json() == builtins

    assert client.put("/api/presets/default", json={"name": "x"}).status_code == 409
    assert client.delete("/api/presets/default").status_code == 409
    assert client.delete(f"/api/presets/{preset['id']}").status_code == 404
    assert client.put("/api/presets/nope", json={"name": "x"}).status_code == 404
    for body in ({"name": ""}, {"name": "x", "caption": {"size": 5}}, {"name": "x", "hook": {"font": "nope"}},
                 {"name": "x", "caption": {"colour": "red"}}, {"name": "x", "extra": 1}):
        assert client.post("/api/presets", json=body).status_code == 422, body


def test_a_candidates_preset_and_overrides_are_saved_and_mark_it_edited(client, from_episode, llm, wait_for_status):
    llm.clips = [clip("10:00", "10:44", 80)]
    job = analyzed(client, wait_for_status)
    [candidate] = job["candidates"]
    assert (candidate["preset_id"], candidate["style_overrides"]) == ("default", {"caption": {}, "hook": {}})

    styled = patch(client, job, candidate, preset_id="yellow-pop", style_overrides={"caption": {"size": 90}})
    assert (styled["preset_id"], styled["style_overrides"]["caption"], styled["edited"]) == ("yellow-pop", {"size": 90}, True)
    assert candidates(client, job) == [styled]

    assert client.patch(candidate_url(job, candidate), json={"preset_id": "nope"}).status_code == 404
    for overrides in ({"caption": {"size": 5}}, {"hook": {"glow": 1}}, {"caption": {"font": "nope"}}):
        response = client.patch(candidate_url(job, candidate), json={"style_overrides": overrides})
        assert response.status_code == 422, overrides
    assert candidates(client, job) == [styled]
