"""The clip editor's Preview Plan: the Render Plan of a Candidate, or of an unsaved draft of its
edits, for the browser to draw over the Source (docs/adr/0001-backend-plans-frontend-draws.md).

It plans as a render does (rendering.candidate_plan), from what is at hand without transcribing or
analysing: the Clip's own Words and analysis when a render or a preparation has saved them for its
range, and otherwise the episode Transcript's Words and a single Scene. A video's Segment shows its
item's Media Words once they are saved (app/media_words.py), and none until then.
"""

from dataclasses import dataclass, replace
from enum import StrEnum
from pathlib import Path

from app.candidates import Candidate, WordEdit
from app.config import BLAZE_FACE_MODEL, Settings
from app.jobs import Job
from app.layer_pictures import PICTURES_DIR, make_pictures
from app.logos import LogoStore
from app.media import MediaStore
from app.media_words import MediaWordsStatus, MediaWordsStore
from app.planner import RenderPlan, match_edits
from app.rendering import (
    Analysis,
    analysed_range,
    candidate_plan,
    captioned_media,
    media_language,
    media_segment_words,
    needed_analysis,
    saved_analysis,
    saved_words,
    transcript_words,
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
    """Where a Segment's caption Words come from in a Preview Plan."""

    # A Source Segment's own, transcribed for its range.
    CLIP = "clip"
    # A Source Segment's from the episode Transcript, until its range is transcribed.
    TRANSCRIPT = "transcript"
    # A video's, from its item's Media Words.
    MEDIA = "media"
    # A video's, while its item's Media Words are being transcribed.
    PENDING = "pending"
    # None: a Freeze frame, a reversed Segment, a video without sound or whose Media Words aren't
    # queued, or a Job with captions off.
    NONE = "none"


@dataclass(frozen=True)
class PreviewWord:
    """A Word the captions are made of, as heard (in seconds into the Clip), the middle of it on the
    Source's timeline (`at`, which a Word Edit of it is keyed by), and the Candidate's Word Edit that
    applies to it, if any."""

    text: str
    start: float
    end: float
    edit: WordEdit | None = None
    at: float = 0.0


@dataclass(frozen=True)
class PreviewPlan:
    plan: RenderPlan
    # Those whose middle is in the Clip.
    words: list[PreviewWord]
    words_source: WordsSource
    # Each Segment's, by its id.
    words_status: dict[str, WordsStatus]
    # Whether the Scenes and faces are the Clip's own: False while it is one Scene, unanalysed.
    analysed: bool


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
) -> PreviewPlan:
    """The Candidate's Preview Plan, `job_dir` being its Job's directory. Each of its Segments is
    planned from what is saved for its range: its Words are the Clip's own only when every Source
    Segment's are, and it is analysed only when every Segment is. A video's Segment is captioned from
    its item's Media Words in `media_words`, pending while they are queued there or its Candidate is
    being prepared."""
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
    for i, segment in enumerate(segments):
        if not job.options.captions or segment.hold is not None or segment.reverse:
            status[segment.id] = WordsStatus.NONE
        elif segment.media is None:
            status[segment.id] = WordsStatus.TRANSCRIPT if saved[i] is None else WordsStatus.CLIP
        elif (item := media.find(segment.media) if media else None) is None or media_words is None or not captioned_media(segment, item):
            status[segment.id] = WordsStatus.NONE
        elif (heard := media_words.saved(item.id, media_language(job, item))) is not None:
            saved[i] = media_segment_words(heard, segment)
            status[segment.id] = WordsStatus.MEDIA
        else:
            queued = media_words.status(item.id, media_language(job, item)) is MediaWordsStatus.PENDING
            status[segment.id] = WordsStatus.PENDING if queued or candidate.id in job.preparing else WordsStatus.NONE
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
    plan = candidate_plan(
        candidate, source, words if job.options.captions else None, analyses, presets, settings.camera, logos, media
    )
    # Its picture layers' pictures, which the preview shows (docs/adr/0010): made now if they aren't there.
    make_pictures(settings.ffmpeg_bin, (event.layout for event in plan.picture_layers), job_dir / PICTURES_DIR)
    shown, at = [], 0.0
    for segment, heard in zip(segments, words):
        if segment.media is not None:
            # A video's Words are keyed on its item's timeline (their Word Edits come with ticket 06).
            at += segment_time(segment).length
            continue
        played = segment_time(segment)
        ordered = sorted(heard, key=lambda word: word.start)
        # Matched in the Segment; given back as the Candidate holds them.
        shifted = [replace(edit, at=edit.at - segment.start) for edit in candidate.word_edits]
        original = {id(edit): kept for edit, kept in zip(shifted, candidate.word_edits)}
        shown += [
            PreviewWord(
                word.text, round(played.offset_of(word.start) + at, 3), round(played.offset_of(word.end) + at, 3),
                None if edit is None else original[id(edit)], round(segment.start + (word.start + word.end) / 2, 3),
            )
            for word, edit in zip(ordered, match_edits(ordered, shifted))
            if 0 <= (word.start + word.end) / 2 < played.span
        ]
        at += played.length
    analysed = all(analysis is not None for analysis, wanted in zip(analyses, needed) if wanted is not Analysis.NONE)
    return PreviewPlan(plan, shown, words_source, status, analysed=analysed)
