"""Starred effects (ADR 0014): one global list of catalogue ids, for every Job, kept in DATA_DIR."""

import json

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.ports import Ports


def test_stars_are_empty_until_set_and_survive_a_restart(client, settings, video_source, transcriber, llm):
    assert client.get("/api/starred-effects").json() == []

    # Audio and Video Effects share the list. An id the catalogue doesn't have is kept as it is.
    stars = ["glow", "denoise", "gone-effect"]
    response = client.put("/api/starred-effects", json=stars)
    assert response.status_code == 200, response.text
    assert response.json() == stars
    assert client.get("/api/starred-effects").json() == stars

    # A PUT replaces the whole list.
    assert client.put("/api/starred-effects", json=["pixelate", "glow"]).json() == ["pixelate", "glow"]

    assert json.loads((settings.data_dir / "starred_effects.json").read_text()) == ["pixelate", "glow"]
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm))) as restarted:
        assert restarted.get("/api/starred-effects").json() == ["pixelate", "glow"]


@pytest.mark.parametrize(
    "body",
    [
        {"ids": ["glow"]},
        "glow",
        [5],
        [""],
        ["Glow"],
        ["glow blur"],
        ["../glow"],
        ["glow", "glow"],
        ["x" * 65],
        [f"effect-{number}" for number in range(201)],
    ],
)
def test_a_malformed_id_list_is_refused(client, body):
    client.put("/api/starred-effects", json=["glow"])
    assert client.put("/api/starred-effects", json=body).status_code == 422
    assert client.get("/api/starred-effects").json() == ["glow"]
