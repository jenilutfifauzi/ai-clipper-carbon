"""Text Presets (.scratch/text-advanced/issues/08): the built-in ones, shipped as data files, the
owner's, kept in DATA_DIR, and the one used for new titles. Through the API, as the Text tab uses
them, as the Style Presets' tests use theirs."""

import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.fonts import BUNDLED_IDS
from app.main import create_app
from app.ports import Ports
from app.text_presets import builtin_text_presets
from fontfiles import font_file
from test_fonts import imported
from test_render import add, preview, render, render_video, rendered, reviewed  # noqa: F401 (a fixture)
from test_review import candidates, patch
from test_layer_pictures import picture_of

OLD_LOOKS = {"text": "Text", "title": "Title", "label": "Label", "subtitle": "Subtitle"}
URL = "/api/text-presets"


def listed(client) -> dict[str, dict]:
    response = client.get(URL)
    assert response.status_code == 200, response.text
    return {preset["id"]: preset for preset in response.json()}


def saved(client, name: str, **style) -> dict:
    response = client.post(URL, json={"name": name, "style": style})
    assert response.status_code == 201, response.text
    return response.json()


def default_of(client) -> str:
    [default] = [preset_id for preset_id, preset in listed(client).items() if preset["default"]]
    return default


def test_the_four_old_looks_are_built_in_with_stable_ids_and_text_is_used_for_new_titles(client):
    presets = listed(client)

    assert {preset_id: presets[preset_id]["name"] for preset_id in OLD_LOOKS} == OLD_LOOKS
    assert all(presets[preset_id]["builtin"] and presets[preset_id]["sample"] for preset_id in OLD_LOOKS)
    assert default_of(client) == "text"
    # Their looks as the Text tab drew them: a Text Style laid over the defaults.
    text, title, label, subtitle = (presets[preset_id]["style"] for preset_id in OLD_LOOKS)
    assert (text["font"], text["size"], text["colour"], text["stroke_width"], text["plate"]["shape"]) == (
        "montserrat-extrabold", 80, "#FFFFFF", 4, "none",
    )
    assert (title["font"], title["size"], title["colour"], title["stroke_width"]) == ("anton", 130, "#FFE600", 6)
    assert (label["colour"], label["plate"]["shape"], label["plate"]["colour"], label["plate"]["opacity"]) == ("#000000", "block", "#FFFFFF", 1)
    assert (subtitle["size"], subtitle["plate"]["shape"], subtitle["plate"]["opacity"]) == (56, "block", 0.6)
    assert label["shadow"] == text["shadow"] and not label["shadow"]["distance"]
    # Built-ins come first, by their order.
    builtins = [preset for preset in presets.values() if preset["builtin"]]
    assert builtins == sorted(builtins, key=lambda preset: preset["order"])


def test_the_31_builtins_have_unique_ids_and_samples_on_a_handful_of_shelves_and_name_bundled_faces(client):
    builtins = [preset for preset in listed(client).values() if preset["builtin"]]

    assert len(builtins) == 31
    assert len({preset["sample"] for preset in builtins}) == 31
    assert all(preset["name"] and preset["sample"] and preset["category"] for preset in builtins)
    assert 5 <= len({preset["category"] for preset in builtins}) <= 8
    assert {preset["style"]["font"] for preset in builtins} <= set(BUNDLED_IDS)
    # Each is a Text Style the owner could save as it is.
    for preset in builtins:
        assert saved(client, preset["name"], **preset["style"])["style"] == preset["style"], preset["id"]


def test_every_builtin_renders_in_a_short_clip_its_sample_in_its_colour(client, video_source, render_video):
    video_source.video = render_video
    builtins = [preset for preset in listed(client).values() if preset["builtin"]]
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya")
    layers = [
        {"id": preset["id"], "text": preset["sample"], "start": 0, "secs": 1, "style": preset["style"]}
        for preset in builtins
    ]
    candidate = patch(client, job, candidate, text_layers=layers)

    texts = preview(client, job, candidate)["plan"]["texts"]
    assert len(texts) == len(builtins)
    for preset, event in zip(builtins, texts):
        # Every character of its sample is set, none left out for want of a glyph.
        assert " ".join(event["lines"]) == preset["sample"], preset["id"]
        picture = picture_of(client, job, event)
        colour = np.array([int(preset["style"]["colour"][i : i + 2], 16) for i in (1, 3, 5)])
        inked = (picture[..., 3] == 255) & (np.abs(picture[..., :3] - colour).max(axis=-1) < 40)
        assert inked.sum() > 200, preset["id"]
    render(client, job)
    [clip] = rendered(client, job, timeout=120)["clips"]
    assert clip["status"] == "done", clip["error"]


def test_builtin_presets_cant_be_changed_renamed_or_deleted(client):
    before = listed(client)["title"]

    for change in ({"name": "Mine"}, {"style": {"size": 90}}):
        response = client.patch(f"{URL}/title", json=change)
        assert response.status_code == 409 and "built in" in response.json()["detail"]
    response = client.delete(f"{URL}/title")
    assert response.status_code == 409 and "built in" in response.json()["detail"]
    assert listed(client)["title"] == before


