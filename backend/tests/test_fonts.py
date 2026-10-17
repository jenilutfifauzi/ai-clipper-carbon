"""Faces: the bundled fonts and the owner's imported ones (.scratch/text-advanced/issues/06).

The fonts API, as the Media Library's and the Styles' tests use theirs, then Seam A renders with the
real ffmpeg. The font files are built by tests/fontfiles.py.
"""

from io import BytesIO

import numpy as np
import pytest
from fontTools.ttLib import TTFont

from app.fonts import BUNDLED_IDS, MissingFace, registry
from fontfiles import RESTRICTED, collection, font_file
from test_render import HEARD, add, full_frame, pixels, render, rendered, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch


def upload(client, data: bytes, name: str):
    return client.post("/api/fonts", files={"file": (name, data, "application/octet-stream")})


def imported(client, data: bytes, name: str = "font.ttf") -> dict:
    response = upload(client, data, name)
    assert response.status_code == 201, response.text
    return response.json()


def fonts(client) -> dict[str, dict]:
    return {font["id"]: font for font in client.get("/api/fonts").json()}


def described(font: dict) -> tuple:
    return font["id"], font["label"], font["typographic_family"], font["weight"], font["italic"]


def test_a_ttf_an_otf_and_a_ttc_import_into_faces_with_their_family_weight_and_italic(client):
    [ttf] = imported(client, font_file("Testa"), "Testa.ttf")["faces"]
    [otf] = imported(client, font_file("Testa", "Bold", weight=700, cff=True), "Testa-Bold.otf")["faces"]
    ttc = imported(client, collection(font_file("Testc"), font_file("Testc", "Light Italic", weight=300, italic=True)), "Testc.ttc")

    assert described(ttf) == ("testa-regular", "Testa Regular", "Testa", 400, False)
    assert described(otf) == ("testa-bold", "Testa Bold", "Testa", 700, False)
    assert [described(face) for face in ttc["faces"]] == [
        ("testc-regular", "Testc Regular", "Testc", 400, False),
        ("testc-lightitalic", "Testc Light Italic", "Testc", 300, True),
    ]
    listed = fonts(client)
    assert list(listed) == [*BUNDLED_IDS, "testa-regular", "testa-bold", "testc-regular", "testc-lightitalic"]
    assert not any(listed[face]["bundled"] for face in ("testa-regular", "testc-regular"))
    assert all(listed[face]["bundled"] for face in BUNDLED_IDS)
    # Measured as the bundled ones are, for the preview.
    assert (listed["testa-bold"]["em"], listed["testa-bold"]["units"], listed["testa-bold"]["cap_height"]) == (1000, 1000, 700)

    # Each member of the collection is a font file of its own, served to the preview.
    served = client.get(listed["testc-lightitalic"]["url"])
    assert served.status_code == 200 and "immutable" in served.headers["cache-control"]
    member = TTFont(BytesIO(served.content))
    assert member["name"].getDebugName(4) == "Testc Light Italic"
    assert client.get(listed["testa-bold"]["url"]).headers["content-type"] == "font/otf"


def test_a_variable_font_gives_a_static_face_per_named_instance(client):
    faces = imported(client, font_file("Testv", variable=True), "Testv[wght].ttf")["faces"]

    assert [described(face) for face in faces] == [
        ("testv-regular", "Testv Regular", "Testv", 400, False),
        ("testv-bold", "Testv Bold", "Testv", 700, False),
    ]
    bold = TTFont(BytesIO(client.get(faces[1]["url"]).content))
    assert "fvar" not in bold and bold["OS/2"].usWeightClass == 700
    # Its bars are the Bold instance's.
    assert bold["glyf"]["H"].coordinates[2] == (500, 700)


def test_a_restricted_font_imports_with_a_warning_and_its_licence_is_listed(client):
    restricted = imported(client, font_file("Testr", fs_type=RESTRICTED), "Testr.ttf")
    free = imported(client, font_file("Testf"), "Testf.ttf")

    [warning] = restricted["warnings"]
    assert "Testr Regular" in warning and "may not be embedded" in warning
    assert free["warnings"] == []
    listed = fonts(client)
    assert listed["testr-regular"]["restricted"] and not listed["testf-regular"]["restricted"]
    assert listed["testr-regular"]["copyright"] == "Copyright 2026 The Testr Authors"
    assert listed["testr-regular"]["licence"] == "Testr is licensed under the Test Licence"
    assert listed["testr-regular"]["licence_url"] == "https://example.com/licence"
    assert listed["anton"]["licence"] and not listed["anton"]["restricted"]


