"""Built-in Looks (.scratch/color-adjust/issues/05-built-in-looks-and-filters-tab.md, docs/adr/0013).

The catalogue, then the API and Seam A through it and the real ffmpeg (a frame saved of a draft), on
a picture of known colours, and MCP. The fold of a Grade with a Look is pinned in test_grade_fold.py.
"""

import json
from dataclasses import asdict, fields

import numpy as np
import pytest

from app.candidates import EXPOSURE_EV, TEMPERATURE_K, Adjust, Grade
from app.grading import fold, grade_filters, with_look
from app.looks import LookNotFound, all_looks, builtin_looks, get_look
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import colour_video, frame_at, graded, grey_patch, red_patch  # noqa: F401
from test_segments import ranges

CATEGORIES = ["Cinematic", "Film", "Retro", "Portrait", "Black & White", "Vibe"]


# The catalogue


def test_the_built_in_looks_load_with_unique_ids_and_every_dial_in_range():
    looks = all_looks()
    assert 18 <= len(looks) <= 30
    assert len({look.id for look in looks}) == len(looks)
    # By category in the Filters tab's order, each category's Looks together.
    shelves = list(dict.fromkeys(look.category for look in looks))
    assert shelves == CATEGORIES
    for look in looks:
        for dial, value in asdict(look.adjust).items():
            low, high = {"temperature": TEMPERATURE_K, "exposure": EXPOSURE_EV}.get(dial, (0, 100) if dial in ("sharpen", "fade", "vignette") else (-100, 100))
            assert low <= value <= high, (look.id, dial, value)
        # Every Look does something.
        assert look.adjust != Adjust(), look.id
    assert get_look("bw-classic").category == "Black & White"
    with pytest.raises(LookNotFound):
        get_look("no-such-look")


@pytest.mark.parametrize(
    ("given", "error"),
    [
        ({"adjust": {"contrast": 150}}, "contrast"),
        ({"adjust": {"glow": 10}}, "glow"),
        ({"mood": "dark"}, "mood"),
    ],
)
def test_a_built_in_look_file_that_isnt_valid_is_refused_naming_it(tmp_path, given, error):
    (tmp_path / "bad.json").write_text(json.dumps({"id": "bad", "name": "Bad", "category": "Vibe", "order": 1} | given))
    with pytest.raises(ValueError, match=f"(?s)bad.json.*{error}"):
        builtin_looks(tmp_path)


def test_two_built_in_looks_with_one_id_are_refused(tmp_path):
    for name in ("a", "b"):
        (tmp_path / f"{name}.json").write_text(json.dumps({"id": "same", "name": name, "category": "Vibe", "order": 1}))
    with pytest.raises(ValueError, match="same"):
        builtin_looks(tmp_path)


def test_a_looks_dials_move_the_grades_own_held_in_range():
    laid = with_look(Adjust(temperature=10000, saturation=-60, exposure=2.5), Adjust(temperature=9000, saturation=-100, exposure=1, contrast=20))
    assert (laid.temperature, laid.saturation, laid.exposure, laid.contrast) == (11000, -100, 3, 20)


def test_the_fold_reads_a_looks_values_from_the_catalogue():
    grey = get_look("bw-classic")
    assert fold(Grade(look="bw-classic")) == fold(Grade(grey.adjust))
    # At intensity 0, as without the Look: a neutral Grade adds no filter.
    assert fold(Grade(look="bw-classic", intensity=0)) is None and grade_filters(Grade(look="bw-classic", intensity=0)) == ""


# The API


def test_a_look_is_listed_saved_and_planned_and_an_unknown_one_refused(client):
    listed = client.get("/api/looks").json()
    assert [look["id"] for look in listed] == [look.id for look in all_looks()]
    assert set(listed[0]) == {"id", "name", "category", "order", "adjust"}
    assert {f.name for f in fields(Adjust)} == set(listed[0]["adjust"])

    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    first, second = ranges(job, ("halo", "kabar"), ("kita", "soal"))
    looked = {"adjust": {"exposure": 0.2}, "look": "film-faded", "intensity": 60}
    saved = patch(client, job, candidate, grade=looked, segments=[first | {"grade": {"look": "bw-noir"}}, second])
    assert (saved["grade"]["look"], saved["grade"]["intensity"]) == ("film-faded", 60)
    planned = preview(client, job, saved)["plan"]
    assert planned["grade"]["look"] == "film-faded" and planned["segments"][0]["grade"]["look"] == "bw-noir"

    url = candidate_url(job, saved)
    for change in ({"grade": {"look": "nope"}}, {"segments": [first | {"grade": {"look": "nope"}}]}):
        refused = client.patch(url, json=change)
        assert refused.status_code == 422 and "no Look nope" in refused.text, refused.text
        drafted = client.post(f"{url}/preview-plan", json=change)
        assert drafted.status_code == 422 and "no Look nope" in drafted.text, drafted.text


# Seam A: the real ffmpeg


def test_a_look_at_intensity_0_renders_as_without_it_and_at_100_differs(client, settings, video_source, colour_video):
    video_source.video = colour_video
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), None)
    dialled = {"adjust": {"temperature": 8000}}
    plain = red_patch(frame_at(client, settings, job, candidate, 0.5, grade=dialled))
    at_zero = red_patch(frame_at(client, settings, job, candidate, 0.5, grade=dialled | {"look": "bw-classic", "intensity": 0}))
    assert np.abs(at_zero - plain).max() < 2, (plain, at_zero)
    # At 100, Classic greys it: the red patch has no colour left.
    full = red_patch(frame_at(client, settings, job, candidate, 0.5, grade=dialled | {"look": "bw-classic", "intensity": 100}))
    assert np.ptp(full) < 8 and np.ptp(plain) > 60, (plain, full)
    # Half way, half the colour.
    half = red_patch(frame_at(client, settings, job, candidate, 0.5, grade=dialled | {"look": "bw-classic", "intensity": 50}))
    assert np.ptp(full) + 20 < np.ptp(half) < np.ptp(plain) - 20, (plain, half, full)
    assert abs(grey_patch(frame_at(client, settings, job, candidate, 0.5, grade={"look": "bw-classic"})) - 128).max() < 14


# MCP


@pytest.mark.anyio
async def test_list_assets_lists_the_looks_and_a_grade_takes_one_by_id(mcp):
    listed = await call(mcp, "list_assets", kind="looks")
    assert set(listed) == {"looks"}
    assert [look["id"] for look in listed["looks"]] == [look.id for look in all_looks()]
    assert {"id", "name", "category", "adjust"} <= set(listed["looks"][0])

    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    assert "no Look nope" in await fails(mcp, "edit_candidate", **ids, changes={"grade": {"look": "nope"}})
    merged = await call(mcp, "merge_candidate_items", **ids, grade={"look": "vibe-vivid", "intensity": 40})
    assert (merged["grade"]["look"], merged["grade"]["intensity"]) == ("vibe-vivid", 40)
    # The dry run gives the look and its intensity.
    plan = await call(mcp, "edit_candidate", **ids, changes={"hook_text": "Coba"}, dry_run=True)
    assert plan["grade"] == {"look": "vibe-vivid", "intensity": 40}
