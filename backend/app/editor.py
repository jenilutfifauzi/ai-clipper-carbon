"""The clip editor's Preview Plan: the Render Plan of a Candidate, or of an unsaved draft of its
edits, for the browser to draw over the Source (docs/adr/0001-backend-plans-frontend-draws.md).

It plans as a render does (rendering.candidate_plan), from what is at hand without transcribing or
analysing: the Clip's own Words and analysis when a render or a preparation has saved them for its
range, and otherwise the episode Transcript's Words and a single Scene. A video's Segment shows its
item's Media Words once they are saved (app/media_words.py), and none until then.
"""

from dataclasses import dataclass, field, replace
from enum import StrEnum
from pathlib import Path

from app.candidates import Candidate, WordEdit
from app.config import BLAZE_FACE_MODEL, Settings
from app.jobs import Job
from app.layer_pictures import PICTURES_DIR, make_pictures
from app.matte import PIECE_SECS, Mattes, Reversed
from app.logos import LogoStore
from app.media import MediaStore
from app.media_words import MediaWordsStatus, MediaWordsStore
from app.planner import RenderPlan, match_edits
from app.rendering import (
    Analysis,
    analysed_range,
    candidate_plan,
    captioned_media,
    matte_reads,
    media_mattes,
    media_language,
    media_segment_words,
    music_words,
    needed_analysis,
    saved_analysis,
    saved_words,
    source_mattes,
    transcript_words,
    words_at_hand,
)
from app.segment_time import segment_time
from app.styles import PresetStore
from app.transcript import Transcript, Word


class WordsSource(StrEnum):
    # Transcribed for the Clip's range, as its render captions it.
    CLIP = "clip"
    # The episode Transcript's, until the Clip is transcribed.
    TRANSCRIPT = "transcript"


class WordsStatus(StrEnum):
    """Where a Segment's caption Words come from in a Preview Plan. (Not MediaWordsStatus, in
    app/media_words.py: that is what is saved of an item's Media Words; a video's Segment is `media`
    while they are `ready`.)"""

    # A Source Segment's own, transcribed for its range.
    CLIP = "clip"
    # A Source Segment's from the episode Transcript, until its range is transcribed.
    TRANSCRIPT = "transcript"
    # A video's, from its item's Media Words.
    MEDIA = "media"
    # A video's, while its item's Media Words are being transcribed.
    PENDING = "pending"
    # A video's, whose item's Media Words failed to be transcribed (until a Retry).
    FAILED = "failed"
    # A video's whose Captions switch is off.
    OFF = "off"
    # None: a Freeze frame, a reversed Segment, a video without sound or whose Media Words aren't
    # queued, or a Job with captions off.
    NONE = "none"


@dataclass(frozen=True)
class PreviewWord:
    """A Word the captions are made of, as heard (in seconds into the Clip), the middle of it on its
    timeline (`at`, on the Source's, or with `media` on that Media Library item's: which a Word Edit
    of it is keyed by), and the Candidate's Word Edit that applies to it, if any."""

    text: str
    start: float
    end: float
    edit: WordEdit | None = None
    at: float = 0.0
    media: str | None = None


@dataclass(frozen=True)
class MattePiece:
    """A piece of an item's Matte a cut-out picture reads (app/matte.py), by its `start` in seconds, and
    where the preview reads it: served once it is made, missing until then. Its item is the Source,
    or the Media Library's `media` (an image's one piece, 0, a PNG). The preview finds a frame in it
    by its item's Matte's frame rate `fps` (`matte_rate`: the Source's, or the video's own) and the
    length of the item's pieces, `piece_secs` (docs/adr/0001: neither is copied into the frontend)."""

    start: int
    url: str
    media: str | None = None
    fps: float = 0.0
    piece_secs: int = PIECE_SECS


@dataclass(frozen=True)
class MatteCopy:
    """The reversed copy of an item's Matte (the Source's, or the video `media`'s) a reversed cut-out
    picture playing its range from `start` to `end` reads (app/matte.py's `Reversed`), where the
    preview reads it (served once it is made: the one serving it, of a wider range if there is one),
    and seconds into it where it shows the range (`at`, as a Retimed copy's)."""

    start: float
    end: float
    url: str
    at: float
    media: str | None = None


