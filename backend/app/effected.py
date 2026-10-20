"""Effected copies (GLOSSARY.md, Effected copy; docs/adr/0017): the file the preview plays an item's
sound from while it has Audio Effects, which a browser can't make. It is the item's sound up to (not
including) its volume: its range, Speed, pitch, Reverse and enabled Audio Effects, from its start,
through the render's own sound chains (item_sound.sound_of, Renderer.save_sound), as a WAV of 16-bit
PCM at the Clip's sample rate. The preview plays it at 1× in the item's own time, and applies the
volume, Keyframes, fades, duck and Transition share on it in Web Audio as before.

A copy is named by a hash of everything it is made from (`copy_key`): the Source's video or the Media
Library item, the range, Speed, pitch, Reverse, length, the validated enabled stack and the sample
rate; so a volume, a fade or a move in the Clip makes no new one. A Normalize loudness entry's gain
is not in it: it follows from the rest, measured once and kept (Renderer._levelled, MEASURED_DIR),
so the render reads the same measurement as the copy. Copies are kept in the Job's
EFFECTED_DIR, made once per key: a request for one being made waits on that one ffmpeg run. After a
save, the copies no Candidate of the Job uses are removed (`sweep`), but never one made since the
save started, which a draft not saved yet may be playing. They go with the Job.

A Muted item, a Freeze frame, an image, an item with no sound, and one with no enabled effect has no
copy (NoCopy): the preview plays it as before.
"""

import hashlib
import json
import tempfile
import threading
from collections.abc import Iterable
from dataclasses import replace
from pathlib import Path

from app.candidates import Candidate
from app.config import Settings
from app.item_sound import NoSound, SoundOf, _alone, sound_of
from app.jobs import Job
from app.logos import LogoStore
from app.media import MediaStore
from app.planner import AudioEvent, RenderPlan, SegmentPlan
from app.rendering import candidate_plan
from app.styles import PresetStore

# In a Job's directory.
EFFECTED_DIR = "effected"
# Changed when what a copy holds for the same key changes, so that an older one isn't played.
_VERSION = 1


class NoCopy(ValueError):
    """The item has no Effected copy: the preview plays its own sound."""


def effected_copy(
    job: Job,
    job_dir: Path,
    candidate: Candidate,
    kind: SoundOf,
    item_id: str,
    settings: Settings,
    presets: PresetStore,
    logos: LogoStore,
    media: MediaStore,
) -> Path:
    """The Effected copy of the Candidate's item `item_id` of `kind`, in `job_dir`'s EFFECTED_DIR:
    the one there, or the one being made (waited for), or made now. NoItem (item_sound) for an item it
    hasn't; NoCopy for one with no copy."""
    alone = _unvolumed(job, candidate, kind, item_id, presets, settings, logos, media)
    path = job_dir / EFFECTED_DIR / f"{copy_key(job, alone, settings)}.wav"
    with _making_lock:
        if path.is_file():
            return path
        making = _making.get(path)
        mine = making is None
        if mine:
            making = _making[path] = _Making()
    assert making is not None
    if not mine:
        making.done.wait()
        if making.error is not None:
            raise making.error
        return path
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written aside and renamed whole, so that a copy cut short is never served nor swept as one.
        with tempfile.TemporaryDirectory(prefix=".effected-", dir=path.parent) as folder:
            part = Path(folder) / path.name
            sound_of(job, job_dir, alone, part, settings, media)
            part.replace(path)
    except BaseException as exc:
        making.error = exc
        raise
    finally:
        with _making_lock:
            del _making[path]
        making.done.set()
    return path


def copies_used(
    job: Job, candidates: Iterable[Candidate], settings: Settings, presets: PresetStore, logos: LogoStore, media: MediaStore
) -> set[str]:
    """The names of the Effected copies the Candidates' items play from."""
    used = set()
    for candidate in candidates:
        items = [
            *((SoundOf.SEGMENT, segment.id) for segment in candidate.main_track() if segment.audio_effects),
            *((SoundOf.MUSIC, clip.id) for clip in candidate.music if clip.audio_effects),
            *((SoundOf.OVERLAY, overlay.id) for overlay in candidate.overlays if overlay.audio_effects),
        ]
        plan = _planned(job, candidate, presets, settings, logos, media) if items else None
        for kind, item_id in items:
            try:
                alone = _unvolumed(job, candidate, kind, item_id, presets, settings, logos, media, plan)
            except (LookupError, ValueError):
                continue
            used.add(f"{copy_key(job, alone, settings)}.wav")
    return used


