"""The Advanced Edit's rules that span its items (.scratch/advanced-edit/spec.md): a Clip's length on
the Timeline, Text Layers kept inside it, a Source Segment's own volume, and Transitions around a
video that is gone. Seam B on review, the planner and the encode's command."""

from dataclasses import replace
from pathlib import Path

import pytest

from app.candidates import Segment, TextLayer, Transition, manual_candidate, timeline_length
from app.config import CameraTuning, RenderTuning, SelectionTuning
from app.renderer import Renderer
from app.rendering import candidate_plan
from app.review import CandidateChange, Episode, InvalidEdit, update
from app.styles import PresetStore
from app.transcript import Segment as Line
from app.transcript import Transcript, Word
from app.video_source import SourceMetadata

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
# A Word every second for 400 s.
WORDS = [Word(f"w{i}", i + 0.1, i + 0.9) for i in range(400)]
EPISODE = Episode(
    Transcript("id", "whisper", WORDS, [Line("", 0, 400)]), 600, 90, SelectionTuning()
)


def test_the_longest_clip_is_measured_on_the_timeline_after_transition_overlaps():
    a, b = Segment("a", 0, 90), Segment("b", 100, 191)
    assert timeline_length([a, b], []) == 181
    assert timeline_length([a, b], [Transition("a", secs=1.5)]) == 179.5
    candidate = manual_candidate("c", 0, 10)
    # 181 s back to back is too long; with a 1.5 s Transition it plays 179.5 s, which fits.
    with pytest.raises(InvalidEdit):
        update([candidate], "c", CandidateChange(segments=[a, b]), EPISODE)
    _, cut = update([candidate], "c", CandidateChange(segments=[a, b], transitions=[Transition("a", secs=1.5)]), EPISODE)
    assert cut.duration == pytest.approx(cut.main_track()[0].end - cut.main_track()[0].start + 91 - 1.5, abs=0.5)


def test_a_new_or_changed_text_layer_must_start_inside_the_clip():
    candidate = manual_candidate("c", 10, 20)
    late = TextLayer("t", "Halo", start=30, secs=1)
    with pytest.raises(InvalidEdit):
        update([candidate], "c", CandidateChange(text_layers=[late]), EPISODE)
    # One left past the end by a trim is kept, and doesn't stop other edits.
    _, kept = update([replace(candidate, text_layers=[late])], "c", CandidateChange(text_layers=[late]), EPISODE)
    assert kept.text_layers == [late]


def test_a_source_segments_own_volume_is_applied_before_the_join(tmp_path):
    candidate = replace(manual_candidate("c", 10, 26), segments=[Segment("a", 10, 12, volume=0.5), Segment("b", 20, 22)])
    planned = candidate_plan(candidate, SOURCE, None, [None, None], PresetStore(tmp_path / "p.json"), CameraTuning())
    assert [segment.volume for segment in planned.segments] == [0.5, 1.0]
    command = Renderer(Path("ffmpeg"), RenderTuning())._command(
        Path("s.mp4"), planned, None, "libx264", tmp_path / "v.mp4", tmp_path / "p.jpg", None
    )
    graph = command[command.index("-filter_complex") + 1]
    assert "[0:a:0]volume=0.5," in graph and "[1:a:0]volume=1," in graph


def test_a_transition_next_to_a_missing_video_is_left_out(tmp_path):
    candidate = replace(
        manual_candidate("c", 10, 26),
        segments=[Segment("a", 10, 12), Segment("m", 0, 2, media="ab" * 16), Segment("b", 20, 22)],
        transitions=[Transition("m", secs=0.5)],
    )
    planned = candidate_plan(candidate, SOURCE, None, [None, None, None], PresetStore(tmp_path / "p.json"), CameraTuning())
    assert [segment.source_start for segment in planned.segments] == [10, 20]
    assert planned.transitions == []
