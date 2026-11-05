"""Whisper's model, fetched into the Hugging Face cache before a Job transcribes with it.

The first local transcription on a machine downloads the model (1.6 GB for large-v3-turbo). It is
fetched here, as a step of its own that the Job shows, rather than by the worker inside a chunk the
watchdog times. A slow connection then shows how far it has got, and does not run the first chunk
past its budget. The download runs in a spawned process, which is killed when nothing has arrived
for STALL_SECS and started again (resuming where it was) at most ATTEMPTS times in all.

Once it is here, the worker loads the model from its folder (`cached`), without asking the Hub
again, so it neither waits on the network nor warns about unauthenticated requests.
"""

import logging
import multiprocessing
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Protocol

logger = logging.getLogger(__name__)

STALL_SECS = 120.0
ATTEMPTS = 3
POLL_SECS = 1.0
# Files that hold a model's weights: MLX's, and CTranslate2's.
WEIGHTS = ("*.safetensors", "*.npz", "model.bin")


class ModelDownloadFailed(RuntimeError):
    """Whisper's model couldn't be fetched; the Job can be retried, and resumes the download."""


class Download(Protocol):
    """A download running elsewhere, as a multiprocessing Process is."""

    exitcode: int | None

    def is_alive(self) -> bool: ...

    def join(self, timeout: float | None = None) -> None: ...

    def kill(self) -> None: ...


def hub_cache() -> Path:
    from huggingface_hub import constants

    return Path(constants.HF_HUB_CACHE)


def _repo_dir(model: str, cache: Path) -> Path:
    return cache / f"models--{model.replace('/', '--')}"


def cached(model: str, cache: Path | None = None) -> Path | None:
    """The folder `model` is loaded from when all of it is here: the model itself when it is a
    folder, or a Hub repo's snapshot in `cache` with its weights whole (none half-downloaded).
    None otherwise."""
    if (folder := Path(model).expanduser()).is_dir():
        return folder
    repo = _repo_dir(model, cache or hub_cache())
    try:
        snapshot = repo / "snapshots" / (repo / "refs" / "main").read_text().strip()
    except OSError:
        return None
    if any((repo / "blobs").glob("*.incomplete")):
        return None
    weights = [file for pattern in WEIGHTS for file in snapshot.glob(pattern)]
    return snapshot if weights and all(file.exists() for file in weights) else None


def arrived(model: str, cache: Path | None = None) -> int:
    """How many bytes of `model` are in `cache` so far, whole or half-downloaded."""
    blobs = _repo_dir(model, cache or hub_cache()) / "blobs"
    try:
        return sum(file.lstat().st_size for file in blobs.iterdir() if not file.is_symlink())
    except OSError:
        return 0


def total_size(model: str) -> int | None:
    """How big `model`'s files are on the Hub, or None when the Hub doesn't say."""
    try:
        from huggingface_hub import HfApi

        info = HfApi().model_info(model, files_metadata=True)
        return sum(sibling.size or 0 for sibling in info.siblings or []) or None
    except Exception:
        return None


def _download(model: str) -> None:
    """Fetch `model` into the Hub cache (in a spawned process)."""
    os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"
    from huggingface_hub import snapshot_download

    snapshot_download(model)


def _spawn(model: str) -> Download:
    process = multiprocessing.get_context("spawn").Process(target=_download, args=(model,), name="whisper-model", daemon=True)
    process.start()
    return process


def fetch(
    model: str,
    downloading: Callable[[int, int | None], None],
    cache: Path | None = None,
    start: Callable[[str], Download] = _spawn,
    stall_secs: float = STALL_SECS,
    poll_secs: float = POLL_SECS,
) -> Path:
    """The folder of `model`, downloaded first when it isn't all here. While it downloads,
    `downloading` is called with the bytes arrived and the total (None when unknown) as they
    change. Raises ModelDownloadFailed after ATTEMPTS downloads that stalled or failed."""
    if (folder := cached(model, cache)) is not None:
        return folder
    total = total_size(model)
    for attempt in range(1, ATTEMPTS + 1):
        download = start(model)
        shown, changed = -1, time.monotonic()
        while download.is_alive():
            download.join(poll_secs)
            if (now := arrived(model, cache)) != shown:
                shown, changed = now, time.monotonic()
                downloading(now, total)
            elif time.monotonic() - changed > stall_secs:
                download.kill()
                download.join()
                logger.warning("Downloading %s: nothing arrived for %.0f s (attempt %d)", model, stall_secs, attempt)
                break
        if (folder := cached(model, cache)) is not None:
            return folder
        if download.exitcode:
            logger.warning("Downloading %s failed (exit code %s, attempt %d)", model, download.exitcode, attempt)
    raise ModelDownloadFailed(
        f"Couldn't download the Whisper model {model}: it stalled or failed {ATTEMPTS} times. "
        "Check the internet connection, then retry the Job (the download resumes)."
    )