def sweep(folder: Path, used: set[str], before: float) -> list[Path]:
    """Remove the copies in `folder` not `used` that were made `before` (a time.time()), and give them."""
    removed = []
    for path in sorted(folder.glob("*.wav")) if folder.is_dir() else []:
        if path.name not in used and path.stat().st_mtime < before:
            path.unlink(missing_ok=True)
            removed.append(path)
    return removed


def copy_key(job: Job, alone: RenderPlan, settings: Settings) -> str:
    """The name of the copy of `alone`'s one sound: a hash of everything it is made from."""
    assert job.source is not None
    if alone.segments:
        [segment] = alone.segments
        item: dict = {
            "media": segment.media, "start": segment.source_start, "end": segment.source_end,
            "speed": segment.speed, "pitch": segment.pitch, "reverse": segment.reverse, "secs": segment.end - segment.start,
        }
        stack = segment.audio_effects
    else:
        [event] = alone.audio
        item = {
            "media": event.media, "offset": event.offset, "speed": event.speed, "pitch": event.pitch, "reverse": event.reverse,
            "secs": event.end - event.start,
        }
        stack = event.audio_effects
    made = {
        "version": _VERSION,
        "rate": settings.render.audio_rate,
        # The Source never changes under its Job, nor an item under its id.
        "source": job.source.video if item["media"] is None else None,
        **item,
        "effects": [[effect.id, sorted(effect.params.items())] for effect in stack],
    }
    return hashlib.sha256(json.dumps(made, sort_keys=True).encode()).hexdigest()[:32]


def _unvolumed(
    job: Job,
    candidate: Candidate,
    kind: SoundOf,
    item_id: str,
    presets: PresetStore,
    settings: Settings,
    logos: LogoStore,
    media: MediaStore,
    plan: RenderPlan | None = None,
) -> RenderPlan:
    """The plan of the item's sound alone (`_alone`) in the Candidate's `plan` (planned now when
    None), before its volume: at 1, unkeyed, unfaded, and a sound of the Source's not scaled by the
    Clip's own volume. NoCopy for an item without one."""
    if _muted(candidate, kind, item_id):
        raise NoCopy(f"{kind.value} {item_id} is Muted")
    plan = plan or _planned(job, candidate, presets, settings, logos, media)
    try:
        alone, _ = _alone(plan, candidate, kind, item_id, media)
    except NoSound as exc:
        raise NoCopy(str(exc)) from None
    if alone.segments and alone.segments[0].audio_effects:
        segment: SegmentPlan = alone.segments[0]
        return replace(alone, source_volume=1.0, segments=[replace(segment, volume=1.0, gain=[], fade_in=0.0, fade_out=0.0)])
    if alone.audio and alone.audio[0].audio_effects:
        event: AudioEvent = alone.audio[0]
        return replace(alone, source_volume=1.0, audio=[replace(event, volume=1.0, gain=[], fade_in=0.0, fade_out=0.0)])
    raise NoCopy(f"{kind.value} {item_id} has no Audio Effects switched on")


def _planned(job: Job, candidate: Candidate, presets: PresetStore, settings: Settings, logos: LogoStore, media: MediaStore) -> RenderPlan:
    """The Candidate's plan as a render plans it, uncaptioned and unframed: its sounds are all a copy needs."""
    assert job.source is not None
    return candidate_plan(candidate, job.source.metadata, None, [None] * len(candidate.main_track()), presets, settings.camera, logos, media)


def _muted(candidate: Candidate, kind: SoundOf, item_id: str) -> bool:
    items = {SoundOf.SEGMENT: candidate.main_track(), SoundOf.MUSIC: candidate.music, SoundOf.OVERLAY: candidate.overlays}[kind]
    return any(item.id == item_id and item.muted for item in items)


class _Making:
    """A copy being made: done once it is there, or with the `error` that stopped it."""

    def __init__(self) -> None:
        self.done = threading.Event()
        self.error: BaseException | None = None


_making: dict[Path, _Making] = {}
_making_lock = threading.Lock()
