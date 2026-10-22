"""Kokoro on this Mac (GLOSSARY.md, Voice; docs/adr/0019): its model, downloaded on first use into
`DATA_DIR/models`, and the engine that will read with it.

The model is sherpa-onnx's Kokoro int8 multi-language v1.0 archive, its URL, size and SHA-256 pinned
here (KOKORO_URL), fetched as every downloaded model is (app/model_download.py). The archive is unpacked
into a staging folder and renamed into place, so that a torn unpack never looks installed, and an
archive with a member whose path or link leads out of its folder installs nothing.

KokoroSpeech reads with it through sherpa-onnx's OfflineTts, its English Voices only (American and
British, each a speaker id of the model's), Speed sent to it natively, no Style. The engine is loaded by
`load` (the Narration's "Loading the voice" stage), else on the first read, and kept by KokoroModel until the model is removed, which unloads it. sherpa-onnx is
imported only then: without it the app still starts, and Kokoro isn't ready.
"""

import importlib.util
import os
import shutil
import tarfile
import threading
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from typing import Any, Protocol

import httpx
import numpy as np

from app.model_download import ModelBusy, ModelDownload, ModelSource, Refused
from app.voices import Pcm, SpeechError, Voice

# sherpa-onnx's Kokoro v1.0 multi-language, int8 (its `tts-models` release), as Concat pins it
# (docs/referensi/concat/models/manifest.toml, its upstream): the folder the archive unpacks to.
KOKORO_FOLDER = "kokoro-int8-multi-lang-v1_0"
KOKORO_URL = f"https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/{KOKORO_FOLDER}.tar.bz2"
KOKORO_SHA256 = "4c3052abaa60943a341f193888cf6abd68787dae6ab8ae5c925a706caa247e4e"
KOKORO_BYTES = 132_303_094
# Kokoro's source, as every downloaded model's.
KokoroSource = ModelSource
PINNED = KokoroSource(KOKORO_URL, KOKORO_SHA256, KOKORO_BYTES)


class KokoroTts(Protocol):
    """Kokoro's loaded engine, as sherpa-onnx's OfflineTts is: one read is float samples at its rate."""

    sample_rate: int

    def generate(self, text: str, sid: int = 0, speed: float = 1.0) -> Any: ...


# What loads Kokoro's engine from the model's folder (sherpa-onnx's, unless a test fakes it).
KokoroLoader = Callable[[Path], KokoroTts]


class KokoroBusy(ModelBusy):
    """Kokoro's model is being downloaded, or a cancelled download is still stopping: it can't be
    removed, nor downloaded again, meanwhile."""


class KokoroModel(ModelDownload):
    """Kokoro's model in `models_dir` (its folder, KOKORO_FOLDER), fetched from `source`, and its engine
    once loaded, by `load` (sherpa-onnx's unless a test fakes it)."""

    name = "Kokoro"
    busy = KokoroBusy

    def __init__(
        self, models_dir: Path, source: KokoroSource = PINNED, http_client: httpx.Client | None = None, load: KokoroLoader | None = None
    ) -> None:
        self.folder = models_dir / KOKORO_FOLDER
        self.staging = models_dir / f".{KOKORO_FOLDER}.staging"
        super().__init__(models_dir, source, models_dir / f"{KOKORO_FOLDER}.tar.bz2.part", http_client)
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

    def _delete(self) -> None:
        """The engine unloaded and the model's folder deleted."""
        self.unload()
        shutil.rmtree(self.folder, ignore_errors=True)

    def _cleanup(self) -> None:
        shutil.rmtree(self.staging, ignore_errors=True)

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
                        raise Refused(f"Kokoro's archive has a file outside its folder ({member.name}), so nothing was installed")
                archive.extractall(self.staging, members=members, filter="data")
        except tarfile.TarError as exc:
            raise Refused(f"Kokoro's archive couldn't be unpacked ({exc}), so it was deleted: Download it again") from exc
        unpacked = self.staging / KOKORO_FOLDER
        if not unpacked.is_dir() or not any(unpacked.glob("*.onnx")):
            raise Refused("Kokoro's archive had no Kokoro model in it, so nothing was installed")
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