def test_an_owners_preset_is_saved_renamed_changed_and_deleted_and_survives_a_restart(settings, video_source, transcriber, llm, client):
    made = saved(client, "Brand title", font="anton", size=120, colour="#ff0000", plate={"shape": "strips"})

    assert (made["name"], made["builtin"], made["default"]) == ("Brand title", False, False)
    assert made["id"] not in OLD_LOOKS
    assert (made["style"]["colour"], made["style"]["plate"]["shape"], made["style"]["plate"]["opacity"]) == ("#FF0000", "strips", 0.7)
    # Listed after the built-in ones.
    assert list(listed(client))[-1] == made["id"]

    renamed = client.patch(f"{URL}/{made['id']}", json={"name": "Brand"})
    assert renamed.status_code == 200 and renamed.json() == made | {"name": "Brand", "sample": "Brand"}
    changed = client.patch(f"{URL}/{made['id']}", json={"style": {"size": 100}})
    assert changed.status_code == 200
    assert changed.json()["name"] == "Brand" and changed.json()["style"]["size"] == 100 and changed.json()["style"]["font"] == "montserrat-extrabold"

    # Another app on the same data directory reads them as they were left.
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        assert listed(restarted)[made["id"]] == changed.json()

    assert client.delete(f"{URL}/{made['id']}").status_code == 204
    assert made["id"] not in listed(client)
    assert client.delete(f"{URL}/{made['id']}").status_code == 404
    assert client.patch(f"{URL}/{made['id']}", json={"name": "x"}).status_code == 404


def test_a_preset_takes_no_id_and_a_bad_style_or_name_is_refused(client):
    for body in (
        {"id": "text", "name": "Text", "style": {}},
        {"name": "", "style": {}},
        {"name": "Big", "style": {"size": 1000}},
        {"name": "Odd", "style": {"font": "no-such-face"}},
        {"name": "No style"},
    ):
        assert client.post(URL, json=body).status_code == 422, body
    assert client.patch(f"{URL}/text", json={"style": {"colour": "red"}}).status_code == 422


def test_deleting_the_preset_used_for_new_titles_makes_builtin_text_used_again(client):
    mine = saved(client, "Mine", size=100)

    response = client.put(f"{URL}/default", json={"id": mine["id"]})
    assert response.status_code == 200 and response.json()["default"]
    assert default_of(client) == mine["id"]
    assert client.delete(f"{URL}/{mine['id']}").status_code == 204
    assert default_of(client) == "text"

    # A built-in one can be used for new titles too; an unknown one can't.
    assert client.put(f"{URL}/default", json={"id": "label"}).status_code == 200
    assert default_of(client) == "label"
    assert client.put(f"{URL}/default", json={"id": "nope"}).status_code == 404
    assert default_of(client) == "label"


def test_a_text_layer_keeps_its_look_when_its_preset_changes_or_is_deleted(client, video_source, render_video):
    video_source.video = render_video
    preset = saved(client, "Mine", colour="#00FF00", size=100)
    job = reviewed(client)
    candidate = add(client, job, "Podcast", "ya", selected=False)
    layer = {"id": "t1", "text": "HALO", "start": 0, "secs": 1, "style": preset["style"]}
    made = patch(client, job, candidate, text_layers=[layer])["text_layers"][0]

    def kept() -> dict:
        [layer] = next(c for c in candidates(client, job) if c["id"] == candidate["id"])["text_layers"]
        return layer

    assert client.patch(f"{URL}/{preset['id']}", json={"style": {"colour": "#0000FF", "size": 60}}).status_code == 200
    assert kept() == made and made["style"] == preset["style"]
    assert client.delete(f"{URL}/{preset['id']}").status_code == 204
    assert kept() == made


def test_a_face_named_by_an_owners_text_preset_cant_be_deleted(client):
    face = imported(client, font_file("Testp"))["faces"][0]["id"]
    preset = saved(client, "Brand", font=face)

    response = client.delete(f"/api/fonts/{face}")
    assert response.status_code == 409
    detail = response.json()["detail"]
    assert "Text Preset Brand" in detail["message"]
    [use] = detail["uses"]
    assert (use["kind"], use["id"], use["title"]) == ("text_preset", preset["id"], "Brand")

    client.delete(f"{URL}/{preset['id']}")
    assert client.delete(f"/api/fonts/{face}").status_code == 204


def test_a_builtin_preset_is_added_by_adding_its_data_file(tmp_path):
    def write(name: str, preset: dict) -> None:
        (tmp_path / f"{name}.json").write_text(json.dumps(preset))

    write("text", {"id": "text", "name": "Text", "category": "Basic", "order": 10, "sample": "Text", "style": {}})
    write("news", {
        "id": "news", "name": "News", "category": "Labels", "order": 5, "sample": "BREAKING",
        "style": {"size": 60, "shadow": {"distance": 4}, "plate": {"shape": "block"}},
    })

    news, text = builtin_text_presets(tmp_path)
    assert (news.id, text.id) == ("news", "text")
    assert (news.name, news.category, news.sample, news.builtin) == ("News", "Labels", "BREAKING", True)
    # The style's fields given, the shadow's and the plate's too, laid over the defaults.
    assert (news.style.size, news.style.colour, news.style.shadow.distance, news.style.shadow.opacity) == (60, "#FFFFFF", 4, 0.6)
    assert (news.style.plate.shape, news.style.plate.opacity) == ("block", 0.7)

    write("again", {"id": "news", "name": "Again", "category": "Labels", "order": 1, "sample": "x", "style": {}})
    with pytest.raises(ValueError, match="news"):
        builtin_text_presets(tmp_path)
