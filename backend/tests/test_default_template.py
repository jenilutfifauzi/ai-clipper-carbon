"""The default Template for new Jobs (.scratch/templates/issues/08-default-template-for-new-jobs.md):
a Job's Template, the default unless chosen, is applied to each of its new Candidates before their
first save. Seam A, through the API (Selection with the fake LLM) and MCP."""

import pytest

from test_jobs_api import create_job
from test_mcp import HALO_KABAR, anyio_backend, call, manual, mcp, reviewed  # noqa: F401 (fixtures)
from test_review import candidates, patch
from test_selection import analyzed
from test_templates import URL, a_video, added, branded, saved


def made_default(client, template: dict | None) -> None:
    response = client.put(f"{URL}/default", json={"template_id": template and template["id"]})
    assert response.status_code == 200, response.text
    assert response.json() == {"template_id": template and template["id"]}


def defaults(client) -> list[str]:
    return [template["id"] for template in client.get(URL).json() if template["default"]]


def marks(candidate: dict) -> list[str | None]:
    return [item["template"] for kind in ("text_layers", "shapes") for item in candidate[kind]]


def test_a_new_jobs_candidates_arrive_with_the_default_template_at_revision_1(client, from_episode, llm, wait_for_status):
    first, source = branded(client, wait_for_status, llm)
    template = saved(client, first, source)
    assert defaults(client) == []
    made_default(client, template)
    assert defaults(client) == [template["id"]]

    job = analyzed(client, wait_for_status)

    assert job["options"]["template"] == template["id"]
    assert job["candidates"]
    for candidate in job["candidates"]:
        assert marks(candidate) == [template["id"]] * 3
        # Branded as Selection made it: nothing the owner did.
        assert (candidate["revision"], candidate["edited"]) == (1, False)
    assert job["warnings"] == []

    # A Candidate added by hand gets the Job's Template too.
    extra = added(client, job, 700.0, 712.0)
    assert marks(extra) == [template["id"]] * 3
    assert extra["revision"] == 1


def test_none_chosen_or_no_default_leaves_the_candidates_plain(client, from_episode, llm, wait_for_status):
    first, source = branded(client, wait_for_status, llm)
    template = saved(client, first, source)
    made_default(client, template)

    job = analyzed(client, wait_for_status, template=None)

    assert job["options"]["template"] is None
    assert all(marks(candidate) == [] for candidate in job["candidates"])
    assert marks(added(client, job, 700.0, 712.0)) == []

    made_default(client, None)
    assert defaults(client) == []
    assert analyzed(client, wait_for_status)["options"]["template"] is None


def test_another_template_can_be_chosen_and_an_unknown_one_is_refused(client, from_episode, llm, wait_for_status):
    first, source = branded(client, wait_for_status, llm)
    default = saved(client, first, source, name="Default")
    other = saved(client, first, source, name="Other", edits={"text_layers": [], "shapes": []})
    made_default(client, default)

    job = analyzed(client, wait_for_status, template=other["id"])

    assert job["options"]["template"] == other["id"]
    assert all(marks(candidate) == [] for candidate in job["candidates"])
    response = client.post("/api/jobs", json={"url": "https://www.youtube.com/watch?v=x", "options": {"template": "nope"}})
    assert response.status_code == 404
    assert client.put(f"{URL}/default", json={"template_id": "nope"}).status_code == 404


def test_a_template_deleted_before_selection_gives_plain_candidates_and_a_job_notice(
    client, video_source, from_episode, llm, wait_for_status
):
    first, source = branded(client, wait_for_status, llm)
    template = saved(client, first, source)
    made_default(client, template)

    video_source.hold()
    try:
        held = create_job(client)
        wait_for_status(held["id"], "downloading")
        assert client.delete(f"{URL}/{template['id']}").status_code == 204
    finally:
        video_source.release()
    job = wait_for_status(held["id"], "review", "error")

    assert job["status"] == "review", job["error"]
    assert job["options"]["template"] == template["id"]
    assert all(marks(candidate) == [] for candidate in job["candidates"])
    notice = f"Template {template['id']} was deleted: new Candidates are made without it."
    assert [warning["message"] for warning in job["warnings"]] == [notice]
    # Adding one by hand tells it once.
    assert marks(added(client, job, 700.0, 712.0)) == []
    assert [warning["message"] for warning in client.get(f"/api/jobs/{job['id']}").json()["warnings"]] == [notice]


