"""Kokoro on this Mac (GLOSSARY.md, Voice; docs/adr/0019): its model, downloaded on first use into
`DATA_DIR/models`, and the engine that will read with it.

The model is sherpa-onnx's Kokoro int8 multi-language v1.0 archive, its URL, size and SHA-256 pinned
here (KOKORO_URL). KokoroModel fetches it in a thread of its own, one download at a time for the app,
apart from the Narration runner: into a `.part` file, taken up after an interruption with an HTTP Range
request from the `.part`'s size (a server that answers it whole starts the `.part` over). The finished
file is checked against the digest (a mismatch deletes it and fails); the archive is unpacked into a
staging folder and renamed into place, so that a torn download or unpack never looks installed, and an
archive with a member whose path or link leads out of its folder installs nothing. A cancel keeps the
`.part` for the next download. Its state is told as absent, downloading (bytes done of total), ready or
failed (with the message); a failed download is retried by downloading again.
"""

import hashlib
import shutil
import tarfile
import threading
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Literal

import httpx

from app.voices import Pcm, SpeechError, Voice

# In DATA_DIR: the models downloaded on first use, Kokoro's among them.
MODELS_DIR = "models"
# sherpa-onnx's Kokoro v1.0 multi-language, int8 (its `tts-models` release), as Concat pins it
# (docs/referensi/concat/models/manifest.toml, its upstream): the folder the archive unpacks to.
KOKORO_FOLDER = "kokoro-int8-multi-lang-v1_0"
KOKORO_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{KOKORO_FOLDER}.tar.bz2"
KOKORO_SHA256 = "4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e"
KOKORO_BYTES = 132_303_094
# A slow connection is fine; one that says nothing for a minute has dropped.
_TIMEOUT = httpx.Timeout(30, read=60)

DownloadState = Literal["absent", "downloading", "ready", "failed"]


@dataclass(frozen=True)
class KokoroSource:
    """Where the archive comes from, what it must hash to, and how many bytes it is."""

    url: str
    sha256: str
    bytes: int


PINNED = KokoroSource(KOKORO_URL, KOKORO_SHA256, KOKORO_BYTES)


class KokoroBusy(RuntimeError):
    """Kokoro's model is being downloaded: it can't be removed meanwhile."""


class _Cancelled(Exception):
    pass


class _Refused(Exception):
    """The download can't become the model; its message says why. The `.part` is deleted."""


class _Stopped(Exception):
    """The download stopped short; its message says why. The `.part` is kept for the next."""


@dataclass
class _Download:
    # Set by a cancel; the download stops at its next chunk.
    cancelled: threading.Event
    thread: threading.Thread | None = None


