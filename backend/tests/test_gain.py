"""The gain function (`gain_at`): how loud a sound is heard at a time, on the cases the preview's
tests read too (fixtures/gain_vectors.json), so that the render's gain and the preview's can't drift.
Seam B: its fades are fitted to the sound as the planner fits a Music Clip's (`audio_events`)."""

import json
from pathlib import Path

import pytest

from app.candidates import LINEAR, Ease, Keyframe, MusicClip
from app.planner import AudioEvent, MediaInfo, audio_events, gain_at

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "gain_vectors.json").read_text())
CLOSE = CASES["tolerance"]
SONG = "ef" * 16


def heard(sound: dict) -> AudioEvent:
    """The case's sound as the planner hears it: a Music Clip over its span, of a song longer than it."""
    keys = [Keyframe(key["at"], key["value"], Ease(*key.get("ease", LINEAR))) for key in sound.get("keys", [])]
    secs = sound["end"] - sound["start"]
    clip = MusicClip(
        "m", SONG, sound["start"], secs, volume=sound.get("volume", 1.0), fade_in=sound.get("fade_in", 0.0),
        fade_out=sound.get("fade_out", 0.0), keys={"volume": keys} if keys else {}, muted=sound.get("muted", False),
    )
    [event] = audio_events([clip], sound["end"] + 1, {SONG: MediaInfo(0, 0, secs, True)})
    return event


@pytest.mark.parametrize("case", CASES["sounds"], ids=lambda case: case["name"])
def test_a_sound_is_as_loud_as_the_shared_cases_say(case):
    event = heard(case["sound"])
    for time, gain in case["at"]:
        assert gain_at(event, time) == pytest.approx(gain, abs=CLOSE), time
