"""A model downloaded on first use into `DATA_DIR/models` (docs/adr/0019, 0015): Kokoro's (app/kokoro.py)
and the person model (app/person_model.py).

Its URL, size and SHA-256 are pinned (ModelSource). ModelDownload fetches it in a thread of its own, one
download at a time per model: into a `.part` file, taken up after an interruption with an HTTP Range
request from the `.part`'s size (a server that answers it whole starts the `.part` over). The finished
file is checked against the digest (a mismatch deletes it and fails), then installed by the model's own
`_install` (an unpack, a rename), so that a torn download never looks installed. A cancel keeps the
`.part` for the next download; a download asked while a cancelled one is still stopping (it stops at its
next chunk) is refused, so that two never write the `.part`. Its state is told as absent, downloading
(bytes done of total), ready or failed (with the message); a failed download is retried by downloading
again.
"""

import hashlib
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import httpx

from app.voices import Cancelled

# In DATA_DIR: the models downloaded on first use.
MODELS_DIR = "models"
# A slow connection is fine; one that says nothing for a minute has dropped.
_TIMEOUT = httpx.Timeout(30, read=60)

DownloadState = Literal["absent", "downloading", "ready", "failed"]


@dataclass(frozen=True)
class ModelSource:
    """Where the model comes from, what it must hash to, and how many bytes it is."""

    url: str
    sha256: str
    bytes: int


class ModelBusy(RuntimeError):
    """The model is being downloaded, or a cancelled download is still stopping: it can't be removed,
    nor downloaded again, meanwhile."""


class Refused(Exception):
    """The download can't become the model; its message says why. The `.part` is deleted."""


class _Stopped(Exception):
    """The download stopped short; its message says why. The `.part` is kept for the next."""


@dataclass
class _Download:
    # Set by a cancel; the download stops at its next chunk.
    cancelled: threading.Event
    thread: threading.Thread | None = None


