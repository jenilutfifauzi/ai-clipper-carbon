"""Kokoro on this Mac (GLOSSARY.md, Voice; docs/adr/0019): its model, downloaded on first use into
`DATA_DIR/models`, and the engine that will read with it.

The model is sherpa-onnx's Kokoro int8 multi-language v1.0 archive, its URL, size and SHA-256 pinned
here (KOKORO_URL). KokoroModel fetches it in a thread of its own, one download at a time for the app,
apart from the Narration runner: into a `.part` file, taken up after an interruption with an HTTP Range
request from the `.part`'s size (a server that answers it whole starts the `.part` over). The finished
file is checked against the digest (a mismatch deletes it and fails); the archive is unpacked into a
staging folder and renamed into place, so that a torn download or unpack never looks installed, and an
archive with a member whose path or link leads out of its folder installs nothing. A cancel keeps the
`.part` for the next download; a download asked while a cancelled one is still stopping (it stops at
its next chunk) is refused, so that two never write the `.part`. Its state is told as absent, downloading (bytes done of total), ready or
failed (with the message); a failed download is retried by downloading again.

KokoroSpeech reads with it through sherpa-onnx's OfflineTts, its English Voices only (American and
British, each a speaker id of the model's), Speed sent to it natively, no Style. The engine is loaded by
`load` (the Narration's "Loading the voice" stage), else on the first read, and kept by KokoroModel until the model is removed, which unloads it. sherpa-onnx is
imported only then: without it the app still starts, and Kokoro isn't ready.
"""

import hashlib
import importlib.util
import os
import shutil
import tarfile
import threading
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Literal, Protocol

import httpx
import numpy as np

from app.voices import Cancelled, Pcm, SpeechError, Voice

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


class KokoroTts(Protocol):
    """Kokoro's loaded engine, as sherpa-onnx's OfflineTts is: one read is float samples at its rate."""

    sample_rate: int

    def generate(self, text: str, sid: int = 0, speed: float = 1.0) -> Any: ...


# What loads Kokoro's engine from the model's folder (sherpa-onnx's, unless a test fakes it).
KokoroLoader = Callable[[Path], KokoroTts]


class KokoroBusy(RuntimeError):
    """Kokoro's model is being downloaded, or a cancelled download is still stopping: it can't be
    removed, nor downloaded again, meanwhile."""


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
    """Kokoro's model in `models_dir` (its folder, KOKORO_FOLDER), fetched from `source`, and its engine
    once loaded, by `load` (sherpa-onnx's unless a test fakes it)."""

    def __init__(
        self, models_dir: Path, source: KokoroSource = PINNED, http_client: httpx.Client | None = None, load: KokoroLoader | None = None
    ) -> None:
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
        # The loaded engine, kept until the model is removed; its lock is held through a load and a read.
        self._load = load
        self._tts: KokoroTts | None = None
        self._tts_lock = threading.Lock()
        # What an unpack cut short left: nothing was installed from it.
        shutil.rmtree(self.staging, ignore_errors=True)

    @property
    def installed(self) -> bool:
        return self.folder.is_dir()

    @property
    def loadable(self) -> bool:
        """Whether its engine can be loaded here: sherpa-onnx is installed (or a loader given)."""
        return self._load is not None or importlib.util.find_spec("sherpa_onnx") is not None

    def load(self) -> None:
        """Load the engine, unless it is loaded. SpeechError without the model or sherpa-onnx, or when
        the model doesn't load."""
        with self._tts_lock:
            self._engine()

    def generate(self, text: str, sid: int, speed: float) -> tuple[np.ndarray, int]:
        """`text` read by speaker `sid` at `speed`: float samples and their rate. The engine is loaded on
        the first read unless `load` did it, once whatever reads at the same time, and reads one at a
        time. SpeechError as `load`'s."""
        with self._tts_lock:
            audio = self._engine().generate(text, sid=sid, speed=speed)
            return np.asarray(audio.samples, dtype=np.float32), int(audio.sample_rate)

    def _engine(self) -> KokoroTts:
        """The loaded engine, loaded now if it isn't; with `_tts_lock` held."""
        if not self.installed:
            raise SpeechError("Kokoro's model isn't on this Mac: download it in the Narrate tab")
        if self._tts is None:
            self._tts = self._loaded()
        return self._tts

    def _loaded(self) -> KokoroTts:
        try:
            return (self._load or _sherpa_tts)(self.folder)
        except SpeechError:
            raise
        except Exception as exc:  # noqa: BLE001 - sherpa-onnx's own errors, told to the owner
            raise SpeechError(f"Kokoro's model couldn't be loaded ({exc}): remove Kokoro and download it again") from exc

    def unload(self) -> None:
        """Let the loaded engine go (after a read in progress); the next read loads it again."""
        with self._tts_lock:
            self._tts = None

    def state(self) -> dict:
        """{state, done, total, message}: absent, downloading (`done` bytes of `total`), ready or failed
        (`message`). `total` is the archive's size whatever the state."""
        with self._lock:
            downloading = self._state == "downloading"
            state = "downloading" if downloading else "ready" if self.installed else "failed" if self._state == "failed" else "absent"
            done = self.source.bytes if state == "ready" else self._done if state == "downloading" else 0
            return {"state": state, "done": done, "total": self.source.bytes, "message": self._message if state == "failed" else None}

    def download(self) -> None:
        """Start fetching the model, in a thread of its own, taken up from the `.part` a cancelled one
        left; nothing when it is installed or being fetched. KokoroBusy while a cancelled download is still
        stopping (at its next chunk): two would write the same `.part`."""
        with self._lock:
            if self.installed or self._state == "downloading":
                return
            if self._winding_down():
                raise KokoroBusy("Kokoro's cancelled download is still stopping: download it again in a moment")
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
            if self._state == "downloading" or self._winding_down():
                raise KokoroBusy("Kokoro is being downloaded: cancel the download first")
            self.unload()
            shutil.rmtree(self.folder, ignore_errors=True)
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


