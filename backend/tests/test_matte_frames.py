"""Which frame of which Matte piece shows a time into a cut-out Segment (docs/adr/0015), on the cases
the preview's tests read too (fixtures/matte_frames.json)."""

import json
from pathlib import Path

import pytest

from app.matte import PIECE_SECS, Mattes, matte_frame, matte_pieces
from app.segment_time import SegmentTime

FIXTURES = Path(__file__).parent / "fixtures"
SHARED = json.loads((FIXTURES / "matte_frames.json").read_text())
CASES = SHARED["cases"]


def test_the_shared_cases_pieces_are_the_mattes():
    """The preview reads a piece's length from the Preview Plan (ADR 0001); the shared cases are of it."""
    assert SHARED["piece_secs"] == PIECE_SECS


def test_an_item_whose_frame_rate_is_unknown_is_read_and_made_at_one_rate():
    """One fallback, in one place: the pieces a range reads, the frame shown and the Matte made."""
    assert matte_frame(19.99, 0) == matte_frame(19.99, 30) == (20, 0)
    assert matte_pieces(8, 12, 60.0, 0) == matte_pieces(8, 12, 60.0, 30) == [0, 10]
    assert Mattes(Path("unused"), Path("unused.mp4"), (1920, 1080, 0), 60.0).frames(10) == (300, 30)


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


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_the_segment_reads_the_pieces_the_shared_case_says_its_frame_among_them(case):
    """Chosen by frame, as the frame is: a held frame rounded into the next piece reads that piece."""
    given = case["segment"]
    end = given["start"] if given.get("hold") is not None else given["end"]
    assert matte_pieces(given["start"], end, 60.0, case["fps"]) == case["pieces"]
    assert case["piece"] in case["pieces"]
