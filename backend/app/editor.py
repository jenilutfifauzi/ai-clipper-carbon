"""The clip editor's Preview Plan: the Render Plan of a Candidate, or of an unsaved draft of its
edits, for the browser to draw over the Source (docs/adr/0001-backend-plans-frontend-draws.md).

It plans as a render does (rendering.candidate_plan), from what is at hand without transcribing or
analysing: the Clip's own Words and analysis when a render or a preparation has saved them for its
range, and otherwise the episode Transcript's Words and a single Scene.
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
from app.planner import RenderPlan, match_edits
from app.rendering import Analysis, analysed_range, candidate_plan, needed_analysis, saved_analysis, saved_words, transcript_words
from app.segment_time import segment_time
from app.styles import PresetStore
from app.transcript import Transcript, Word


class WordsSource(StrEnum):
    # Transcribed for the Clip's range, as its render captions it.
    CLIP = "clip"
    # The episode Transcript's, until the Clip is transcribed.
    TRANSCRIPT = "transcript"


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
    # Whether the Scenes and faces are the Clip's own: False while it is one Scene, unanalysed.
    analysed: bool


def captions_pending(preview: PreviewPlan) -> bool:
    """Whether a captioned Segment's Words are still being transcribed, so that the Preview Plan's
    Cues aren't yet all the Clip's: a caption file made of them (app/caption_files.py) would be
    missing those. Nothing is pending yet: a Source Segment falls back to the Transcript's Words
    (`words_source`). Media Words (docs/adr/0020, captions-advanced ticket 04) give each Segment a
    Words status, `pending` among them; this is where it is read."""
    return False


def preview_plan(
    job: Job,
    job_dir: Path,
    transcript: Transcript,
    candidate: Candidate,
    settings: Settings,
    presets: PresetStore,
    logos: LogoStore | None = None,
    media: MediaStore | None = None,
) -> PreviewPlan:
    """The Candidate's Preview Plan, `job_dir` being its Job's directory. Each of its Segments is
    planned from what is saved for its range: its Words are the Clip's own only when every Segment's
    are, and it is analysed only when every Segment is."""
    assert job.source is not None
    source = job.source.metadata
    segments = candidate.main_track()
    # A video's Segment has neither Words nor analysis, and a Freeze frame and a reversed Segment no Words.
    saved = [
        [] if segment.media or segment.hold is not None or segment.reverse
        else saved_words(job_dir, segment.start, segment.end, job.options.language, settings.whisper_model)
        for segment in segments
    ]
    words = [
        found if found is not None else transcript_words(transcript, segment.start, segment.end, source.duration)
        for segment, found in zip(segments, saved)
    ]
    words_source = WordsSource.CLIP if all(found is not None for found in saved) else WordsSource.TRANSCRIPT
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
    return PreviewPlan(plan, shown, words_source, analysed=analysed)
