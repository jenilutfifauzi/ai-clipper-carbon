"""The clip editor's Preview Plan: the Render Plan of a Candidate, or of an unsaved draft of its
edits, for the browser to draw over the Source (docs/adr/0001-backend-plans-frontend-draws.md).

It plans as a render does (rendering.candidate_plan), from what is at hand without transcribing or
analysing: the Clip's own Words and analysis when a render or a preparation has saved them for its
range, and otherwise the episode Transcript's Words and a single Scene.
"""

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from app.candidates import Candidate
from app.config import BLAZE_FACE_MODEL, Settings
from app.jobs import Job
from app.planner import RenderPlan, reframes
from app.rendering import candidate_plan, saved_analysis, saved_words, transcript_words
from app.styles import PresetStore
from app.transcript import Transcript, Word


class WordsSource(StrEnum):
    # Transcribed for the Clip's range, as its render captions it.
    CLIP = "clip"
    # The episode Transcript's, until the Clip is transcribed.
    TRANSCRIPT = "transcript"


@dataclass(frozen=True)
class PreviewPlan:
    plan: RenderPlan
    # The Words the captions are made of, in seconds into the Clip: those whose middle is in it.
    words: list[Word]
    words_source: WordsSource
    # Whether the Scenes and faces are the Clip's own: False while it is one Scene, unanalysed.
    analysed: bool


def preview_plan(
    job: Job, job_dir: Path, transcript: Transcript, candidate: Candidate, settings: Settings, presets: PresetStore
) -> PreviewPlan:
    """The Candidate's Preview Plan, `job_dir` being its Job's directory."""
    assert job.source is not None
    source = job.source.metadata
    clip_words = saved_words(job_dir, candidate.start, candidate.end, job.options.language, settings.whisper_model)
    if clip_words is not None:
        words, words_source = clip_words, WordsSource.CLIP
    else:
        words, words_source = transcript_words(transcript, candidate.start, candidate.end, source.duration), WordsSource.TRANSCRIPT
    analysis = None
    if reframes(source):
        analysis = saved_analysis(job_dir, candidate.start, candidate.end, settings.analysis, BLAZE_FACE_MODEL.name)
    plan = candidate_plan(candidate, source, words if job.options.captions else None, analysis, presets, settings.camera)
    duration = candidate.end - candidate.start
    shown = [word for word in words if 0 <= (word.start + word.end) / 2 < duration]
    return PreviewPlan(plan, shown, words_source, analysed=analysis is not None or not reframes(source))