def test_a_duplicate_import_adds_nothing_and_a_file_that_isnt_a_font_is_refused(client):
    regular, italic = font_file("Testd"), font_file("Testd", "Italic", italic=True)
    [first] = imported(client, regular)["faces"]

    again = imported(client, regular, "copy.ttf")
    assert again["faces"] == [] and [face["id"] for face in again["existing"]] == [first["id"]]
    # A collection holding it adds only its other member.
    both = imported(client, collection(regular, italic), "Testd.ttc")
    assert [face["id"] for face in both["faces"]] == ["testd-italic"]
    assert [face["id"] for face in both["existing"]] == [first["id"]]
    # A bundled Face's own file adds nothing either.
    anton = client.get(fonts(client)["anton"]["url"]).content
    assert [face["id"] for face in imported(client, anton, "Anton-Regular.ttf")["existing"]] == ["anton"]
    assert list(fonts(client)) == [*BUNDLED_IDS, "testd-regular", "testd-italic"]

    for data, name in [(b"Just some notes", "notes.ttf"), (font_file("Teste")[:200], "cut.ttf"), (b"ttcf" + b"\0" * 40, "x.ttc")]:
        response = upload(client, data, name)
        assert response.status_code == 422 and "TTF, OTF or TTC" in response.json()["detail"]
    assert len(fonts(client)) == len(BUNDLED_IDS) + 2


def test_a_face_with_the_postscript_name_of_another_gets_its_own_id(client):
    [first] = imported(client, font_file("Testn"))["faces"]
    [second] = imported(client, font_file("Testn", stem=200))["faces"]
    assert (first["id"], second["id"]) == ("testn-regular", "testn-regular-2")


def test_measures_are_read_again_when_a_deleted_faces_id_is_taken_by_another(client):
    [first] = imported(client, font_file("Testm"))["faces"]
    assert fonts(client)["testm-regular"]["em"] == 1000
    assert client.delete(f"/api/fonts/{first['id']}").status_code == 204
    [second] = imported(client, font_file("Testm", em=2048))["faces"]
    assert second["id"] == "testm-regular" and second["url"] != first["url"]
    assert fonts(client)["testm-regular"]["em"] == 2048


def test_a_style_naming_an_imported_face_validates_and_an_unknown_face_is_refused(client):
    [face] = imported(client, font_file("Tests"))["faces"]

    preset = client.post("/api/presets", json={"name": "Brand", "caption": {"font": face["id"]}, "hook": {"font": face["id"]}})
    assert preset.status_code == 201, preset.text
    assert client.get("/api/presets").json()[-1]["caption"]["font"] == face["id"]
    refused = client.post("/api/presets", json={"name": "Nope", "watermark": {"font": "no-such-face"}})
    assert refused.status_code == 422 and "no-such-face" in refused.text

    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya", selected=False)
    layered = patch(client, job, candidate, text_layers=[{"id": "t1", "text": "HALO", "start": 0, "secs": 1, "style": {"font": face["id"]}}],
                    style_overrides={"caption": {"font": face["id"]}})
    assert layered["text_layers"][0]["style"]["font"] == face["id"]
    for change in ({"style_overrides": {"hook": {"font": "no-such-face"}}},
                   {"text_layers": [{"id": "t1", "text": "HALO", "start": 0, "secs": 1, "style": {"font": "no-such-face"}}]}):
        response = client.patch(candidate_url(job, candidate), json=change)
        assert response.status_code == 422 and "no-such-face" in response.text


def test_deleting_a_face_is_refused_while_a_candidate_its_revisions_or_a_style_preset_names_it(client):
    ids = [imported(client, font_file(name))["faces"][0]["id"] for name in ("Testp", "Testq", "Testu", "Testw")]
    in_layer, in_revision, in_preset, unused = ids
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya", selected=False)
    url = candidate_url(job, candidate)
    # Named by a Text Layer since removed: only a state in the Revision History has it.
    client.patch(url, json={"text_layers": [{"id": "old", "text": "LAMA", "start": 0, "secs": 1, "style": {"font": in_revision}}]},
                 headers={"X-Edit-Source": "advanced-edit"})
    client.patch(url, json={"text_layers": [{"id": "t1", "text": "HALO", "start": 0, "secs": 1, "style": {"font": in_layer}}]},
                 headers={"X-Edit-Source": "agent"})
    assert client.post("/api/presets", json={"name": "Brand", "hook": {"font": in_preset}}).status_code == 201

    preset = client.get("/api/presets").json()[-1]
    for face, where, kind, named in [
        (in_layer, "Text Layer t1", "candidate", candidate["id"]),
        (in_revision, "Revision 2", "candidate", candidate["id"]),
        (in_preset, "Style Preset Brand (hook)", "style_preset", preset["id"]),
    ]:
        response = client.delete(f"/api/fonts/{face}")
        assert response.status_code == 409, face
        detail = response.json()["detail"]
        assert where in detail["message"], detail
        [use] = detail["uses"]
        assert (use["kind"], use["id"]) == (kind, named)
    assert in_layer in fonts(client)

    assert client.delete(f"/api/fonts/{unused}").status_code == 204
    assert unused not in fonts(client)
    assert client.delete(f"/api/fonts/{unused}").status_code == 404
    assert client.delete("/api/fonts/anton").status_code == 409
    assert "anton" in fonts(client)


def caption_ink(settings, job_dir, clip: dict) -> int:
    """The white pixels of the Clip's captions, 1.2 s in, while "SERU" is spoken."""
    frame = full_frame(settings, job_dir / clip["output"]["video"], 1.2)
    return len(pixels(frame, np.array([255, 255, 255]))[0])


