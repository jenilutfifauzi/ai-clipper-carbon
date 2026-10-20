"""Imported Looks from .cube files (.scratch/color-adjust/issues/06-imported-looks.md, docs/adr/0013).

Reading a .cube file and fitting the preview's tables and matrix to it, then the store, the API and
Seam A through it and the real ffmpeg (a frame saved of a draft), on a picture of known colours, and
MCP. The fold of a Grade with an Imported Look is pinned in test_grade_fold.py.
"""

from pathlib import Path

import numpy as np
import pytest

from app.candidates import Adjust, Grade
from app.grading import fold, grade_filters
from app.looks import IMPORTED, BadCube, ImportedLooks, LookNotFound, fit_table, parse_cube
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segment_grades import colour_video, frame_at, graded, grey_patch, red_patch  # noqa: F401

FIXTURES = Path(__file__).parent / "fixtures"


def cube(name: str) -> bytes:
    return (FIXTURES / f"{name}.cube").read_bytes()


def rows(size: int, colour) -> str:
    """The rows of a table `size` a side whose output for (r, g, b) is `colour(r, g, b)`, red fastest."""
    step = 1 / (size - 1)
    return "".join(" ".join(f"{v:g}" for v in colour(r * step, g * step, b * step)) + "\n" for b in range(size) for g in range(size) for r in range(size))


# Reading a .cube file


def test_a_3d_table_reads_with_its_title_red_changing_fastest():
    title, table = parse_cube(cube("channel_swap").decode())
    assert title == "Swap red and blue" and table.shape == (2, 2, 2, 3)
    # [b][g][r]: pure red in gives pure blue out.
    assert list(table[0, 0, 1]) == [0, 0, 1] and list(table[1, 0, 0]) == [1, 0, 0]


@pytest.mark.parametrize(
    ("name", "line", "problem"),
    [("one_d", 2, "1D table"), ("size_66", 2, "66 a side"), ("malformed", 5, "three numbers")],
)
def test_a_1d_table_a_size_over_65_and_a_malformed_line_are_refused_naming_the_line(name, line, problem):
    with pytest.raises(BadCube, match=f"Line {line}: .*{problem}"):
        parse_cube(cube(name).decode())


@pytest.mark.parametrize(
    ("text", "line", "problem"),
    [
        ("LUT_3D_SIZE 2\n0 0 0\n", 2, "ends after 1 rows"),
        ("0 0 0\nLUT_3D_SIZE 2\n", 1, "before LUT_3D_SIZE"),
        ("LUT_3D_SIZE 1\n", 1, "1 a side"),
        ("LUT_3D_SIZE two\n", 1, "whole number"),
        ("TITLE \"x\"\n", 1, "no LUT_3D_SIZE"),
        ("LUT_3D_SIZE 2\nDOMAIN_MIN 0 0\n", 2, "three numbers"),
        ("LUT_3D_SIZE 2\n" + rows(2, lambda r, g, b: (r, g, b)) + "1 1 1\n", 10, "more rows"),
    ],
)
def test_other_malformed_files_are_refused_naming_the_line(text, line, problem):
    with pytest.raises(BadCube, match=f"Line {line}: .*{problem}"):
        parse_cube(text)


def test_a_domain_and_resolves_input_range_are_rescaled_to_0_1():
    # An identity over 0..2 (its outputs too) is the identity over 0..1.
    for header in ("LUT_3D_INPUT_RANGE 0.0 2.0\nLUT_IN_VIDEO_RANGE\n", "DOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n"):
        _, table = parse_cube(f"# Created by: DaVinci Resolve\nLUT_3D_SIZE 3\n{header}" + rows(3, lambda r, g, b: (2 * r, 2 * g, 2 * b)))
        assert np.allclose(table, parse_cube("LUT_3D_SIZE 3\n" + rows(3, lambda r, g, b: (r, g, b)))[1], atol=1e-9)
    # Over 0..0.5 a table reaches its last row at half way: what is above is held there.
    _, half = parse_cube("LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 0.5 0.5 0.5\n" + rows(2, lambda r, g, b: (r / 2, g / 2, b / 2)))
    assert list(half[1, 1, 1]) == [0.5, 0.5, 0.5]


def test_the_fitted_approximation_of_an_identity_table_is_the_identity():
    fitted = fit_table(parse_cube(cube("identity").decode())[1])
    for table in fitted.tables:
        assert len(table) == 256 and list(table) == pytest.approx([i / 255 for i in range(256)], abs=1e-6)
    assert [v for row in fitted.matrix for v in row] == pytest.approx([1, 0, 0, 0, 1, 0, 0, 0, 1], abs=1e-6)


