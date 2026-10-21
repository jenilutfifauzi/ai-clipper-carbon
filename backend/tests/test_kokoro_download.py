"""Kokoro's model downloaded and removed (.scratch/text-to-speech/issues/07-download-and-remove-kokoro.md,
docs/adr/0019), against a local HTTP server that honours Range, in place of sherpa-onnx's release: fetched
into a `.part`, resumed, checked against its digest, unpacked through a staging folder and renamed into
place; cancelled and removed through the HTTP API."""

import hashlib
import io
import os
import tarfile
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.kokoro import KOKORO_BYTES, KOKORO_FOLDER, KOKORO_SHA256, KOKORO_URL, KokoroBusy, KokoroModel, KokoroSource
from app.main import create_app
from app.ports import Ports, real_ports
from fakes import FakeVoiceEngine

ROOT = KOKORO_FOLDER


def archive(members: dict[str, bytes], links: dict[str, str] | None = None) -> bytes:
    """A tar.bz2 of `members` (name: bytes) and symbolic `links` (name: target)."""
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode="w:bz2") as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            tar.addfile(info)
    return out.getvalue()


# Kokoro's archive as sherpa-onnx lays it out, one folder named for it; random bytes, so that bz2 can't
# shrink it below a few chunks.
MODEL = os.urandom(300_000)
GOOD = archive(
    {
        f"{ROOT}/model.int8.onnx": MODEL,
        f"{ROOT}/voices.bin": os.urandom(50_000),
        f"{ROOT}/tokens.txt": b"a 1\n",
        f"{ROOT}/espeak-ng-data/phontab": os.urandom(10_000),
    }
)


@dataclass
class Served:
    """What the local server serves at /kokoro.tar.bz2, and what it was asked."""

    body: bytes
    # Each request's Range header (None without one).
    ranges: list[str | None] = field(default_factory=list)
    # Close the connection after this many bytes of the next answer (then serve whole again).
    cut_at: int | None = None
    # Wait for `go` after this many bytes of each answer.
    pause_at: int | None = None
    go: threading.Event = field(default_factory=threading.Event)
    # Answer every request whole, as a server that doesn't take Range.
    ignore_range: bool = False


@pytest.fixture
def served() -> Iterator[tuple[Served, str]]:
    """A local server for an archive, honouring Range; its state and its URL."""
    state = Served(GOOD)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args) -> None:
            pass

        def do_GET(self) -> None:
            if self.path != "/kokoro.tar.bz2":
                self.send_error(404)
                return
            asked = self.headers.get("Range")
            state.ranges.append(asked)
            body, start = state.body, 0
            if asked and not state.ignore_range:
                start = int(asked.removeprefix("bytes=").removesuffix("-"))
                if start >= len(body):
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{len(body)}")
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{len(body) - 1}/{len(body)}")
            else:
                self.send_response(200)
            rest = body[start:]
            self.send_header("Content-Length", str(len(rest)))
            self.end_headers()
            cut, state.cut_at = state.cut_at, None
            if cut is not None:
                self.wfile.write(rest[:cut])
                self.wfile.flush()
                self.close_connection = True
                return
            if state.pause_at is not None:
                self.wfile.write(rest[: state.pause_at])
                self.wfile.flush()
                state.go.wait(10)
                rest = rest[state.pause_at :]
            self.wfile.write(rest)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        yield state, f"http://127.0.0.1:{server.server_port}/kokoro.tar.bz2"
    finally:
        state.go.set()
        server.shutdown()
        server.server_close()


def source(url: str, body: bytes = GOOD) -> KokoroSource:
    return KokoroSource(url, hashlib.sha256(body).hexdigest(), len(body))


def settle(model: KokoroModel) -> dict:
    """The model's state once its download has ended."""
    assert model.wait(10)
    return model.state()


def test_the_pinned_source_is_sherpa_onnxs_kokoro_int8_multi_language_archive():
    assert KOKORO_URL == "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_0.tar.bz2"
    assert len(KOKORO_SHA256) == 64 and int(KOKORO_SHA256, 16)
    assert KOKORO_BYTES == 132_303_094
    model = KokoroModel(Path("/nowhere"))
    assert model.source == KokoroSource(KOKORO_URL, KOKORO_SHA256, KOKORO_BYTES)


def test_a_good_archive_is_fetched_checked_unpacked_and_reported_ready(served, tmp_path):
    state, url = served
    models = tmp_path / "models"
    model = KokoroModel(models, source(url))
    assert model.state() == {"state": "absent", "done": 0, "total": len(GOOD), "message": None}
    model.download()
    assert settle(model) == {"state": "ready", "done": len(GOOD), "total": len(GOOD), "message": None}
    assert model.installed
    assert (model.folder / "model.int8.onnx").read_bytes() == MODEL
    assert (model.folder / "espeak-ng-data" / "phontab").is_file()
    # The archive and the staging folder are gone: only the model is left.
    assert sorted(path.name for path in models.iterdir()) == [ROOT]
    assert state.ranges == [None]
    # Asked again, nothing is fetched.
    model.download()
    assert settle(model)["state"] == "ready" and state.ranges == [None]
    # A model found on disk is ready from the start.
    assert KokoroModel(models, source(url)).state()["state"] == "ready"


