"""Which frame of which Matte piece shows a time into a cut-out Segment (docs/adr/0015), on the cases
the preview's tests read too (fixtures/matte_frames.json)."""

import json
from pathlib import Path

import pytest

from app.matte import Mattes, matte_frame
from app.segment_time import SegmentTime

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "matte_frames.json").read_text())["cases"]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_a_time_into_a_segment_shows_the_shared_cases_frame_of_its_piece(case):
    given = case["segment"]
    time = SegmentTime(given["start"], given["end"], given.get("speed", 1.0), given.get("reverse", False), given.get("hold"))
    source = time.source_at(case["offset"])
    assert source == pytest.approx(case["source"], abs=1e-9)
    assert matte_frame(source, case["fps"]) == (case["piece"], case["frame"])


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_the_frame_is_one_its_piece_holds(case):
    mattes = Mattes(Path("unused"), Path("unused.mp4"), (1920, 1080, case["fps"]), 60.0)
    count, _ = mattes.frames(case["piece"])
    assert 0 <= case["frame"] < count
