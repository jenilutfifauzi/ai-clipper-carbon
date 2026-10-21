"""The Narration runner (GLOSSARY.md, Narration; docs/adr/0019): typed words read aloud by a Voice into
a Media Library item.

A module of its own, not the Job Worker: it makes one Narration at a time for the whole app, in a
thread of its own, and refuses a second while one runs (NarrationBusy). The script is split into
sentences, each read alone by the engine (app/voices.py); they are resampled to 48 kHz mono, joined
with the pause's silence (none before the first or after the last), levelled to a fixed loudness for
speech with loudnorm's two passes, and the WAV is added through the Media Library's normal add, named
"Narration <voice> <date time>". What the runner made of a Narration is told as events, the last
`done` with the item or `failed` with the message; its work folder goes either way.
"""

import asyncio
import json
import math
import re
import shutil
import subprocess
import threading
import wave
from collections.abc import AsyncIterator, Callable, Sequence
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.sse import ServerSentEvent

from app.media import MediaItem, MediaStore
from app.renderer import last_lines
from app.voices import Pcm, SpeechError, Voice, VoiceEngine

# In DATA_DIR: a folder per Narration being made.
NARRATIONS_DIR = "narrations"
# The longest script, in characters once trimmed: a runaway paste doesn't run for minutes or burn quota.
MAX_CHARS = 5_000
# The silence between two sentences, in seconds: the pause slider's None (0) to Longer.
DEFAULT_PAUSE_SECS = 0.3
MAX_PAUSE_SECS = 1.5
# Every Voice comes out at this loudness: a fixed target for speech (integrated LUFS, true peak dBTP).
LUFS = -16.0
TRUE_PEAK_DB = -1.5
LOUDNESS_RANGE = 11.0
RATE = 48_000
# How many finished Narrations are remembered, for a stream opened late.
_KEPT = 20

# A sentence ends at . ! ? or … (a run of them, as "?!" or "..."), followed by a space, or at a line's
# end. A mark inside a word or number ("3.5", "example.com") doesn't end one.
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


class NarrationRefused(ValueError):
    """The request can't be narrated: its script, engine or Voice."""


class NarrationBusy(RuntimeError):
    """Another Narration is being made."""


class NarrationNotFound(LookupError):
    pass


@dataclass(frozen=True)
class NarrationRequest:
    text: str
    engine: str
    voice: str
    pauses: float = DEFAULT_PAUSE_SECS
    style: str | None = None


def sentences(text: str) -> list[str]:
    """The script's sentences, each with its mark: split at . ! ? … and newlines, a run of blank lines
    one break, and a sentence with no letter or digit dropped."""
    found = (part.strip() for line in text.splitlines() for part in _SENTENCE_END.split(line))
    return [sentence for sentence in found if any(char.isalnum() for char in sentence)]


@dataclass
class _Narration:
    id: str
    # Every event sent so far, in order: (name, data).
    sent: list[tuple[str, Any]] = field(default_factory=list)
    listeners: list[Callable[[tuple[str, Any]], None]] = field(default_factory=list)

    @property
    def finished(self) -> bool:
        return bool(self.sent) and self.sent[-1][0] in ("done", "failed")