def test_a_wrong_digest_deletes_the_file_and_reports_failed(served, tmp_path):
    _, url = served
    models = tmp_path / "models"
    model = KokoroModel(models, KokoroSource(url, "0" * 64, len(GOOD)))
    model.download()
    state = settle(model)
    assert state["state"] == "failed" and "checksum" in state["message"]
    assert not model.installed
    assert list(models.iterdir()) == []


def test_an_interrupted_download_resumes_with_a_range_request_from_the_part_size(served, tmp_path):
    state, url = served
    model = KokoroModel(tmp_path / "models", source(url))
    state.cut_at = 100_000
    model.download()
    stopped = settle(model)
    assert stopped["state"] == "failed" and "Download it again" in stopped["message"]
    assert not model.installed
    kept = model.part.stat().st_size
    assert 0 < kept <= 100_000
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None, f"bytes={kept}-"]
    assert (model.folder / "model.int8.onnx").read_bytes() == MODEL


def test_a_part_left_from_before_is_taken_up_where_it_ended(served, tmp_path):
    state, url = served
    models = tmp_path / "models"
    models.mkdir()
    model = KokoroModel(models, source(url))
    model.part.write_bytes(GOOD[:12_345])
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == ["bytes=12345-"]


def test_a_server_that_ignores_the_range_starts_the_part_over(served, tmp_path):
    state, url = served
    models = tmp_path / "models"
    models.mkdir()
    model = KokoroModel(models, source(url))
    model.part.write_bytes(b"x" * 50)
    state.ignore_range = True
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == ["bytes=50-"]
    assert (model.folder / "model.int8.onnx").read_bytes() == MODEL


@pytest.mark.parametrize(
    "members, links",
    [
        ({f"{ROOT}/model.int8.onnx": b"x", "../escaped.txt": b"out"}, None),
        ({f"{ROOT}/model.int8.onnx": b"x", "/tmp/escaped.txt": b"out"}, None),
        ({f"{ROOT}/model.int8.onnx": b"x"}, {f"{ROOT}/link": "../../outside"}),
    ],
    ids=["dot-dot", "absolute", "link-out"],
)
def test_an_archive_member_escaping_the_folder_is_refused_and_nothing_is_installed(served, tmp_path, members, links):
    state, url = served
    state.body = archive(members, links)
    models = tmp_path / "models"
    model = KokoroModel(models, source(url, state.body))
    model.download()
    refused = settle(model)
    assert refused["state"] == "failed" and "outside its folder" in refused["message"]
    assert not model.installed
    assert list(models.iterdir()) == []
    assert not (tmp_path / "escaped.txt").exists() and not Path("/tmp/escaped.txt").exists()


def test_an_archive_without_the_model_is_refused(served, tmp_path):
    state, url = served
    state.body = archive({f"{ROOT}/readme.txt": b"no model here"})
    model = KokoroModel(tmp_path / "models", source(url, state.body))
    model.download()
    refused = settle(model)
    assert refused["state"] == "failed" and "no Kokoro model" in refused["message"]
    assert list((tmp_path / "models").iterdir()) == []


def test_cancel_leaves_the_part_for_a_later_resume_and_reports_absent(served, tmp_path):
    state, url = served
    model = KokoroModel(tmp_path / "models", source(url))
    state.pause_at = 70_000
    model.download()
    deadline = time.monotonic() + 5
    while model.state()["done"] < 70_000 and time.monotonic() < deadline:
        time.sleep(0.01)
    downloading = model.state()
    assert downloading["state"] == "downloading" and downloading["done"] == 70_000 and downloading["total"] == len(GOOD)
    model.cancel()
    assert model.state()["state"] == "absent"
    state.go.set()
    assert settle(model)["state"] == "absent"
    kept = model.part.stat().st_size
    assert 70_000 <= kept < len(GOOD)
    state.pause_at = None
    model.download()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None, f"bytes={kept}-"]


def test_a_download_while_the_cancelled_one_is_still_stopping_is_refused_and_taken_once_it_has(served, tmp_path):
    state, url = served
    model = KokoroModel(tmp_path / "models", source(url))
    state.pause_at = 70_000
    model.download()
    deadline = time.monotonic() + 5
    while model.state()["done"] < 70_000 and time.monotonic() < deadline:
        time.sleep(0.01)
    model.cancel()
    # The cancelled thread is still waiting on its next chunk: a second would write the same `.part`.
    with pytest.raises(KokoroBusy, match="still stopping"):
        model.download()
    assert model.state()["state"] == "absent"
    state.go.set()
    assert settle(model)["state"] == "absent"
    state.pause_at = None
    model.download()
    assert settle(model)["state"] == "ready"