def test_deleting_the_default_template_clears_it(client, from_episode, llm, wait_for_status):
    first, source = branded(client, wait_for_status, llm)
    template = saved(client, first, source)
    kept = saved(client, first, source, name="Kept")
    made_default(client, template)

    assert client.delete(f"{URL}/{kept['id']}").status_code == 204
    assert defaults(client) == [template["id"]]
    # Saving over it keeps it the default.
    over = client.put(f"{URL}/{template['id']}", json={"name": "Brand 2", "job_id": first["id"], "candidate_id": source["id"]})
    assert over.status_code == 200, over.text
    assert defaults(client) == [template["id"]]

    assert client.delete(f"{URL}/{template['id']}").status_code == 204
    assert defaults(client) == []
    job = analyzed(client, wait_for_status)
    assert job["options"]["template"] is None
    assert all(marks(candidate) == [] for candidate in candidates(client, job))


def test_the_default_templates_intro_and_outro_wrap_each_new_candidate(client, tmp_path, from_episode, llm, wait_for_status):
    first, source = branded(client, wait_for_status, llm)
    sting = a_video(client, tmp_path)
    shown = {"media": sting["id"], "framing": {}}
    source = patch(client, first, source, segments=[
        {"id": "sting", "start": 0.0, "end": 1.5, **shown},
        {"id": "s1", "start": source["start"], "end": source["end"]},
        {"id": "card", "start": 0.0, "end": 1.0, **shown},
    ], transitions=[{"after": "sting", "kind": "fade", "secs": 0.5}])
    template = saved(client, first, source)
    made_default(client, template)

    job = analyzed(client, wait_for_status)

    for candidate in [*job["candidates"], added(client, job, 700.0, 712.0)]:
        assert [(s["id"], s["template"]) for s in candidate["segments"]] == [
            ("sting", template["id"]), ("main", None), ("card", template["id"])
        ]
        assert [(t["after"], t["template"]) for t in candidate["transitions"]] == [("sting", template["id"])]
        assert marks(candidate) == [template["id"]] * 3
        assert candidate["revision"] == 1


# Through MCP


@pytest.mark.anyio
async def test_a_template_is_made_the_default_and_a_job_started_with_one_through_mcp(mcp):
    first = await reviewed(mcp)
    source = await manual(mcp, first, *HALO_KABAR)
    ids = {"job_id": first["id"], "candidate_id": source["id"]}
    await call(mcp, "edit_candidate", **ids, changes={"text_layers": [{"id": "name", "text": "Jeni", "start": 0.1, "secs": 0.3}]})

    template = await call(mcp, "save_preset", kind="template", preset={"name": "Brand", **ids}, use_as_default=True)
    other = await call(mcp, "save_preset", kind="template", preset={"name": "Other", **ids})
    listed = (await call(mcp, "list_presets", kind="template"))["presets"]
    assert [(preset["name"], preset["default"]) for preset in listed] == [("Brand", True), ("Other", False)]
    # A Template's id alone makes it the default.
    await call(mcp, "save_preset", kind="template", preset_id=other["id"], use_as_default=True)
    listed = (await call(mcp, "list_presets", kind="template"))["presets"]
    assert [(preset["name"], preset["default"]) for preset in listed] == [("Brand", False), ("Other", True)]

    job = await reviewed(mcp, template=template["id"])
    added = await manual(mcp, job, *HALO_KABAR)
    marked = (await call(mcp, "get_candidate", job_id=job["id"], candidate_id=added["id"]))["text_layers"]
    assert [(layer["id"], layer["template"]) for layer in marked] == [("name", template["id"])]
    plain = await reviewed(mcp, template=None)
    added = await manual(mcp, plain, *HALO_KABAR)
    assert (await call(mcp, "get_candidate", job_id=plain["id"], candidate_id=added["id"]))["text_layers"] == []