# The lexicon sherpa-onnx's own Kokoro invocation reads English with (its American one, for every Voice).
_LEXICON = "lexicon-us-en.txt"


def _threads() -> int:
    """Threads for a read: half the Mac's cores, at most 4 (more don't read faster)."""
    return max(1, min(4, (os.cpu_count() or 2) // 2))


def _sherpa_tts(folder: Path) -> KokoroTts:
    """sherpa-onnx's OfflineTts for the unpacked model in `folder`: its int8 network, the Voices' table,
    the tokens, espeak-ng's data and the English lexicon, all in the archive."""
    try:
        import sherpa_onnx
    except ImportError as exc:
        raise SpeechError("Kokoro needs sherpa-onnx, which isn't installed: run `make setup` and restart") from exc
    kokoro = sherpa_onnx.OfflineTtsKokoroModelConfig(
        model=str(next(folder.glob("*.onnx"))),
        voices=str(folder / "voices.bin"),
        tokens=str(folder / "tokens.txt"),
        data_dir=str(folder / "espeak-ng-data"),
        lexicon=str(folder / _LEXICON),
    )
    config = sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(kokoro=kokoro, num_threads=_threads()))
    if not config.validate():
        raise SpeechError("Kokoro's model folder is missing files: remove Kokoro and download it again")
    return sherpa_onnx.OfflineTts(config)


# Kokoro v1.0's English speakers by their id in the model (its voices.bin), as sherpa-onnx numbers them:
# the name's prefix is the accent (a American, b British) and the gender (f, m). Its other languages'
# speakers aren't offered: the archive's lexicons read English (and Chinese) only.
KOKORO_VOICES = {
    name: sid
    for sid, name in enumerate(
        [
            *("af_alloy", "af_aoede", "af_bella", "af_heart", "af_jessica", "af_kore"),
            *("af_nicole", "af_nova", "af_river", "af_sarah", "af_sky"),
            *("am_adam", "am_echo", "am_eric", "am_fenrir", "am_liam", "am_michael", "am_onyx", "am_puck", "am_santa"),
            *("bf_alice", "bf_emma", "bf_isabella", "bf_lily"),
            *("bm_daniel", "bm_fable", "bm_george", "bm_lewis"),
        ]
    )
}
_ACCENTS = {"a": "American", "b": "British"}
_GENDERS = {"f": "female", "m": "male"}


def _voice(name: str) -> Voice:
    """"af_heart" as the Voice list shows it: "Heart", "American · female"."""
    prefix, rest = name.split("_", 1)
    return Voice(name, rest.capitalize(), f"{_ACCENTS[prefix[0]]} · {_GENDERS[prefix[1]]}", language="en")


KOKORO_VOICE_LIST = [_voice(name) for name in KOKORO_VOICES]


class KokoroSpeech:
    """Kokoro, read on this Mac: its words never leave it. Listed in the engine picker as "On this Mac",
    its download offered beside it, and ready once its model is installed (and sherpa-onnx is). Its
    Voices are English; Speed goes to it natively, and it takes no Style."""

    id = "kokoro"
    label = "Kokoro"
    service = None
    local = True
    takes_style = False
    takes_speed = True

    def __init__(self, model: KokoroModel) -> None:
        self.model = model

    def ready(self) -> bool:
        return self.model.installed and self.model.loadable

    def load(self) -> None:
        self.model.load()

    def voices(self) -> list[Voice]:
        return KOKORO_VOICE_LIST

    def read(self, text: str, voice: str, style: str | None = None, speed: float = 1.0) -> Pcm:
        sid = KOKORO_VOICES.get(voice)
        if sid is None:
            raise SpeechError(f"Kokoro has no Voice {voice!r}")
        samples, rate = self.model.generate(text, sid, speed)
        if not len(samples):
            raise SpeechError("Kokoro gave no audio for a sentence")
        return Pcm((np.clip(samples, -1, 1) * 32767).round().astype(np.int16), rate)