class NarrationRunner:
    """One Narration at a time for the app, read by `engines`, added to `media`; each made in a folder
    of `work_dir`, removed once it is done or failed."""

    def __init__(
        self,
        media: MediaStore,
        engines: Sequence[VoiceEngine],
        ffmpeg: Path,
        work_dir: Path,
        now: Callable[[], datetime] = datetime.now,
    ) -> None:
        self.media = media
        self.engines = list(engines)
        self.ffmpeg = ffmpeg
        self.work_dir = work_dir
        self._now = now
        self._busy = threading.Lock()
        self._lock = threading.Lock()
        self._narrations: dict[str, _Narration] = {}

    def engine(self, engine_id: str) -> VoiceEngine | None:
        return next((engine for engine in self.engines if engine.id == engine_id), None)

    def start(self, request: NarrationRequest) -> str:
        """Start making a Narration; its id. NarrationRefused for an empty or too long script, an unknown
        engine or Voice, or an engine that isn't ready; NarrationBusy while another is being made."""
        text = request.text.strip()
        if not text:
            raise NarrationRefused("Type a script to narrate")
        if len(text) > MAX_CHARS:
            raise NarrationRefused(f"A script can be {MAX_CHARS:,} characters at most; this one has {len(text):,}")
        engine = self.engine(request.engine)
        if engine is None:
            raise NarrationRefused(f"No speech engine {request.engine!r} is set up")
        voice = next((voice for voice in engine.voices() if voice.id == request.voice), None)
        if voice is None:
            raise NarrationRefused(f"{engine.label} has no Voice {request.voice!r}")
        if not engine.ready():
            raise NarrationRefused(f"{engine.label} isn't ready")
        read = sentences(text)
        if not read:
            raise NarrationRefused("The script has no words to read")
        if not self._busy.acquire(blocking=False):
            raise NarrationBusy("Another Narration is being made: wait for it to finish")
        narration = _Narration(uuid4().hex)
        with self._lock:
            self._narrations[narration.id] = narration
            for old in [n for n in self._narrations.values() if n.finished][:-_KEPT]:
                del self._narrations[old.id]
        args = (narration, engine, voice, read, request.pauses, request.style)
        threading.Thread(target=self._run, args=args, name=f"narration-{narration.id}", daemon=True).start()
        return narration.id

    async def events(self, narration_id: str) -> AsyncIterator[ServerSentEvent]:
        """The Narration's events, those sent already and then as they come, until `done` or `failed`."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue[tuple[str, Any]] = asyncio.Queue()

        def heard(event: tuple[str, Any]) -> None:
            with suppress(RuntimeError):  # the event loop has closed: the app is stopping
                loop.call_soon_threadsafe(queue.put_nowait, event)

        with self._lock:
            narration = self._narrations.get(narration_id)
            if narration is None:
                raise NarrationNotFound(narration_id)
            for event in narration.sent:
                queue.put_nowait(event)
            narration.listeners.append(heard)
        try:
            while True:
                name, data = await queue.get()
                yield ServerSentEvent(event=name, data=data)
                if name in ("done", "failed"):
                    return
        finally:
            with self._lock:
                narration.listeners.remove(heard)

    def exists(self, narration_id: str) -> bool:
        with self._lock:
            return narration_id in self._narrations

    def _send(self, narration: _Narration, name: str, data: Any) -> None:
        with self._lock:
            narration.sent.append((name, data))
            listeners = list(narration.listeners)
        for listener in listeners:
            listener((name, data))

    def _run(self, narration: _Narration, engine: VoiceEngine, voice: Voice, read: list[str], pauses: float, style: str | None) -> None:
        folder = self.work_dir / narration.id
        try:
            folder.mkdir(parents=True, exist_ok=True)
            parts = []
            for i, sentence in enumerate(read):
                parts.append(_write_wav(folder / f"{i}.wav", engine.read(sentence, voice.id, style)))
            narrated = self._join(parts, pauses, folder / "narration.wav")
            name = f"Narration {voice.name} {self._now().strftime('%Y-%m-%d %H.%M.%S')}.wav"
            with narrated.open("rb") as file:
                item = self.media.add(file, name)
        except SpeechError as exc:
            self._send(narration, "failed", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001 - told to the owner, not lost in a thread
            self._send(narration, "failed", {"message": f"The Narration couldn't be made: {exc}"})
        else:
            self._send(narration, "done", item)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
            self._busy.release()

    def _join(self, parts: list[Path], pauses: float, out: Path) -> Path:
        """The sentences at 48 kHz mono, joined with `pauses` seconds of silence and levelled to LUFS."""
        inputs = [arg for part in parts for arg in ("-i", str(part))]
        pad = f",apad=pad_dur={pauses:.3f}" if pauses > 0 else ""
        graph = "".join(
            f"[{i}:a]aresample={RATE},aformat=sample_fmts=fltp:channel_layouts=mono{pad if i < len(parts) - 1 else ''}[s{i}];"
            for i in range(len(parts))
        )
        joined = f"{graph}{''.join(f'[s{i}]' for i in range(len(parts)))}concat=n={len(parts)}:v=0:a=1"
        target = f"loudnorm=I={LUFS}:TP={TRUE_PEAK_DB}:LRA={LOUDNESS_RANGE}"
        base = [str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", *inputs]
        measured = _run([*base, "-v", "info", "-filter_complex", f"{joined},{target}:print_format=json", "-f", "null", "-"])
        loudness = json.loads(measured[measured.rindex("{") : measured.rindex("}") + 1])
        level = (
            f"{target}:measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}"
            f":measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}"
            f":offset={loudness['target_offset']}:linear=true,aresample={RATE}"
            if math.isfinite(float(loudness["input_i"]))
            else "anull"
        )
        _run([*base, "-v", "error", "-y", "-filter_complex", f"{joined},{level}", "-ac", "1", "-c:a", "pcm_s16le", str(out)])
        return out


def _write_wav(path: Path, pcm: Pcm) -> Path:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(pcm.rate)
        wav.writeframes(pcm.samples.astype("<i2").tobytes())
    return path


def _run(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't join the sentences: {last_lines(result.stderr)}")
    return result.stderr
