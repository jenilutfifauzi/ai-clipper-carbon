"""The mapping between Timeline time and Source time per Segment (docs/adr/0009), on the cases the
frontend's tests read too (fixtures/segment_times.json)."""

import json
from pathlib import Path

import pytest

from app.candidates import Segment
from app.segment_time import SegmentTime, segment_time, track_length

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "segment_times.json").read_text())
CLOSE = CASES["tolerance"]


def timed(given: dict) -> SegmentTime:
    return SegmentTime(given["start"], given["end"], given.get("speed", 1.0), given.get("reverse", False), given.get("hold"))


@pytest.mark.parametrize("case", CASES["segments"], ids=lambda case: case["name"])
def test_a_segments_timeline_length_is_as_the_shared_cases_say(case):
    assert timed(case["segment"]).length == pytest.approx(case["length"], abs=CLOSE)


@pytest.mark.parametrize("case", CASES["segments"], ids=lambda case: case["name"])
def test_timeline_time_maps_to_source_time_and_back(case):
    time = timed(case["segment"])
    for offset, source in case["at"]:
        assert time.source_at(offset) == pytest.approx(source, abs=CLOSE), offset
        # A held Segment shows its one frame all along: it is placed at its start.
        back = 0.0 if time.hold is not None else offset
        assert time.offset_at(source) == pytest.approx(back, abs=CLOSE), source
        assert time.offset_of(source - time.start) == pytest.approx(back, abs=CLOSE), source


@pytest.mark.parametrize("case", CASES["main_tracks"], ids=lambda case: case["name"])
def test_a_main_tracks_length_is_its_segments_less_their_transitions_overlaps(case):
    segments = case["segments"]
    by_join = {transition["after"]: transition["secs"] for transition in case["transitions"]}
    joins = [by_join.get(segment["id"]) for segment in segments]
    assert track_length([timed(segment) for segment in segments], joins) == pytest.approx(case["length"], abs=CLOSE)


def test_a_part_of_a_segment_plays_the_range_shown_then_in_its_direction():
    assert SegmentTime(10, 14, speed=2).part(0.5, 1.5) == SegmentTime(11, 13, speed=2)
    assert SegmentTime(10, 14, speed=2, reverse=True).part(0.5, 1.5) == SegmentTime(11, 13, speed=2, reverse=True)
    assert SegmentTime(7, 7, hold=2).part(0.5, 1.5) == SegmentTime(7, 7, hold=1)


def test_a_candidates_segment_plays_forwards_at_1x():
    assert segment_time(Segment("s0", 10.0, 12.5)) == SegmentTime(10.0, 12.5)
