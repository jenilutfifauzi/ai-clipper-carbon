"""The Narration runner (GLOSSARY.md, Narration; docs/adr/0019): typed words read aloud by a Voice into
a Media Library item.

A module of its own, not the Job Worker: it makes one Narration at a time for the whole app, in a
thread of its own, and refuses a second while one runs (NarrationBusy). The script is split into
sentences, each read alone by the engine (app/voices.py) at the Speed asked, natively by an engine that
takes one, else read at 1× and retimed with `atempo`, its pitch kept, as a Music Clip's Speed is (each
sentence alone, so that the pauses keep their length); they are resampled to 48 kHz mono, joined
with the pause's silence (none before the first or after the last), levelled to a fixed loudness for
speech with loudnorm's two passes, and the WAV is added through the Media Library's normal add, named
"Narration <voice> <date time>". What the runner made of a Narration is told as events: `progress`
(the stage, and sentences read out of sentences), then `done` with the item, `failed` with the message
or `cancelled`; its work folder goes whichever. A cloud engine's passing failure (TransientSpeechError:
a 429, a 5xx, the network) on a sentence is read again once, after the service's Retry-After or
RETRY_WAIT_SECS (a Retry-After is capped at 30 s). The engine is loaded under "Loading the voice" (a
cloud one has nothing to load). A cancel is heard between sentences, and before levelling and saving.

A Voice's sample is a fixed sentence or two in the Job's language (SAMPLE_TEXTS; English for a language
with none) read at 1× with no Style and levelled as a Narration is, so it sounds like the result. It is
made through the same one-at-a-time lock (NarrationBusy while a Narration or another sample is being
made) and kept in `samples_dir` per engine, Voice and language, served from there afterwards without
the engine.
"""

import asyncio
import hashlib
import json
import math
import re
import shutil
import subprocess
import threading
import wave
from collections.abc import AsyncIterator, Callable, Iterator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi.sse import ServerSentEvent

from app.media import MediaItem, MediaStore
from app.renderer import last_lines, speed_filters
from app.voices import Cancelled, Pcm, SpeechError, TransientSpeechError, Voice, VoiceEngine, primary_language

# In DATA_DIR: a folder per Narration being made; and the Voice samples kept, a folder per engine.
NARRATIONS_DIR = "narrations"
VOICE_SAMPLES_DIR = "voice-samples"
# What a Voice's sample reads, per language; a language with none is read the English one.
SAMPLE_TEXTS = {
    "id": "Halo, ini suara saya. Beginilah narasi Anda akan terdengar.",
    "en": "Hi, this is my voice. This is how your narration will sound.",
}
SAMPLE_FALLBACK = "en"
# The longest script, in characters once trimmed: a runaway paste doesn't run for minutes or burn quota.
MAX_CHARS = 5_000
# The silence between two sentences, in seconds: the pause slider's None (0) to Longer.
DEFAULT_PAUSE_SECS = 0.3
MAX_PAUSE_SECS = 1.5
# The Speed a Narration is read at: 0.5–2×.
MIN_SPEED, MAX_SPEED, DEFAULT_SPEED = 0.5, 2.0, 1.0
# Every Voice comes out at this loudness: a fixed target for speech (integrated LUFS, true peak dBTP).
LUFS = -16.0
TRUE_PEAK_DB = -1.5
LOUDNESS_RANGE = 11.0
RATE = 48_000
# How many finished Narrations are remembered, for a stream opened late.
_KEPT = 20
# The wait before a sentence's one retry when the service didn't say how long (Retry-After).
RETRY_WAIT_SECS = 2.0
# The stages progress tells, in order.
LOADING, READING, LEVELLING, SAVING = "Loading the voice", "Reading", "Levelling", "Saving"
# The events that end a Narration's stream.
_ENDS = ("done", "failed", "cancelled")

# A sentence ends at . ! ? or … (a run of them, as "?!" or "..."), followed by a space, or at a line's
# end. A mark inside a word or number ("3.5", "example.com") doesn't end one.
_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


class NarrationRefused(ValueError):
    """The request can't be narrated: its script, engine, Voice, Speed or Style."""


class NarrationBusy(RuntimeError):
    """Another Narration is being made."""


class NarrationNotFound(LookupError):
    pass


