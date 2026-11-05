"""Whisper's model fetched into a Hub cache laid out as huggingface_hub lays it out, by fake downloads."""

import threading
from pathlib import Path

import pytest

from app import whisper_model
from app.whisper_model import ModelDownloadFailed, arrived, cached, fetch

MODEL = "mlx-community/whisper-large-v3-turbo"
COMMIT = "a4aaeec0636e6fef84abdcbe3544cb2bf7e9f6fb"
WEIGHTS = 3000


def repo(cache: Path) -> Path:
    return cache / "models--mlx-community--whisper-large-v3-turbo"


def started(cache: Path) -> None:
    """The repo's ref and its small files, as a download leaves them before the weights."""
    (repo(cache) / "refs").mkdir(parents=True)
    (repo(cache) / "refs" / "main").write_text(COMMIT)
    (repo(cache) / "blobs").mkdir()
    snapshot = repo(cache) / "snapshots" / COMMIT
    snapshot.mkdir(parents=True)
    (repo(cache) / "blobs" / "c0nf1g").write_text("{}")
    (snapshot / "config.json").symlink_to("../../blobs/c0nf1g")


def part(cache: Path) -> Path:
    return repo(cache) / "blobs" / "w31ght5.incomplete"


def finished(cache: Path) -> None:
    """The weights whole, moved into place and linked from the snapshot."""
    part(cache).rename(repo(cache) / "blobs" / "w31ght5")
    (repo(cache) / "snapshots" / COMMIT / "weights.safetensors").symlink_to("../../blobs/w31ght5")


class FakeDownload:
    """Writes the weights `step` bytes at a time until they are whole, or stops sending at
    `stall_at` bytes until it is killed."""

    def __init__(self, cache: Path, step: int = 1000, stall_at: int | None = None) -> None:
        self.exitcode: int | None = None
        self._killed = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(cache, step, stall_at), daemon=True)
        self._thread.start()

    def _run(self, cache: Path, step: int, stall_at: int | None) -> None:
        if not repo(cache).exists():
            started(cache)
        with part(cache).open("ab") as file:
            while file.tell() < WEIGHTS:
                if file.tell() == stall_at:
                    self._killed.wait()
                if self._killed.is_set():
                    self.exitcode = -9
                    return
                file.write(b"x" * step)
                file.flush()
                self._killed.wait(0.02)
        finished(cache)
        self.exitcode = 0

    def is_alive(self) -> bool:
        return self._thread.is_alive()

    def join(self, timeout: float | None = None) -> None:
        self._thread.join(timeout)

    def kill(self) -> None:
        self._killed.set()


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    monkeypatch.setattr(whisper_model, "total_size", lambda model: WEIGHTS)


def test_a_model_is_cached_only_when_its_weights_are_whole(tmp_path):
    assert cached(MODEL, tmp_path) is None
    started(tmp_path)
    assert cached(MODEL, tmp_path) is None
    part(tmp_path).write_bytes(b"x" * 10)
    assert cached(MODEL, tmp_path) is None and arrived(MODEL, tmp_path) == 12
    finished(tmp_path)
    assert cached(MODEL, tmp_path) == repo(tmp_path) / "snapshots" / COMMIT
    # A folder is the model itself.
    assert cached(str(tmp_path)) == tmp_path


def test_a_missing_model_is_downloaded_reporting_what_arrived_and_a_cached_one_is_not(tmp_path):
    reports, starts = [], []

    def start(model):
        starts.append(model)
        return FakeDownload(tmp_path)

    folder = fetch(MODEL, lambda done, total: reports.append((done, total)), tmp_path, start, poll_secs=0.01)
    assert folder == repo(tmp_path) / "snapshots" / COMMIT and starts == [MODEL]
    assert reports and all(total == WEIGHTS for _, total in reports)
    assert [done for done, _ in reports] == sorted(done for done, _ in reports)
    assert fetch(MODEL, lambda *_: pytest.fail("reported"), tmp_path, lambda model: pytest.fail("started")) == folder


def test_a_stalled_download_is_killed_and_resumed(tmp_path):
    downloads = []

    def start(model):
        downloads.append(FakeDownload(tmp_path, stall_at=None if downloads else 2000))
        return downloads[-1]

    folder = fetch(MODEL, lambda *_: None, tmp_path, start, stall_secs=0.2, poll_secs=0.01)
    assert folder is not None and [download.exitcode for download in downloads] == [-9, 0]
    # Resumed: the second wrote only what was missing.
    assert (repo(tmp_path) / "blobs" / "w31ght5").stat().st_size == WEIGHTS


def test_a_download_that_keeps_stalling_fails_so_the_job_can_be_retried(tmp_path):
    starts = []

    def start(model):
        starts.append(model)
        return FakeDownload(tmp_path, stall_at=1000)

    with pytest.raises(ModelDownloadFailed, match="retry the Job"):
        fetch(MODEL, lambda *_: None, tmp_path, start, stall_secs=0.1, poll_secs=0.01)
    assert len(starts) == whisper_model.ATTEMPTS and cached(MODEL, tmp_path) is None
