"""The gain function (`gain_at`): how loud a sound is heard at a time, on the cases the preview's
tests read too (fixtures/gain_vectors.json), so that the render's gain and the preview's can't drift.
Seam B: its fades are fitted to the sound as the planner fits a Music Clip's (`audio_events`) or a
Segment's (`plan_render`, the Transition into the next included); a ducked one carries its spans of
speech as the plan does, under the cases' ramps, which are the config's; the Source's is under the
case's `source_volume`, and a Segment taken away by a Transition under the plan's crossfade."""

import json
from dataclasses import replace
from pathlib import Path

import pytest

from app.candidates import LINEAR, Ease, Framing, Keyframe, MusicClip, TransitionKind
from app.config import DuckTuning
from app.planner import AudioEvent, Join, MediaInfo, RenderPlan, SegmentInput, SegmentPlan, audio_events, gain_at, plan_render
from app.video_source import SourceMetadata

FIXTURES = Path(__file__).parent / "fixtures"
CASES = json.loads((FIXTURES / "gain_vectors.json").read_text())
CLOSE = CASES["tolerance"]
DUCKING = DuckTuning(**CASES["ducking"])
SONG = "ef" * 16
VIDEO = "ab" * 16
SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")


def heard(sound: dict) -> AudioEvent:
    """The case's sound as the planner hears it: a Music Clip over its span, of a song longer than it,
    or of the Source."""
    secs = sound["end"] - sound["start"]
    source = sound.get("source", False)
    clip = MusicClip(
        "m", media=None if source else SONG, start=sound["start"], secs=secs, offset=100.0 if source else 0.0,
        volume=sound.get("volume", 1.0), fade_in=sound.get("fade_in", 0.0), fade_out=sound.get("fade_out", 0.0),
        keys=keys_of(sound), muted=sound.get("muted", False), duck=sound.get("duck"),
    )
    [event] = audio_events([clip], sound["end"] + 1, {SONG: MediaInfo(0, 0, secs, True)}, SOURCE.duration)
    return replace(event, speech_spans=[(start, end) for start, end in sound.get("speech_spans", [])])


def played(sound: dict) -> tuple[SegmentPlan, RenderPlan]:
    """The case's sound as the planner plays a Segment's, and the plan: a video's (or the Source's)
    over its span, after a video as long as its start, and before one that a Transition overlaps its
    `tail` with."""

    def video(secs: float, **fields) -> SegmentInput:
        return SegmentInput(0, secs, media=VIDEO, width=640, height=360, framing=Framing(), **fields)

    secs = sound["end"] - sound["start"]
    fields = dict(
        volume=sound.get("volume", 1.0), fade_in=sound.get("fade_in", 0.0), fade_out=sound.get("fade_out", 0.0),
        keys=keys_of(sound), muted=sound.get("muted", False),
    )
    before = [video(sound["start"])] if sound["start"] else []
    segment = SegmentInput(100, 100 + secs, **fields) if sound.get("source") else video(secs, **fields)
    after = [video(4 * sound["tail"], join=Join(TransitionKind.FADE, sound["tail"]))] if sound.get("tail") else []
    plan = plan_render(0, 1, SOURCE, main_track=[*before, segment, *after], source_volume=sound.get("source_volume", 1.0))
    return plan.segments[len(before)], plan


def keys_of(sound: dict) -> dict:
    keys = [Keyframe(key["at"], key["value"], Ease(*key.get("ease", LINEAR))) for key in sound.get("keys", [])]
    return {"volume": keys} if keys else {}


@pytest.mark.parametrize("case", CASES["sounds"], ids=lambda case: case["name"])
def test_a_sound_is_as_loud_as_the_shared_cases_say(case):
    sound, crossfade = case["sound"], None
    if case.get("item") == "segment":
        event, plan = played(sound)
        assert (event.start, event.end) == (sound["start"], sound["end"])
        if sound.get("crossfade"):
            [crossfade] = plan.transitions
            assert (crossfade.start, crossfade.end) == (sound["end"] - sound["tail"], sound["end"])
    else:
        event = heard(sound)
    for time, gain in case["at"]:
        assert gain_at(event, time, DUCKING, sound.get("source_volume", 1.0), crossfade) == pytest.approx(gain, abs=CLOSE), time


def test_the_cases_ramps_are_the_configs():
    assert DUCKING == DuckTuning()