def test_the_fit_of_a_swap_or_a_curve_is_near_the_table():
    swap = fit_table(parse_cube(cube("channel_swap").decode())[1])
    assert [v for row in swap.matrix for v in row] == pytest.approx([0, 0, 1, 0, 1, 0, 1, 0, 0], abs=1e-6)
    # A curve on red alone: the fit draws it within a level or two.
    _, curved = parse_cube("LUT_3D_SIZE 9\n" + rows(9, lambda r, g, b: (r**0.7, g, b)))
    fitted = fit_table(curved)
    drawn = np.array(fitted.matrix) @ [fitted.tables[0][128], fitted.tables[1][64], fitted.tables[2][200]]
    assert drawn == pytest.approx([(128 / 255) ** 0.7, 64 / 255, 200 / 255], abs=0.01)


# The store


def test_an_import_is_a_new_look_named_from_its_title_or_file_and_a_clash_gets_2(tmp_path):
    store = ImportedLooks(tmp_path / "looks")
    first = store.add(cube("identity"), "whatever.cube")
    assert (first.name, first.category, first.has_table) == ("Identity", IMPORTED, True)
    again = store.add(cube("identity"), "whatever.cube")
    assert again.name == "Identity (2)" and again.id != first.id
    untitled = store.add(cube("identity").replace(b'TITLE "Identity"\n', b""), "Teal Orange.cube")
    assert untitled.name == "Teal Orange"
    assert [look.id for look in store.all()] == [first.id, again.id, untitled.id]
    # Each Look's table is kept, read back as the file's.
    assert np.allclose(parse_cube(store.table(first.id).read_text())[1], parse_cube(cube("identity").decode())[1], atol=1e-6)
    with pytest.raises(BadCube, match="Line 2"):
        store.add(cube("one_d"), "flat.cube")
    assert len(store.all()) == 3


def test_an_intensity_mixes_the_table_over_the_identity(tmp_path):
    store = ImportedLooks(tmp_path / "looks")
    swap = store.add(cube("channel_swap"), "swap.cube")
    assert store.table(swap.id, 100) == store.table(swap.id)
    _, half = parse_cube(store.table(swap.id, 50).read_text())
    assert list(half[0, 0, 1]) == pytest.approx([0.5, 0, 0.5])
    store.delete(swap.id)
    assert list((tmp_path / "looks").glob("*.cube")) == []
    with pytest.raises(LookNotFound):
        store.get(swap.id)


# The API


def imported(client, name: str = "channel_swap") -> dict:
    response = client.post("/api/looks", files={"file": (f"{name}.cube", cube(name))})
    assert response.status_code == 201, response.text
    return response.json()


def test_an_imported_look_is_listed_used_in_a_grade_and_folded(client):
    look = imported(client)
    assert (look["name"], look["category"], look["has_table"]) == ("Swap red and blue", "Imported", True)
    assert len(look["fit"]["tables"]) == 3 and len(look["fit"]["matrix"]) == 3
    listed = client.get("/api/looks").json()
    assert listed[-1] == look and not any(entry["has_table"] for entry in listed[:-1])
    assert all(entry["fit"] is None for entry in listed[:-1])
    folded = fold(Grade(look=look["id"], intensity=40))
    assert folded is not None and folded.tables is None and folded.matrix is None
    assert folded.lut is not None and folded.lut.intensity == 40
    # Drawn after the tables and matrix, before sharpen and vignette.
    filters = grade_filters(Grade(Adjust(exposure=0.5, sharpen=30, vignette=20), look=look["id"]))
    order = [filters.index(name) for name in ("curves", "lut3d", "unsharp", "vignette")]
    assert order == sorted(order), filters
    # An Overlay's picture keeps its alpha: the table is drawn on RGBA.
    assert "format=rgba,lut3d" in grade_filters(Grade(look=look["id"]), alpha="g")

    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    saved = patch(client, job, candidate, grade={"look": look["id"], "intensity": 70})
    assert preview(client, job, saved)["plan"]["grade"]["look"] == look["id"]