@dataclass(frozen=True)
class PreviewPlan:
    plan: RenderPlan
    # Those whose middle is in the Clip.
    words: list[PreviewWord]
    words_source: WordsSource
    # Each Segment's, by its id.
    words_status: dict[str, WordsStatus]
    # Why a `failed` Segment's item failed to be transcribed, by the Segment's id.
    words_errors: dict[str, str]
    # Whether the Scenes and faces are the Clip's own: False while it is one Scene, unanalysed.
    analysed: bool
    # The Matte pieces its cut-out Segments read (docs/adr/0015), in order: the preview draws the cut
    # from them, and each Segment's picture whole where its piece isn't served yet.
    mattes: list[MattePiece] = field(default_factory=list)
    # The reversed copies of the Matte its reversed cut-out Segments read, each once.
    matte_copies: list[MatteCopy] = field(default_factory=list)


def captions_pending(preview: PreviewPlan) -> bool:
    """Whether a captioned Segment's Words are still being transcribed, so that the Preview Plan's
    Cues aren't yet all the Clip's: a caption file made of them (app/caption_files.py) would be
    missing those."""
    return WordsStatus.PENDING in preview.words_status.values()


def preview_plan(
    job: Job,
    job_dir: Path,
    transcript: Transcript,
    candidate: Candidate,
    settings: Settings,
    presets: PresetStore,
    logos: LogoStore | None = None,
    media: MediaStore | None = None,
    media_words: MediaWordsStore | None = None,
    fps: float | None = None,
    matte_version: str | None = None,
) -> PreviewPlan:
    """The Candidate's Preview Plan, `job_dir` being its Job's directory. Each of its Segments is
    planned from what is saved for its range: its Words are the Clip's own only when every Source
    Segment's are, and it is analysed only when every Segment is. A video's Segment is captioned from
    its item's Media Words in `media_words`, pending while they are queued there, its item is queued
    for the Job, or its Candidate is being prepared; failed, with the error, until a Retry; off when
    its Captions switch is. It is planned at the Source's frame rate, or at `fps` (a saved frame's,
    at its Export Preset's). With `matte_version` (the Matte runner's), it lists the Matte pieces its
    cut-out Segments read (`preview_mattes`)."""
    assert job.source is not None
    source = job.source.metadata
    segments = candidate.main_track()
    # A Freeze frame and a reversed Segment have no Words; a video's has its item's Media Words, if saved.
    saved = [
        [] if segment.media or segment.hold is not None or segment.reverse
        else saved_words(job_dir, segment.start, segment.end, job.options.language, settings.whisper_model)
        for segment in segments
    ]
    words_source = WordsSource.CLIP if all(found is not None for found in saved) else WordsSource.TRANSCRIPT
    status: dict[str, WordsStatus] = {}
    errors: dict[str, str] = {}
    for i, segment in enumerate(segments):
        if not job.options.captions or segment.hold is not None or segment.reverse:
            status[segment.id] = WordsStatus.NONE
        elif segment.media is None:
            status[segment.id] = WordsStatus.TRANSCRIPT if saved[i] is None else WordsStatus.CLIP
        elif segment.captions is False:
            status[segment.id] = WordsStatus.OFF
        elif (item := media.find(segment.media) if media else None) is None or media_words is None or not captioned_media(segment, item):
            status[segment.id] = WordsStatus.NONE
        else:
            language = media_language(job, item)
            found = media_words.status(item.id, language)
            if (heard := media_words.saved(item.id, language)) is not None:
                saved[i] = media_segment_words(heard, segment)
            if found is MediaWordsStatus.FAILED:
                status[segment.id] = WordsStatus.FAILED
                errors[segment.id] = media_words.error(item.id, language) or "Transcribing it failed"
            elif found is MediaWordsStatus.PENDING or (heard is None and candidate.id in job.preparing) or item.id in job.transcribing:
                # (Transcribed again, it shows its earlier Words meanwhile.)
                status[segment.id] = WordsStatus.PENDING
            else:
                status[segment.id] = WordsStatus.MEDIA if heard is not None else WordsStatus.NONE
    words = [
        found if found is not None else transcript_words(transcript, segment.start, segment.end, source.duration)
        for segment, found in zip(segments, saved)
    ]
    needed = [needed_analysis(candidate, segment, source) for segment in segments]
    analyses = [
        None if wanted is Analysis.NONE
        else saved_analysis(
            job_dir, *analysed_range(candidate, segment, source.duration), settings.analysis, BLAZE_FACE_MODEL.name,
            wanted is Analysis.FACES,
        )
        for segment, wanted in zip(segments, needed)
    ]
    # Heard, captioned or not: they duck the music (docs/adr/0016), as its Music Clips of the Source's do.
    language, model = job.options.language, settings.whisper_model
    music = music_words(candidate, lambda start, end: words_at_hand(job_dir, transcript, start, end, source.duration, language, model))
    plan = candidate_plan(
        candidate, source, words, analyses, presets, settings.camera, logos, media, fps, captioned=job.options.captions, music=music
    )
    # Its picture layers' pictures, which the preview shows (docs/adr/0010): made now if they aren't there.
    make_pictures(settings.ffmpeg_bin, (event.layout for event in plan.picture_layers), job_dir / PICTURES_DIR)
    shown, at = [], 0.0
    for segment, heard in zip(segments, words):
        played = segment_time(segment)
        ordered = sorted(heard, key=lambda word: word.start)
        # Matched in the Segment, on its own timeline (the Source's, or its item's); given back as the
        # Candidate holds them.
        own = [edit for edit in candidate.word_edits if edit.media == segment.media]
        shifted = [replace(edit, at=edit.at - segment.start) for edit in own]
        original = {id(edit): kept for edit, kept in zip(shifted, own)}
        shown += [
            PreviewWord(
                word.text, round(played.offset_of(word.start) + at, 3), round(played.offset_of(word.end) + at, 3),
                None if edit is None else original[id(edit)], round(segment.start + (word.start + word.end) / 2, 3),
                segment.media,
            )
            for word, edit in zip(ordered, match_edits(ordered, shifted))
            if 0 <= (word.start + word.end) / 2 < played.span
        ]
        at += played.length
    analysed = all(analysis is not None for analysis, wanted in zip(analyses, needed) if wanted is not Analysis.NONE)
    mattes, copies = [], []
    if matte_version:
        mattes, copies = preview_mattes(plan, job.id, matte_version, source_mattes(job_dir, job.source), media)
    return PreviewPlan(plan, shown, words_source, status, errors, analysed=analysed, mattes=mattes, matte_copies=copies)