class KokoroModel:
    """Kokoro's model in `models_dir` (its folder, KOKORO_FOLDER), fetched from `source`."""

    def __init__(self, models_dir: Path, source: KokoroSource = PINNED, http_client: httpx.Client | None = None) -> None:
        self.models_dir = models_dir
        self.source = source
        self.folder = models_dir / KOKORO_FOLDER
        self.part = models_dir / f"{KOKORO_FOLDER}.tar.bz2.part"
        self.staging = models_dir / f".{KOKORO_FOLDER}.staging"
        self._http = http_client
        self._lock = threading.Lock()
        self._download: _Download | None = None
        self._state: DownloadState = "ready" if self.folder.is_dir() else "absent"
        self._done = 0
        self._message: str | None = None
        # What an unpack cut short left: nothing was installed from it.
        shutil.rmtree(self.staging, ignore_errors=True)

    @property
    def installed(self) -> bool:
        return self.folder.is_dir()

    def state(self) -> dict:
        """{state, done, total, message}: absent, downloading (`done` bytes of `total`), ready or failed
        (`message`). `total` is the archive's size whatever the state."""
        with self._lock:
            downloading = self._state == "downloading"
            state = "downloading" if downloading else "ready" if self.installed else "failed" if self._state == "failed" else "absent"
            done = self.source.bytes if state == "ready" else self._done if state == "downloading" else 0
            return {"state": state, "done": done, "total": self.source.bytes, "message": self._message if state == "failed" else None}

    def download(self) -> None:
        """Start fetching the model, in a thread of its own; nothing when it is installed or being fetched."""
        with self._lock:
            if self.installed or self._state == "downloading":
                return
            previous = self._download
        if previous and previous.thread:
            # A cancelled download winding down: its `.part` is where this one takes up.
            previous.thread.join(10)
        with self._lock:
            if self.installed or self._state == "downloading":
                return
            run = _Download(threading.Event())
            run.thread = threading.Thread(target=self._run, args=(run,), name="kokoro-download", daemon=True)
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
        """Delete the model, and a `.part` left; KokoroBusy while it is being downloaded."""
        with self._lock:
            winding_down = self._download is not None and self._download.thread is not None and self._download.thread.is_alive()
            if self._state == "downloading" or winding_down:
                raise KokoroBusy("Kokoro is being downloaded: cancel the download first")
            shutil.rmtree(self.folder, ignore_errors=True)
            self.part.unlink(missing_ok=True)
            self._state, self._done, self._message = "absent", 0, None

    def wait(self, timeout: float | None = None) -> bool:
        """Wait for the download to end; whether it has (True when none runs)."""
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
                raise _Cancelled
            self._install()
        except _Cancelled:
            self._end(run, "absent")
        except _Refused as exc:
            self.part.unlink(missing_ok=True)
            self._end(run, "failed", str(exc))
        except _Stopped as exc:
            self._end(run, "failed", str(exc))
        except httpx.HTTPError as exc:
            self._end(run, "failed", f"Kokoro's download stopped ({str(exc) or type(exc).__name__}): Download it again to take it up where it stopped")
        except Exception as exc:  # noqa: BLE001 - told to the owner, not lost in a thread
            self._end(run, "failed", f"Kokoro couldn't be downloaded: {exc}")
        else:
            self.part.unlink(missing_ok=True)
            self._end(run, "ready")
        finally:
            shutil.rmtree(self.staging, ignore_errors=True)

    def _headers(self, have: int) -> dict[str, str]:
        return {"Range": f"bytes={have}-"} if have else {}

    def _fetch(self, run: _Download) -> None:
        """The archive into the `.part`, taken up from its size with a Range request."""
        have = self.part.stat().st_size if self.part.is_file() else 0
        if have > self.source.bytes:
            self.part.unlink()
            have = 0
        self._progress(run, have)
        if have == self.source.bytes:
            return
        client = self._http or httpx.Client(follow_redirects=True, timeout=_TIMEOUT)
        try:
            with client.stream("GET", self.source.url, headers=self._headers(have)) as response:
                if response.status_code == 416:  # nothing past what the `.part` has: it is whole
                    return
                if response.status_code == 206 and _range_start(response) == have:
                    mode = "ab"
                elif response.status_code == 200:
                    have, mode = 0, "wb"
                else:
                    raise _Stopped(f"Kokoro's download was refused ({response.status_code} from {httpx.URL(self.source.url).host}): Download it again later")
                with self.part.open(mode) as file:
                    for chunk in response.iter_bytes():
                        if run.cancelled.is_set():
                            raise _Cancelled
                        file.write(chunk)
                        have += len(chunk)
                        self._progress(run, have)
        finally:
            if self._http is None:
                client.close()
        if run.cancelled.is_set():
            raise _Cancelled

    def _check(self) -> None:
        digest = hashlib.sha256()
        with self.part.open("rb") as file:
            while chunk := file.read(1 << 20):
                digest.update(chunk)
        if digest.hexdigest() != self.source.sha256:
            raise _Refused("Kokoro's download didn't match its checksum, so it was deleted: Download it again")

    def _install(self) -> None:
        """The `.part` unpacked into the staging folder, its every member checked first, and the model's
        folder renamed into place."""
        shutil.rmtree(self.staging, ignore_errors=True)
        self.staging.mkdir(parents=True)
        try:
            with tarfile.open(self.part, "r:*") as archive:
                members = archive.getmembers()
                for member in members:
                    if not _inside(member, self.staging):
                        raise _Refused(f"Kokoro's archive has a file outside its folder ({member.name}), so nothing was installed")
                archive.extractall(self.staging, members=members, filter="data")
        except tarfile.TarError as exc:
            raise _Refused(f"Kokoro's archive couldn't be unpacked ({exc}), so it was deleted: Download it again") from exc
        unpacked = self.staging / KOKORO_FOLDER
        if not unpacked.is_dir() or not any(unpacked.glob("*.onnx")):
            raise _Refused("Kokoro's archive had no Kokoro model in it, so nothing was installed")
        shutil.rmtree(self.folder, ignore_errors=True)
        unpacked.rename(self.folder)


def _inside(member: tarfile.TarInfo, folder: Path) -> bool:
    """Whether the archive's `member` stays in `folder` once unpacked: a relative path with no `..`, a
    file, folder or link, and a link that leads nowhere outside it either (tarfile's data filter)."""
    name = PurePosixPath(member.name)
    if name.is_absolute() or ".." in name.parts or not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
        return False
    try:
        tarfile.data_filter(member, str(folder))
    except tarfile.FilterError:
        return False
    return True


def _range_start(response: httpx.Response) -> int | None:
    """Where a 206's Content-Range ("bytes 100-199/200") starts."""
    try:
        return int(response.headers["content-range"].removeprefix("bytes ").split("-", 1)[0])
    except (KeyError, ValueError):
        return None


class KokoroSpeech:
    """Kokoro, read on this Mac: its words never leave it. Listed in the engine picker as "On this Mac",
    its download offered beside it. It reads nothing yet: ticket 08 brings sherpa-onnx, its English
    Voices and its native Speed, reading with `model` once installed."""

    id = "kokoro"
    label = "Kokoro"
    service = None
    local = True
    takes_style = False
    takes_speed = True

    def __init__(self, model: KokoroModel) -> None:
        self.model = model

    def ready(self) -> bool:
        return False

    def voices(self) -> list[Voice]:
        return []

    def read(self, text: str, voice: str, style: str | None = None, speed: float = 1.0) -> Pcm:
        raise SpeechError("Kokoro can't read yet")