class NarrationFinished(RuntimeError):
    """The Narration has ended already: there is nothing to cancel."""


@dataclass(frozen=True)
class NarrationRequest:
    text: str
    engine: str
    voice: str
    pauses: float = DEFAULT_PAUSE_SECS
    style: str | None = None
    speed: float = DEFAULT_SPEED


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
    # Set by a cancel; the reading stops at the next sentence.
    cancelled: threading.Event = field(default_factory=threading.Event)

    @property
    def finished(self) -> bool:
        return bool(self.sent) and self.sent[-1][0] in _ENDS


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
        samples_dir: Path | None = None,
    ) -> None:
        self.media = media
        self.engines = list(engines)
        self.ffmpeg = ffmpeg
        self.work_dir = work_dir
        self.samples_dir = samples_dir or work_dir.parent / VOICE_SAMPLES_DIR
        self._now = now
        self._busy = threading.Lock()
        self._lock = threading.Lock()
        self._narrations: dict[str, _Narration] = {}

    def engine(self, engine_id: str) -> VoiceEngine | None:
        return next((engine for engine in self.engines if engine.id == engine_id), None)

    def _ready_voice(self, engine_id: str, voice_id: str) -> tuple[VoiceEngine, Voice]:
        engine = self.engine(engine_id)
        if engine is None:
            raise NarrationRefused(f"No speech engine {engine_id!r} is set up")
        voice = next((voice for voice in engine.voices() if voice.id == voice_id), None)
        if voice is None:
            raise NarrationRefused(f"{engine.label} has no Voice {voice_id!r}")
        if not engine.ready():
            raise NarrationRefused(f"{engine.label} isn't ready")
        return engine, voice

    def sample(self, engine_id: str, voice_id: str, language: str | None) -> Path:
        """The WAV of the Voice reading SAMPLE_TEXTS in `language` (its first part: "pt-BR" is "pt"),
        made the first time and kept. NarrationRefused for an unknown engine or Voice or an engine that
        isn't ready; NarrationBusy while a Narration or another sample is being made; SpeechError when
        the engine fails."""
        engine, voice = self._ready_voice(engine_id, voice_id)
        lang = primary_language(language)
        lang = lang if lang in SAMPLE_TEXTS else SAMPLE_FALLBACK
        kept = self.samples_dir / _safe(engine.id) / f"{_safe(voice.id)}.{lang}.wav"
        if kept.is_file():
            return kept
        if not self._busy.acquire(blocking=False):
            raise NarrationBusy("A Narration is being made: play the sample once it is done")
        folder = self.work_dir / f"sample-{uuid4().hex}"
        try:
            if kept.is_file():  # made by the request that held the lock just before
                return kept
            folder.mkdir(parents=True, exist_ok=True)
            read = sentences(SAMPLE_TEXTS[lang])
            parts, lengths = self._read_all(threading.Event(), engine, read, voice.id, None, DEFAULT_SPEED, folder)
            made = self._join(parts, lengths, DEFAULT_PAUSE_SECS, DEFAULT_SPEED, folder / "sample.wav")
            kept.parent.mkdir(parents=True, exist_ok=True)
            made.replace(kept)
            return kept
        finally:
            shutil.rmtree(folder, ignore_errors=True)
            self._busy.release()

    @contextmanager
    def idle(self, busy: str) -> Iterator[None]:
        """Hold the runner while the body runs, so that no Narration or sample starts meanwhile:
        NarrationBusy, saying `busy`, while one is being made (as removing Kokoro's model is refused)."""
        if not self._busy.acquire(blocking=False):
            raise NarrationBusy(busy)
        try:
            yield
        finally:
            self._busy.release()

    def forget_samples(self, engine_id: str) -> None:
        """Delete the samples kept of the engine's Voices (its model removed: they'd sound of nothing here)."""
        shutil.rmtree(self.samples_dir / _safe(engine_id), ignore_errors=True)

    def start(self, request: NarrationRequest) -> str:
        """Start making a Narration; its id. NarrationRefused for an empty or too long script, an unknown
        engine or Voice, an engine that isn't ready, a Speed outside 0.5–2, or a Style for an engine that
        takes none (a blank one is none); NarrationBusy while another is being made."""
        text = request.text.strip()
        if not text:
            raise NarrationRefused("Type a script to narrate")
        if len(text) > MAX_CHARS:
            raise NarrationRefused(f"A script can be {MAX_CHARS:,} characters at most; this one has {len(text):,}")
        engine, voice = self._ready_voice(request.engine, request.voice)
        if not MIN_SPEED <= request.speed <= MAX_SPEED:
            raise NarrationRefused(f"The Speed can be {MIN_SPEED:g}–{MAX_SPEED:g}×; this one is {request.speed:g}×")
        style = (request.style or "").strip() or None
        if style and not engine.takes_style:
            raise NarrationRefused(f"{engine.label} takes no Style")
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
        args = (narration, engine, voice, read, request.pauses, style, request.speed)
        try:
            threading.Thread(target=self._run, args=args, name=f"narration-{narration.id}", daemon=True).start()
        except BaseException:
            with self._lock:
                self._narrations.pop(narration.id, None)
            self._busy.release()
            raise
        return narration.id

    async def events(self, narration_id: str) -> AsyncIterator[ServerSentEvent]:
        """The Narration's events, those sent already and then as they come, until `done`, `failed` or
        `cancelled`."""
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
                if name in _ENDS:
                    return
        finally:
            with self._lock:
                narration.listeners.remove(heard)

    def cancel(self, narration_id: str) -> None:
        """Stop the Narration at its next sentence and discard it. NarrationNotFound for an unknown one,
        NarrationFinished for one that has ended."""
        with self._lock:
            narration = self._narrations.get(narration_id)
            if narration is None:
                raise NarrationNotFound(narration_id)
            if narration.finished:
                raise NarrationFinished(f"The Narration has {'been made' if narration.sent[-1][0] == 'done' else 'ended'} already")
            narration.cancelled.set()

    def exists(self, narration_id: str) -> bool:
        with self._lock:
            return narration_id in self._narrations

    def _send(self, narration: _Narration, name: str, data: Any) -> None:
        with self._lock:
            narration.sent.append((name, data))
            listeners = list(narration.listeners)
        for listener in listeners:
            listener((name, data))

    def _run(
        self, narration: _Narration, engine: VoiceEngine, voice: Voice, read: list[str], pauses: float, style: str | None, speed: float
    ) -> None:
        folder = self.work_dir / narration.id

        def stage(name: str, done: int) -> None:
            if narration.cancelled.is_set():
                raise Cancelled
            self._send(narration, "progress", {"stage": name, "done": done, "of": len(read)})

        # The end is sent once the Narration's slot is free again, so that whoever sees it can start the next.
        ending: tuple[str, Any] = ("cancelled", {})
        try:
            folder.mkdir(parents=True, exist_ok=True)
            stage(LOADING, 0)
            engine.load()
            stage(READING, 0)
            parts, lengths = self._read_all(
                narration.cancelled, engine, read, voice.id, style, speed, folder, lambda done: stage(READING, done)
            )
            stage(LEVELLING, len(read))
            narrated = self._join(parts, lengths, pauses, speed / native_speed(engine, speed), folder / "narration.wav")
            stage(SAVING, len(read))
            name = f"Narration {voice.name} {self._now().strftime('%Y-%m-%d %H.%M.%S')}.wav"
            with narrated.open("rb") as file:
                item = self.media.add(file, name)
        except Cancelled:
            ending = ("cancelled", {})
        except SpeechError as exc:
            ending = ("failed", {"message": str(exc)})
        except Exception as exc:  # noqa: BLE001 - told to the owner, not lost in a thread
            ending = ("failed", {"message": f"The Narration couldn't be made: {exc}"})
        else:
            ending = ("done", item)
        finally:
            shutil.rmtree(folder, ignore_errors=True)
            self._busy.release()
        self._send(narration, *ending)

    def _read_all(
        self,
        cancelled: threading.Event,
        engine: VoiceEngine,
        read: list[str],
        voice: str,
        style: str | None,
        speed: float,
        folder: Path,
        each: Callable[[int], None] = lambda done: None,
    ) -> tuple[list[Path], list[float]]:
        """Each sentence of `read` read alone into a WAV of `folder`, `each` told how many are read after
        each: the WAVs and their lengths in seconds."""
        parts, lengths = [], []
        for i, sentence in enumerate(read):
            pcm = self._read(cancelled, engine, sentence, voice, style, speed)
            parts.append(_write_wav(folder / f"{i}.wav", pcm))
            lengths.append(pcm.secs)
            each(i + 1)
        return parts, lengths

    def _read(self, cancelled: threading.Event, engine: VoiceEngine, sentence: str, voice: str, style: str | None, speed: float) -> Pcm:
        """The sentence read (at what of `speed` an engine that takes one reads), once more after a passing
        failure: after its Retry-After (at most MAX_RETRY_AFTER_SECS, app/voices.py), or RETRY_WAIT_SECS,
        unless a cancel comes meanwhile."""

        def read() -> Pcm:
            return engine.read(sentence, voice, style, native_speed(engine, speed)) if engine.takes_speed else engine.read(sentence, voice, style)

        try:
            return read()
        except TransientSpeechError as exc:
            wait = RETRY_WAIT_SECS if exc.retry_after is None else exc.retry_after
            if cancelled.wait(wait):
                raise Cancelled from None
            return read()

    def _join(self, parts: list[Path], lengths: list[float], pauses: float, speed: float, out: Path) -> Path:
        """The sentences (`lengths` seconds long) at 48 kHz mono, each retimed to `speed` with its pitch
        kept and padded or cut to its length at it (`atempo` drops a little of a sound's end), joined
        with `pauses` seconds of silence and levelled to LUFS."""
        inputs = [arg for part in parts for arg in ("-i", str(part))]
        tempo = "".join(f",{stage}" for stage in speed_filters(speed, False, RATE))
        last = len(parts) - 1
        graph = ""
        for i, secs in enumerate(lengths):
            whole = secs / speed + (pauses if i < last else 0)
            graph += (
                f"[{i}:a]aresample={RATE},aformat=sample_fmts=fltp:channel_layouts=mono{tempo}"
                f",apad=whole_dur={whole:.6f},atrim=duration={whole:.6f}[s{i}];"
            )
        joined = f"{graph}{''.join(f'[s{i}]' for i in range(len(parts)))}concat=n={len(parts)}:v=0:a=1"
        target = f"loudnorm=I={LUFS}:TP={TRUE_PEAK_DB}:LRA={LOUDNESS_RANGE}"
        base = [str(self.ffmpeg), "-hide_banner", "-nostdin", "-nostats", *inputs]
        measured = _ffmpeg([*base, "-v", "info", "-filter_complex", f"{joined},{target}:print_format=json", "-f", "null", "-"])
        loudness = json.loads(measured[measured.rindex("{") : measured.rindex("}") + 1])
        level = (
            f"{target}:measured_I={loudness['input_i']}:measured_TP={loudness['input_tp']}"
            f":measured_LRA={loudness['input_lra']}:measured_thresh={loudness['input_thresh']}"
            f":offset={loudness['target_offset']}:linear=true,aresample={RATE}"
            if math.isfinite(float(loudness["input_i"]))
            else "anull"
        )
        _ffmpeg([*base, "-v", "error", "-y", "-filter_complex", f"{joined},{level}", "-ac", "1", "-c:a", "pcm_s16le", str(out)])
        return out


def native_speed(engine: VoiceEngine, speed: float) -> float:
    """What of `speed` the engine reads itself: the nearest in its speed_range, 1 for one that takes no
    Speed. The runner retimes the rest (speed / it)."""
    if not engine.takes_speed:
        return 1.0
    low, high = engine.speed_range
    return min(max(speed, low), high)


def _safe(name: str) -> str:
    """`name` as a file name: kept when it is plain letters, digits, - and _, else made so and told apart
    from another made the same by a short hash of it."""
    plain = re.sub(r"[^A-Za-z0-9_-]", "_", name)
    return plain if plain == name and name else f"{plain}-{hashlib.sha256(name.encode()).hexdigest()[:8]}"


def _write_wav(path: Path, pcm: Pcm) -> Path:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(pcm.rate)
        wav.writeframes(pcm.samples.astype("<i2").tobytes())
    return path


def _ffmpeg(command: list[str]) -> str:
    result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    if result.returncode:
        raise RuntimeError(f"ffmpeg couldn't join the sentences: {last_lines(result.stderr)}")
    return result.stderr