class ModelDownload:
    """A model in `models_dir`, fetched from `source` into `part`. A subclass names it (`name`, as its
    messages start: "Kokoro", "The person model"), says whether it is `installed`, installs the checked
    `.part` (`_install`) and deletes it (`_delete`); `busy` is the ModelBusy it raises."""

    name = "The model"
    busy: type[ModelBusy] = ModelBusy

    def __init__(self, models_dir: Path, source: ModelSource, part: Path, http_client: httpx.Client | None = None) -> None:
        self.models_dir = models_dir
        self.source = source
        self.part = part
        self._http = http_client
        self._lock = threading.Lock()
        self._download: _Download | None = None
        self._state: DownloadState = "ready" if self.installed else "absent"
        self._done = 0
        self._message: str | None = None

    @property
    def installed(self) -> bool:
        raise NotImplementedError

    def _install(self) -> None:
        """The checked `.part` made the model, in place; Refused when it can't be."""
        raise NotImplementedError

    def _delete(self) -> None:
        """The installed model deleted, with `_lock` held."""
        raise NotImplementedError

    def _cleanup(self) -> None:
        """What a download leaves besides the `.part`, deleted once it ends, whatever its end."""

    def state(self) -> dict:
        """{state, done, total, message}: absent, downloading (`done` bytes of `total`), ready or failed
        (`message`). `total` is the download's size whatever the state."""
        with self._lock:
            downloading = self._state == "downloading"
            state = "downloading" if downloading else "ready" if self.installed else "failed" if self._state == "failed" else "absent"
            done = self.source.bytes if state == "ready" else self._done if state == "downloading" else 0
            return {"state": state, "done": done, "total": self.source.bytes, "message": self._message if state == "failed" else None}

    def download(self) -> None:
        """Start fetching the model, in a thread of its own, taken up from the `.part` a cancelled one
        left; nothing when it is installed or being fetched. `busy` while a cancelled download is still
        stopping (at its next chunk): two would write the same `.part`."""
        with self._lock:
            if self.installed or self._state == "downloading":
                return
            if self._winding_down():
                raise self.busy(f"{self.name}'s cancelled download is still stopping: download it again in a moment")
            run = _Download(threading.Event())
            run.thread = threading.Thread(target=self._run, args=(run,), name=f"{self.part.stem}-download", daemon=True)
            self._download = run
            self._state, self._done, self._message = "downloading", 0, None
        run.thread.start()

    def cancel(self) -> None:
        """Stop the download at its next chunk, its `.part` kept for the next; absent at once."""
        with self._lock:
            if self._download is None or self._state != "downloading":
                return
            self._download.cancelled.set()
            self._state, self._done = "absent", 0

    def remove(self) -> None:
        """Delete the model, and a `.part` left; `busy` while it is being downloaded."""
        with self._lock:
            if self._state == "downloading" or self._winding_down():
                raise self.busy(f"{self.name} is being downloaded: cancel the download first")
            self._delete()
            self.part.unlink(missing_ok=True)
            self._state, self._done, self._message = "absent", 0, None

    def _winding_down(self) -> bool:
        """Whether a download's thread is still running (a cancelled one stops at its next chunk); with
        `_lock` held."""
        run = self._download
        return run is not None and run.thread is not None and run.thread.is_alive()

    def wait(self, timeout: float | None = None) -> bool:
        """Wait for the download to end; whether it has (True when none runs)."""
        with self._lock:
            run = self._download
        if run is None or run.thread is None:
            return True
        run.thread.join(timeout)
        return not run.thread.is_alive()

    def _end(self, run: _Download, state: DownloadState, message: str | None = None) -> None:
        with self._lock:
            if self._download is run and self._state == "downloading":
                self._state, self._message = state, message

    def _progress(self, run: _Download, done: int) -> None:
        with self._lock:
            if self._download is run and self._state == "downloading":
                self._done = done

    def _run(self, run: _Download) -> None:
        try:
            self.models_dir.mkdir(parents=True, exist_ok=True)
            self._fetch(run)
            self._check()
            if run.cancelled.is_set():
                raise Cancelled
            self._install()
        except Cancelled:
            self._end(run, "absent")
        except Refused as exc:
            self.part.unlink(missing_ok=True)
            self._end(run, "failed", str(exc))
        except _Stopped as exc:
            self._end(run, "failed", str(exc))
        except httpx.HTTPError as exc:
            self._end(run, "failed", f"{self.name}'s download stopped ({str(exc) or type(exc).__name__}): Download it again to take it up where it stopped")
        except Exception as exc:  # noqa: BLE001 - told to the owner, not lost in a thread
            self._end(run, "failed", f"{self.name} couldn't be downloaded: {exc}")
        else:
            self.part.unlink(missing_ok=True)
            self._end(run, "ready")
        finally:
            self._cleanup()

    def _fetch(self, run: _Download) -> None:
        """The model into the `.part`, taken up from its size with a Range request."""
        have = self.part.stat().st_size if self.part.is_file() else 0
        if have > self.source.bytes:
            self.part.unlink()
            have = 0
        self._progress(run, have)
        if have == self.source.bytes:
            return
        client = self._http or httpx.Client(follow_redirects=True, timeout=_TIMEOUT)
        try:
            with client.stream("GET", self.source.url, headers={"Range": f"bytes={have}-"} if have else {}) as response:
                if response.status_code == 416:  # nothing past what the `.part` has: it is whole
                    return
                if response.status_code == 206 and _range_start(response) == have:
                    mode = "ab"
                elif response.status_code == 200:
                    have, mode = 0, "wb"
                else:
                    raise _Stopped(f"{self.name}'s download was refused ({response.status_code} from {httpx.URL(self.source.url).host}): Download it again later")
                with self.part.open(mode) as file:
                    for chunk in response.iter_bytes():
                        if run.cancelled.is_set():
                            raise Cancelled
                        file.write(chunk)
                        have += len(chunk)
                        self._progress(run, have)
        finally:
            if self._http is None:
                client.close()
        if run.cancelled.is_set():
            raise Cancelled

    def _check(self) -> None:
        digest = hashlib.sha256()
        with self.part.open("rb") as file:
            while chunk := file.read(1 << 20):
                digest.update(chunk)
        if digest.hexdigest() != self.source.sha256:
            raise Refused(f"{self.name}'s download didn't match its checksum, so it was deleted: Download it again")


def _range_start(response: httpx.Response) -> int | None:
    """Where a 206's Content-Range ("bytes 100-199/200") starts."""
    try:
        return int(response.headers["content-range"].removeprefix("bytes ").split("-", 1)[0])
    except (KeyError, ValueError):
        return None