def test_one_download_at_a_time(served, tmp_path):
    state, url = served
    model = KokoroModel(tmp_path / "models", source(url))
    state.pause_at = 10_000
    model.download()
    model.download()
    state.go.set()
    assert settle(model)["state"] == "ready"
    assert state.ranges == [None]


def test_remove_deletes_the_model_and_the_part(served, tmp_path):
    _, url = served
    model = KokoroModel(tmp_path / "models", source(url))
    model.download()
    settle(model)
    model.remove()
    assert model.state()["state"] == "absent"
    assert not model.folder.exists() and not model.part.exists()


# Through the HTTP API, with Kokoro offered beside a fake cloud engine.


@pytest.fixture
def engine() -> FakeVoiceEngine:
    return FakeVoiceEngine("fake")


@pytest.fixture
def app_with_kokoro(settings, video_source, transcriber, llm, engine, served):
    _, url = served
    model = KokoroModel(settings.data_dir / "models", source(url))
    ports = Ports(video_source, transcriber, llm, voices=(engine,), kokoro=model)
    with TestClient(create_app(settings, ports)) as client:
        try:
            yield client, model
        finally:
            engine.release()
            video_source.release()
            transcriber.release()
            transcriber.stop()


def test_voices_lists_kokoro_on_this_mac_with_its_download_state(app_with_kokoro, served):
    client, model = app_with_kokoro
    state, _ = served
    voices = client.get("/api/voices", params={"language": "en"}).json()
    kokoro = voices["engines"][-1]
    assert (kokoro["id"], kokoro["label"], kokoro["service"], kokoro["local"], kokoro["ready"]) == ("kokoro", "Kokoro", None, True, False)
    assert voices["kokoro"] == {"state": "absent", "done": 0, "total": len(GOOD), "message": None}
    assert voices["default"] == "fake"

    state.pause_at = 20_000
    assert client.post("/api/voices/kokoro/download").status_code == 202
    deadline = time.monotonic() + 5
    while client.get("/api/voices").json()["kokoro"]["done"] < 20_000 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert client.get("/api/voices").json()["kokoro"] == {"state": "downloading", "done": 20_000, "total": len(GOOD), "message": None}
    assert client.delete("/api/voices/kokoro/download").status_code == 204
    assert client.get("/api/voices").json()["kokoro"]["state"] == "absent"
    refused = client.post("/api/voices/kokoro/download")
    assert refused.status_code == 409 and "still stopping" in refused.json()["detail"]
    state.go.set()
    model.wait(10)

    state.pause_at = None
    assert client.post("/api/voices/kokoro/download").status_code == 202
    model.wait(10)
    voices = client.get("/api/voices").json()
    assert voices["kokoro"]["state"] == "ready"
    # Installed, it reads (with sherpa-onnx, installed here), and an English Job starts with it.
    assert voices["engines"][-1]["ready"] is True
    assert client.get("/api/voices", params={"language": "en"}).json()["default"] == "kokoro"


def test_remove_deletes_the_model_and_its_samples_and_is_refused_while_a_narration_runs(app_with_kokoro, engine, settings):
    client, model = app_with_kokoro
    client.post("/api/voices/kokoro/download")
    model.wait(10)
    samples = settings.data_dir / "voice-samples" / "kokoro"
    samples.mkdir(parents=True)
    (samples / "af_heart.en.wav").write_bytes(b"RIFF")

    engine.hold()
    started = client.post("/api/narrations", json={"text": "Halo.", "engine": "fake", "voice": "ana"})
    assert started.status_code == 202
    refused = client.delete("/api/voices/kokoro")
    assert refused.status_code == 409 and "Narration" in refused.json()["detail"]
    assert model.installed
    engine.release()
    with client.stream("GET", f"/api/narrations/{started.json()['id']}/events") as response:
        list(response.iter_lines())

    assert client.delete("/api/voices/kokoro").status_code == 204
    assert not model.installed and not samples.exists()
    assert client.get("/api/voices").json()["kokoro"]["state"] == "absent"
    # The runner is free again.
    assert client.post("/api/narrations", json={"text": "Lagi.", "engine": "fake", "voice": "ana"}).status_code == 202


def test_without_kokoro_offered_its_routes_are_404_and_voices_carry_no_state(client):
    assert client.get("/api/voices").json()["kokoro"] is None
    assert client.post("/api/voices/kokoro/download").status_code == 404
    assert client.delete("/api/voices/kokoro").status_code == 404


def test_the_real_ports_offer_kokoro_under_the_data_dir(settings):
    ports = real_ports(settings)
    assert ports.kokoro is not None and ports.kokoro.folder.parent == settings.data_dir / "models"
