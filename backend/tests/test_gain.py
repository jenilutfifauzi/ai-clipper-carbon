"""The gain function (`gain_at`): how loud a sound is heard at a time, on the cases the preview's
tests read too (fixtures/gain_vectors.json), so that the render's gain and the preview's can't drift.
Seam B: its fades are fitted to the sound as the planner fits a Music Clip's (`audio_events`) or a
Segment's (`plan_render`)."""

import json
from pathlib import Path

import pytest

from app.candidates import LINEAR, Ease, Framing, Keyframe, MusicClip
from app.planner import AudioEvent, MediaInfo, SegmentInput, SegmentPlan, audio_events, gain_at, plan_render
from app.video_source import SourceMetadata

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "gain_vectors.json").read_text())
CLOSE = CASES["tolerance"]
SONG = "ef" * 16
VIDEO = "ab" * 16
SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def heard(sound: dict) -> AudioEvent:
    """The case's sound as the planner hears it: a Music Clip over its span, of a song longer than it."""
    secs = sound["end"] - sound["start"]
    clip = MusicClip(
        "m", SONG, sound["start"], secs, volume=sound.get("volume", 1.0), fade_in=sound.get("fade_in", 0.0),
        fade_out=sound.get("fade_out", 0.0), keys=keys_of(sound),
    )
    [event] = audio_events([clip], sound["end"] + 1, {SONG: MediaInfo(0, 0, secs, True)})
    return event


def played(sound: dict) -> SegmentPlan:
    """The case's sound as the planner plays a Segment's: a video's over its span, after one as long
    as its start."""

    def video(secs: float, **fields) -> SegmentInput:
        return SegmentInput(0, secs, media=VIDEO, width=640, height=360, framing=Framing(), **fields)

    before = [video(sound["start"])] if sound["start"] else []
    segment = video(
        sound["end"] - sound["start"], volume=sound.get("volume", 1.0), fade_in=sound.get("fade_in", 0.0),
        fade_out=sound.get("fade_out", 0.0), keys=keys_of(sound),
    )
    return plan_render(0, 1, SOURCE, main_track=[*before, segment]).segments[-1]


def keys_of(sound: dict) -> dict:
    keys = [Keyframe(key["at"], key["value"], Ease(*key.get("ease", LINEAR))) for key in sound.get("keys", [])]
    return {"volume": keys} if keys else {}


@pytest.mark.parametrize("case", CASES["sounds"], ids=lambda case: case["name"])
def test_a_sound_is_as_loud_as_the_shared_cases_say(case):
    event = played(case["sound"]) if case.get("item") == "segment" else heard(case["sound"])
    for time, gain in case["at"]:
        assert gain_at(event, time) == pytest.approx(gain, abs=CLOSE), time