def preview_mattes(
    plan: RenderPlan, job_id: str, version: str, source: Mattes, media: MediaStore | None
) -> tuple[list[MattePiece], list[MatteCopy]]:
    """The Matte pieces `plan`'s cut-out pictures read (`matte_reads`: of the Source's Matte `source`,
    or of their Media Library items' in `media`), made by the matter `version`, in order, each once,
    and the reversed copies its reversed ones read, each once; and where they are served: the Job's
    media (the Source's), or the Media Library's (app/matte.py's names)."""
    pieces: dict[tuple[str | None, str, int], MattePiece] = {}
    copies: dict[tuple[str | None, float, float], MatteCopy] = {}
    for (kind, i), (own, parts) in matte_reads(plan, source, media_mattes(media)).items():
        item = plan.segments[i] if kind == "segment" else (plan.overlays if kind == "overlay" else plan.behind)[i]
        assert item.background_removal is not None
        subject = item.background_removal.subject
        media_id = item.media if kind != "segment" else plan.segments[i].media
        served = f"/media/{job_id}/" if media_id is None else f"/api/media/{media_id}/mattes/"
        for part in parts:
            path = own.path(subject, version, part)
            url = served + path.relative_to(own.folder.parent if media_id is None else own.folder).as_posix()
            if isinstance(part, Reversed):
                copies[(media_id, part.start, part.end)] = MatteCopy(part.start, part.end, url, own.reversed_copy(subject, version, part)[1], media_id)
            else:
                pieces[(media_id, str(subject), part)] = MattePiece(part, url, media_id, own.frame[2])
    ordered = sorted(pieces.items(), key=lambda found: (found[0][0] or "", found[0][2], found[0][1]))
    return [piece for _, piece in ordered], list(copies.values())
