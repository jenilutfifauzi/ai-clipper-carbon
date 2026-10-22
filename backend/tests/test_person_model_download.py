"""The person model downloaded and removed (.scratch/background-removal/issues/01-person-model-download-and-remove.md,
docs/adr/0015, following 0019's Kokoro), against a local HTTP server that honours Range, in place of RVM's
release: fetched into a `.part`, resumed, checked against its digest and renamed into place; cancelled and
removed through the HTTP API and MCP."""

import hashlib
import json
import os
import time
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from mcp import Client

from app.main import create_app
from app.model_download import ModelSource
from app.person_model import (
    PERSON_MODEL_BYTES,
    PERSON_MODEL_FILE,
    PERSON_MODEL_SHA256,
    PERSON_MODEL_URL,
    PersonModel,
    PersonModelBusy,
    fixed_copy,
)
from app.ports import Ports, real_ports
from model_server import Served, serve

# The model's file, random bytes of a few chunks.
GOOD = os.urandom(400_000)
NAMED = {"name": "Person model", "licence": "GPL-3.0"}


@pytest.fixture
def served() -> Iterator[tuple[Served, str]]:
    """A local server for the model, honouring Range; its state and its URL."""
    with serve(GOOD, "/rvm.onnx") as served:
        yield served


def source(url: str, body: bytes = GOOD) -> ModelSource:
    return ModelSource(url, hashlib.sha256(body).hexdigest(), len(body))


def settle(model: PersonModel) -> dict:
    """The model's state once its download has ended."""
    assert model.wait(10)
    return model.state()


def paused(model: PersonModel, at: int) -> None:
    """Wait until the download has fetched `at` bytes (the server pausing there)."""
    deadline = time.monotonic() + 5
    while model.state()["done"] < at and time.monotonic() < deadline:
        time.sleep(0.01)


def test_the_pinned_source_is_rvms_mobilenetv3_from_its_upstream_release():
    assert PERSON_MODEL_URL == "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx"
    assert PERSON_MODEL_FILE == "rvm_mobilenetv3_fp32.onnx"
    assert PERSON_MODEL_SHA256 == "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828"
    assert PERSON_MODEL_BYTES == 14_975_696
    model = PersonModel(Path("/nowhere"))
    assert model.source == ModelSource(PERSON_MODEL_URL, PERSON_MODEL_SHA256, PERSON_MODEL_BYTES)
    assert model.state() == {"state": "absent", "done": 0, "total": PERSON_MODEL_BYTES, "message": None} | NAMED


def test_a_good_file_is_fetched_checked_renamed_into_place_and_reported_ready(served, tmp_path):
    state, url = served
    models = tmp_path / "models"
    model = PersonModel(models, source(url))
    model.download()
    assert settle(model) == {"state": "ready", "done": len(GOOD), "total": len(GOOD), "message": None} | NAMED
    assert model.installed and model.path.read_bytes() == GOOD
    # The `.part` is gone: only the model is left.
    assert [path.name for path in models.iterdir()] == [PERSON_MODEL_FILE]
    # Asked again, nothing is fetched.
    model.download()
    assert settle(model)["state"] == "ready" and state.ranges == [None]
    # A model found on disk is ready from the start.
    assert PersonModel(models, source(url)).state()["state"] == "ready"


def test_a_wrong_digest_installs_nothing_and_a_retry_downloads_again(served, tmp_path):
    state, url = served
    models = tmp_path / "models"
    model = PersonModel(models, source(url))
    state.body = os.urandom(len(GOOD))
    model.download()
    failed = settle(model)
    assert failed["state"] == "failed" and "checksum" in failed["message"] and failed["name"] == "Person model"
    assert not model.installed and list(models.iterdir()) == []
    state.body = GOOD
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None, None]


def test_an_interrupted_download_resumes_with_a_range_request_from_the_part_size(served, tmp_path):
    state, url = served
    model = PersonModel(tmp_path / "models", source(url))
    state.cut_at = 100_000
    model.download()
    stopped = settle(model)
    assert stopped["state"] == "failed" and "Download it again" in stopped["message"]
    kept = model.part.stat().st_size
    assert 0 < kept <= 100_000 and not model.installed
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None, f"bytes={kept}-"]
    assert model.path.read_bytes() == GOOD


def test_cancel_keeps_the_part_reports_absent_and_the_next_download_resumes_from_it(served, tmp_path):
    state, url = served
    model = PersonModel(tmp_path / "models", source(url))
    state.pause_at = 70_000
    model.download()
    paused(model, 70_000)
    assert model.state() == {"state": "downloading", "done": 70_000, "total": len(GOOD), "message": None} | NAMED
    model.cancel()
    assert model.state()["state"] == "absent"
    # A second download would write the same `.part` while the cancelled one stops.
    with pytest.raises(PersonModelBusy, match="still stopping"):
        model.download()
    state.go.set()
    assert settle(model)["state"] == "absent"
    kept = model.part.stat().st_size
    assert 70_000 <= kept < len(GOOD)
    state.pause_at = None
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None, f"bytes={kept}-"]