def test_captions_in_an_imported_face_render_in_it_and_its_bold_instance_differs(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    regular, bold = (face["id"] for face in imported(client, font_file("Testv", variable=True))["faces"])
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    job_dir = settings.data_dir / "jobs" / job["id"]

    inks = []
    for face in (regular, bold):
        candidate = patch(client, job, candidate, style_overrides={"caption": {"font": face, "outline": 0, "highlight": "none"}})
        render(client, job)
        [clip] = rendered(client, job)["clips"]
        assert clip["status"] == "done", clip["error"]
        inks.append(caption_ink(settings, job_dir, clip))
    # The bars of "PODCAST INI SERU": Bold's are four times as wide.
    assert inks[0] > 2000 and inks[1] > 3 * inks[0]


def test_a_render_whose_face_file_is_gone_fails_saying_so(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    [face] = imported(client, font_file("Testg"))["faces"]
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    patch(client, job, candidate, style_overrides={"caption": {"font": face["id"]}})

    (settings.data_dir / "fonts" / f"{face['id']}.ttf").unlink()
    render(client, job)
    [clip] = rendered(client, job)["clips"]
    assert clip["status"] == "error" and "Testg Regular" in clip["error"] and "missing" in clip["error"]


# .scratch/text-advanced/issues/07: the families `make setup` downloads, each listed as bundled, by
# their weights and whether they are italic.
BUNDLED_FAMILIES = {
    "Montserrat": {(400, False), (400, True), (600, False), (700, False), (700, True), (800, False), (800, True), (900, False), (900, True)},
    "Poppins": {(400, False), (400, True), (500, False), (600, False), (700, False), (700, True), (800, False), (900, False), (900, True)},
    "Barlow Condensed": {(400, False), (600, False), (700, False), (700, True), (800, False), (900, False), (900, True)},
    "Kanit": {(400, False), (500, False), (700, False), (800, False), (900, False), (900, True)},
    "Oswald": {(400, False), (500, False), (600, False), (700, False)},
    "Passion One": {(400, False), (700, False), (900, False)},
    "DM Serif Display": {(400, False), (400, True)},
    **{
        family: {(400, False)}
        for family in ("Anton", "Bebas Neue", "Archivo Black", "Bangers", "Abril Fatface", "Lobster", "Pacifico",
                       "Titan One", "Caveat Brush", "Staatliches", "Permanent Marker", "Luckiest Guy")
    },
}


def test_the_bundled_families_are_listed_with_their_weights_and_italics(client):
    listed = fonts(client)
    bundled = [face for face in listed.values() if face["bundled"]]
    families: dict[str, set] = {}
    for face in bundled:
        families.setdefault(face["typographic_family"], set()).add((face["weight"], face["italic"]))
    assert families == BUNDLED_FAMILIES
    # The ids styles already store are among them, unchanged.
    assert {"montserrat-extrabold", "anton", "bebas-neue", "poppins-black", "archivo-black", "bangers"} <= set(listed)
    assert (listed["montserrat-extrabold"]["typographic_family"], listed["montserrat-extrabold"]["weight"]) == ("Montserrat", 800)
    assert [face["id"] for face in bundled if face["typographic_family"] == "Passion One"] == [
        "passion-one-regular", "passion-one-bold", "passion-one-black",
    ]
    # Each says where it comes from.
    assert all(face["copyright"] for face in bundled)
    # Bundled once each: importing a bundled file adds nothing.
    kanit = client.get(listed["kanit-black-italic"]["url"]).content
    assert [face["id"] for face in imported(client, kanit, "Kanit-BlackItalic.ttf")["existing"]] == ["kanit-black-italic"]


def test_a_bundled_face_not_yet_downloaded_is_left_out_of_the_list_and_fails_a_render_saying_so(client, monkeypatch, tmp_path):
    monkeypatch.setattr("app.fonts.FONTS_DIR", tmp_path)
    assert fonts(client) == {}
    # Styles naming it still validate: `make setup` brings it back.
    preset = client.post("/api/presets", json={"name": "Kanit", "caption": {"font": "kanit-bold"}})
    assert preset.status_code == 201, preset.text
    with pytest.raises(MissingFace, match="make setup"):
        registry().file("kanit-bold")


def test_captions_in_a_bundled_bold_face_render_in_it_beside_its_regular(client, settings, video_source, transcriber, plain_video):
    video_source.video = plain_video
    transcriber.words = HEARD
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    job_dir = settings.data_dir / "jobs" / job["id"]

    inks = []
    for face in ("kanit-regular", "kanit-bold"):
        # A red Watermark in the family's Regular, so that libass is given both Faces of the family.
        watermark = {"kind": "text", "text": "KANIT", "font": "kanit-regular", "colour": "#FF0000", "outline": False}
        candidate = patch(client, job, candidate, style_overrides={
            "caption": {"font": face, "outline": 0, "highlight": "none"}, "watermark": watermark,
        })
        render(client, job)
        [clip] = rendered(client, job)["clips"]
        assert clip["status"] == "done", clip["error"]
        inks.append(caption_ink(settings, job_dir, clip))
    assert inks[0] > 2000 and inks[1] > 1.2 * inks[0]