@pytest.mark.parametrize(("name", "line"), [("one_d", 2), ("size_66", 2), ("malformed", 5)])
def test_an_import_that_isnt_a_3d_table_is_refused_naming_the_line(client, name, line):
    response = client.post("/api/looks", files={"file": (f"{name}.cube", cube(name))})
    assert response.status_code == 422 and f"Line {line}" in response.json()["detail"], response.text
    assert not any(look["has_table"] for look in client.get("/api/looks").json())


def test_a_look_in_use_cant_be_deleted_and_an_unused_one_is(client):
    look = imported(client)
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    saved = patch(client, job, candidate, grade={"look": look["id"]})
    refused = client.delete(f"/api/looks/{look['id']}")
    assert refused.status_code == 409, refused.text
    detail = refused.json()["detail"]
    assert (saved["title"] or f"Clip {saved['id']}") in detail["message"] and detail["uses"][0]["candidate_id"] == saved["id"]
    patch(client, job, saved, grade={"look": None})
    assert client.delete(f"/api/looks/{look['id']}").status_code == 204
    assert client.delete(f"/api/looks/{look['id']}").status_code == 404
    assert client.delete("/api/looks/bw-classic").status_code == 409
    # A Look deleted is no Look a Grade can name.
    refused = client.patch(candidate_url(job, saved), json={"grade": {"look": look["id"]}})
    assert refused.status_code == 422 and "no Look" in refused.text


def test_a_segments_grade_holds_a_look_too(client):
    look = imported(client)
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), {"look": look["id"]})
    refused = client.delete(f"/api/looks/{look['id']}")
    assert refused.status_code == 409, refused.text
    assert refused.json()["detail"]["uses"][0]["candidate_id"] == candidate["id"]


# Seam A: the real ffmpeg


def test_an_identity_cube_leaves_pixels_and_a_swap_swaps_red_and_blue(client, settings, video_source, colour_video):
    video_source.video = colour_video
    identity, swap = imported(client, "identity"), imported(client, "channel_swap")
    job = reviewed(client)
    candidate = graded(client, job, add(client, job, "halo", "ya"), None)
    plain = frame_at(client, settings, job, candidate, 0.5)
    same = frame_at(client, settings, job, candidate, 0.5, grade={"look": identity["id"]})
    # Within rounding: any Grade's round trip through RGB moves a level or three, as a dial nudged does.
    assert np.abs(red_patch(same) - red_patch(plain)).max() < 4.5 and np.abs(grey_patch(same) - grey_patch(plain)).max() < 4.5
    swapped = red_patch(frame_at(client, settings, job, candidate, 0.5, grade={"look": swap["id"]}))
    red = red_patch(plain)
    assert red[0] > 150 and red[2] < 70, red
    assert abs(swapped[2] - red[0]) < 10 and abs(swapped[0] - red[2]) < 10 and abs(swapped[1] - red[1]) < 10, (red, swapped)
    # At intensity 0 it changes nothing; half way, half.
    none = red_patch(frame_at(client, settings, job, candidate, 0.5, grade={"look": swap["id"], "intensity": 0}))
    assert np.abs(none - red).max() < 2, (red, none)
    half = red_patch(frame_at(client, settings, job, candidate, 0.5, grade={"look": swap["id"], "intensity": 50}))
    assert abs(half[0] - (red[0] + red[2]) / 2) < 10 and abs(half[2] - (red[0] + red[2]) / 2) < 10, (red, half)


# MCP


@pytest.mark.anyio
async def test_add_list_and_delete_an_imported_look_through_mcp(mcp):
    path = FIXTURES / "channel_swap.cube"
    added = await call(mcp, "add_asset", kind="look", path=str(path))
    assert (added["name"], added["category"], added["has_table"]) == ("Swap red and blue", "Imported", True)
    assert "fit" not in added
    listed = (await call(mcp, "list_assets", kind="looks"))["looks"]
    assert listed[-1]["id"] == added["id"] and all("fit" not in look for look in listed)
    assert "Line 2" in await fails(mcp, "add_asset", kind="look", path=str(FIXTURES / "one_d.cube"))

    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    await call(mcp, "merge_candidate_items", **ids, grade={"look": added["id"]})
    assert "used by" in await fails(mcp, "delete_asset", kind="look", asset_id=added["id"])
    await call(mcp, "merge_candidate_items", **ids, grade={"look": None})
    assert await call(mcp, "delete_asset", kind="look", asset_id=added["id"]) == {"deleted": added["id"]}
    assert all(look["id"] != added["id"] for look in (await call(mcp, "list_assets", kind="looks"))["looks"])