def test_remove_deletes_the_model_and_the_part_and_is_refused_while_downloading(served, tmp_path):
    state, url = served
    model = PersonModel(tmp_path / "models", source(url))
    state.pause_at = 10_000
    model.download()
    with pytest.raises(PersonModelBusy, match="cancel the download first"):
        model.remove()
    state.go.set()
    assert settle(model)["state"] == "ready"
    model.remove()
    assert model.state()["state"] == "absent"
    assert not model.path.exists() and not model.part.exists()


def test_remove_deletes_the_fixed_shape_copies_beside_the_model_and_nothing_else(served, tmp_path):
    state, url = served
    model = PersonModel(tmp_path / "models", source(url))
    model.download()
    assert settle(model)["state"] == "ready"
    copies = [fixed_copy(model.path, (1280, 720)), fixed_copy(model.path, (640, 360))]
    for copy in copies:
        copy.write_bytes(b"onnx")
    # One a rewrite left half made (the app stopped meanwhile).
    (left := copies[0].with_name(f"{copies[0].stem}.x1y2")).mkdir()
    (left / "fixed.onnx").write_bytes(b"onnx")
    kept = [tmp_path / "models" / "kokoro-multi-lang-v1_0", tmp_path / "models" / "other.onnx"]
    kept[0].mkdir()
    kept[1].write_bytes(b"onnx")
    assert copies[0].parent == model.path.parent and copies[0] != copies[1]
    model.remove()
    assert not any(path.exists() for path in [model.path, *copies, left])
    assert all(path.exists() for path in kept)


# Through the HTTP API and MCP.


@pytest.fixture
def app_with_model(settings, video_source, transcriber, llm, served):
    _, url = served
    model = PersonModel(settings.data_dir / "models", source(url))
    with TestClient(create_app(settings, Ports(video_source, transcriber, llm, person_model=model))) as client:
        try:
            yield client, model
        finally:
            video_source.release()
            transcriber.release()
            transcriber.stop()


def test_the_api_reads_downloads_cancels_and_removes_the_person_model(app_with_model, served):
    client, model = app_with_model
    state, _ = served
    assert client.get("/api/models/person").json() == {"state": "absent", "done": 0, "total": len(GOOD), "message": None} | NAMED

    state.pause_at = 20_000
    started = client.post("/api/models/person/download")
    assert started.status_code == 202 and started.json()["state"] == "downloading"
    deadline = time.monotonic() + 5
    while client.get("/api/models/person").json()["done"] < 20_000 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert client.get("/api/models/person").json() == {"state": "downloading", "done": 20_000, "total": len(GOOD), "message": None} | NAMED
    refused = client.delete("/api/models/person")
    assert refused.status_code == 409 and "cancel the download first" in refused.json()["detail"]
    assert client.delete("/api/models/person/download").status_code == 204
    assert client.get("/api/models/person").json()["state"] == "absent"
    refused = client.post("/api/models/person/download")
    assert refused.status_code == 409 and "still stopping" in refused.json()["detail"]
    state.go.set()
    model.wait(10)

    state.pause_at = None
    assert client.post("/api/models/person/download").status_code == 202
    model.wait(10)
    assert client.get("/api/models/person").json()["state"] == "ready"
    assert state.ranges[-1] is not None and state.ranges[-1].startswith("bytes=")

    assert client.delete("/api/models/person").status_code == 204
    assert client.get("/api/models/person").json()["state"] == "absent"
    assert not model.installed


def test_without_the_person_model_offered_its_routes_are_404(client):
    assert client.get("/api/models/person").status_code == 404
    assert client.post("/api/models/person/download").status_code == 404
    assert client.delete("/api/models/person/download").status_code == 404
    assert client.delete("/api/models/person").status_code == 404


def test_the_real_ports_offer_the_person_model_under_the_data_dir(settings):
    ports = real_ports(settings)
    assert ports.person_model is not None and ports.person_model.path == settings.data_dir / "models" / PERSON_MODEL_FILE


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def call(mcp: Client, tool: str, **arguments) -> dict:
    result = await mcp.call_tool(tool, arguments)
    [content] = result.content
    assert not result.is_error, content.text
    return json.loads(content.text)


@pytest.mark.anyio
async def test_the_mcp_tool_downloads_the_person_model_and_reports_its_state(app_with_model, served):
    client, model = app_with_model
    state, _ = served
    async with Client(client.app.state.mcp) as mcp:
        # Cut short, it reports the failure; called again, it takes the download up and waits for it.
        state.cut_at = 50_000
        failed = await call(mcp, "download_person_model")
        assert failed["state"] == "failed" and "Download it again" in failed["message"] and failed["licence"] == "GPL-3.0"
        assert await call(mcp, "download_person_model") == {"state": "ready", "done": len(GOOD), "total": len(GOOD), "message": None} | NAMED
        assert model.installed
        # Still downloading when it stops waiting: it says how far it has got.
        model.remove()
        state.pause_at = 30_000
        waiting = await call(mcp, "download_person_model", timeout_secs=1)
        assert waiting["state"] == "downloading" and waiting["done"] == 30_000
        state.go.set()
        model.wait(10)
