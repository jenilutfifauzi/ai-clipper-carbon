"""Save sound as WAV (.scratch/audio-mixing/spec.md): the sound of one item of a Candidate (a
Segment, a Music Clip or a video Overlay) alone, as it is heard in the Clip, for the owner to take
to another app.

The Candidate (or a draft of its edits, as the Preview Plan takes it) is planned as a render plans
it (rendering.candidate_plan); the item's sound is then kept alone, from 0, and the Renderer makes
it with the render's own sound chains (Renderer.save_sound): its range, Speed, pitch and Reverse,
volume or Keyframes, fades, and the Clip's own volume for the Source's sound. Muted is left out, as
are the Track mute (the editor's alone) and the loudness passes, which are the whole Clip's.
"""

from dataclasses import replace
from enum import StrEnum
from pathlib import Path

from app.candidates import Candidate
from app.config import Settings
from app.jobs import Job
from app.logos import LogoStore
from app.media import MediaStore
from app.planner import AudioEvent, RenderPlan, SegmentPlan
from app.renderer import Renderer
from app.rendering import candidate_plan, source_copies
from app.retimed import CopySize, Retime, read_from_copies
from app.styles import PresetStore


class SoundOf(StrEnum):
    """The kind of item whose sound is saved."""

    SEGMENT = "segment"
    MUSIC = "music"
    OVERLAY = "overlay"


class NoItem(LookupError):
    """The Candidate (or its draft) has no such item."""


class NoSound(ValueError):
    """The item has no sound to save."""


def save_item_sound(
    job: Job,
    job_dir: Path,
    candidate: Candidate,
    kind: SoundOf,
    item_id: str,
    wav: Path,
    settings: Settings,
    presets: PresetStore,
    logos: LogoStore,
    media: MediaStore,
) -> str:
    """Write the sound of the Candidate's item `item_id` of `kind` to `wav` (Renderer.save_sound),
    `job_dir` being its Job's directory, and give the file name to save it under. A reversed item
    reads its full-size Retimed copy, made now if it isn't there, as a render's does. NoItem for an
    item it hasn't; NoSound for a Freeze frame, an image, or an item with no sound to hear."""
    assert job.source is not None
    segments = candidate.main_track()
    plan = candidate_plan(candidate, job.source.metadata, None, [None] * len(segments), presets, settings.camera, logos, media)
    alone, what = _alone(plan, candidate, kind, item_id, media)
    files = {item: media.file(item) for item in {*(event.media for event in alone.audio), *(segment.media for segment in alone.segments)} if item}
    alone, files = read_from_copies(alone, files, lambda media_id, played: (
        media.retimed(media_id) if media_id is not None else source_copies(job_dir, job.source)
    ).make(settings.ffmpeg_bin, CopySize.FULL, Retime(played.start, played.end)))
    Renderer(settings.ffmpeg_bin, settings.render).save_sound(job_dir / job.source.video, alone, wav, files)
    return f"{_file_name(candidate.title) or f'clip-{candidate.id}'} - {_file_name(what)}.wav"


def _alone(plan: RenderPlan, candidate: Candidate, kind: SoundOf, item_id: str, media: MediaStore) -> tuple[RenderPlan, str]:
    """`plan` with only the item's sound, unmuted, from 0 s; and what to call it."""
    bare = replace(plan, segments=[], audio=[], transitions=[])
    if kind is SoundOf.SEGMENT:
        segments = candidate.main_track()
        number = next((i for i, segment in enumerate(segments, 1) if segment.id == item_id), None)
        if number is None:
            raise NoItem(f"no Segment {item_id}")
        name = f"Segment {number}"
        if segments[number - 1].hold is not None:
            raise NoSound(f"{name} is a Freeze frame, which is silent")
        if not plan.segments:
            # A Clip not cut: its range is its one Segment.
            return replace(plan, audio=[], transitions=[]), name
        planned = next((segment for segment in plan.segments if segment.id == item_id), None)
        if planned is None or planned.silent:
            raise NoSound(f"{name}'s video has no sound")
        return replace(bare, segments=[_from_start(planned)]), name
    if kind is SoundOf.MUSIC:
        clip = next((clip for clip in candidate.music if clip.id == item_id), None)
        if clip is None:
            raise NoItem(f"no Music Clip {item_id}")
        item = media.find(clip.media) if clip.media is not None else None
        name = "The episode's sound" if clip.media is None else (item.name if item else "Music Clip")
        if clip.media is not None and (item is None or not item.has_audio):
            raise NoSound(f"Music Clip {item_id} has no sound: its song or video is gone or silent")
        # The Music Clips come first in the plan's audio, then the Overlays' sound.
        heard = (event for event in plan.audio if event.id == item_id and event.media == clip.media)
    else:
        overlay = next((overlay for overlay in candidate.overlays if overlay.id == item_id), None)
        if overlay is None:
            raise NoItem(f"no Overlay {item_id}")
        item = media.find(overlay.media)
        name = f"Overlay {item.name if item else item_id}"
        if item is not None and item.duration is None:
            raise NoSound(f"Overlay {item_id} is an image, which has no sound")
        if item is not None and not item.has_audio:
            raise NoSound(f"Overlay {item_id}'s video has no sound")
        heard = (event for event in reversed(plan.audio) if event.id == item_id and event.media == overlay.media)
    event = next(heard, None)
    if event is None:
        raise NoSound(f"{name} has no sound in the Clip: it is at volume 0, or isn't heard before the Clip ends")
    return replace(bare, audio=[_from_start(event)]), name


def _from_start[T: (SegmentPlan, AudioEvent)](item: T) -> T:
    """The item's sound heard alone: from 0 s, its Keyframes and fades being from its start, not
    Muted, and not ducked (Ducking is left out, docs/adr/0016)."""
    alone = replace(item, start=0.0, end=round(item.end - item.start, 3), muted=False)
    return replace(alone, duck=None, speech_spans=[], ducked=[]) if isinstance(alone, AudioEvent) else alone


def _file_name(text: str) -> str:
    """`text` as part of a file name: without the characters file systems refuse."""
    return " ".join("".join(" " if c in '\\/:*?"<>|' or not c.isprintable() else c for c in text).split())
