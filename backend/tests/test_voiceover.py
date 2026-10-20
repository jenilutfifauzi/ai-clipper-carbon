"""Speech on Music Clips (.scratch/voiceover/issues/01-speech-on-music-clips.md, docs/adr/0018): a
Music Clip marked Speech that isn't Muted is speech for Ducking over its whole span on the Timeline,
and is never ducked itself. Seam B on the model and the planner's speech spans, then Seam A through
the API, MCP and the real ffmpeg (as test_ducking.py)."""

from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from pydantic import TypeAdapter

from app.candidates import Candidate, MusicClip, Segment
from app.planner import MediaInfo, SegmentInput, gain_at, plan_render
from app.transcript import Word
from test_keyed_volume import tone_level
from test_keyframes import clip_of
from test_media_library import make, upload
from test_mcp import HALO_KABAR, anyio_backend, call, fails, manual, mcp  # noqa: F401
from test_mcp import reviewed as reviewed_by_mcp
from test_render import add, preview, reviewed
# The Sources Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, plain_video, render_video  # noqa: F401
from test_review import candidate_url, patch
from test_segments import SOURCE
from test_segments import manual as manual_candidate

SONG = "ef" * 16
TAKE = "cd" * 16
ITEMS = {SONG: MediaInfo(0, 0, 60.0, True), TAKE: MediaInfo(0, 0, 60.0, True)}
DEPTH = -20.0


def said(*spans: tuple[float, float]) -> list[Word]:
    return [Word("kata", start, end) for start, end in spans]


def song(**fields) -> MusicClip:
    """A ducked song under the whole Clip."""
    return MusicClip(**{"id": "m", "media": SONG, "start": 0.0, "secs": 30.0, "duck": DEPTH, **fields})


def take(id: str, start: float, secs: float, **fields) -> MusicClip:
    """A Take: a Music Clip of a recorded voice, marked Speech."""
    return MusicClip(id, start, secs, media=TAKE, speech=True, **fields)


def planned(main_track: list[SegmentInput], *music: MusicClip):
    plan = plan_render(0, 1, SOURCE, main_track=main_track, music=[song(), *music], media_info=ITEMS)
    return {event.id: event for event in plan.audio}, plan


# Seam B: the model and the planner


def test_a_speech_music_clips_whole_span_is_speech_and_a_ducked_song_under_it_carries_it_and_its_stretch():
    events, plan = planned([SegmentInput(10, 30)], take("t", 3.0, 2.0, offset=4.0, speed=2))
    # Its whole span on the Timeline, pauses included, however it reads its file.
    assert events["m"].speech == [(3.0, 5.0)]
    assert events["m"].ducked == [(2.75, 5.5)]
    tenth = 10 ** (DEPTH / 20)
    assert [round(gain_at(events["m"], time, plan.ducking), 6) for time in (2.0, 4.0, 6.0)] == [1, tenth, 1]
    assert events["t"].speaks and not events["m"].speaks


def test_a_muted_speech_music_clip_makes_no_speech():
    events, _ = planned([SegmentInput(10, 30)], take("t", 3.0, 2.0, muted=True))
    assert events["m"].speech == [] and events["m"].ducked == []


def test_a_speech_music_clips_span_joins_the_sources_words_across_a_short_gap_and_not_a_long_one():
    words = said((1.0, 2.5))
    events, _ = planned([SegmentInput(10, 30, words=words)], take("t", 3.0, 2.0))
    assert events["m"].speech == [(1.0, 5.0)]
    events, _ = planned([SegmentInput(10, 30, words=words)], take("t", 4.0, 2.0))
    assert events["m"].speech == [(1.0, 2.5), (4.0, 6.0)]


def test_a_speech_span_past_the_clips_end_is_cut_to_it():
    events, _ = planned([SegmentInput(10, 14)], take("t", 3.0, 3.0))
    assert events["m"].speech == [(3.0, 4.0)]


def test_a_speech_music_clip_is_never_ducked_and_two_overlapping_ones_dont_duck_each_other():
    events, plan = planned([SegmentInput(10, 30, words=said((1.0, 9.0)))], take("t", 2.0, 4.0), take("u", 3.0, 4.0))
    assert events["m"].speech == [(1.0, 9.0)]
    for spoken in (events["t"], events["u"]):
        assert (spoken.duck, spoken.speech, spoken.ducked) == (None, [], [])
        assert gain_at(spoken, 4.0, plan.ducking) == 1
    with pytest.raises(ValueError, match="Music Clip t is Speech, which is never ducked"):
        take("t", 0.0, 2.0, duck=-12.0)
    with pytest.raises(ValueError, match="Music Clip s plays the episode's sound, whose Words are its speech"):
        MusicClip("s", 0.0, 2.0, speech=True)


def test_a_stored_candidate_without_speech_reads_as_not_speech_and_plans_as_before():
    candidate = manual_candidate(
        segments=[Segment("a", 10, 12), Segment("b", 20, 22)],
        music=[MusicClip("m", 0.0, 4.0, media=SONG, duck=-12.0), MusicClip("n", 1.0, 2.0, media=TAKE)],
    )
    adapter = TypeAdapter(Candidate)
    stored = adapter.dump_python(candidate, mode="json")
    for clip in stored["music"]:
        del clip["speech"]
    read = adapter.validate_python(stored)
    assert [clip.speech for clip in read.music] == [False, False]
    assert read == candidate

    def plan(music: list[MusicClip]):
        return plan_render(0, 1, SOURCE, main_track=[SegmentInput(10, 14, words=said((0.2, 0.6)))], music=music, media_info=ITEMS)

    assert plan(read.music) == plan(candidate.music)
    # The other Music Clip, not marked, makes no speech: the song ducks under the Words alone.
    assert plan(read.music).audio[0].speech == [(0.2, 0.6)]
    marked = [read.music[0], replace(read.music[1], speech=True)]
    assert plan(marked).audio[0].speech == [(0.2, 3.0)]


# Seam A: the API and MCP


@pytest.fixture(scope="session")
def tones(tmp_path_factory) -> dict[str, bytes]:
    """5 s tones, each at its own pitch: the song (880 Hz), the Take (1320 Hz) and a reference
    under the whole Clip that nothing ducks (440 Hz)."""
    folder = tmp_path_factory.mktemp("voiceover")
    return {
        name: make(folder / f"{name}.wav", "-f", "lavfi", "-i", f"sine=frequency={frequency}:sample_rate=44100:duration=5")
        for name, frequency in (("song", 880), ("take", 1320), ("reference", 440))
    }


def test_a_speech_music_clip_is_added_with_no_duck_and_refuses_one_as_the_sources_refuses_speech(client, tones):
    take_id = upload(client, tones["take"], "Voiceover 2026-10-20 10.00.00.wav").json()["id"]
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    added = {"id": "t", "media": take_id, "start": 0.5, "secs": 1.0, "speech": True}
    saved = patch(client, job, candidate, music=[added, {**added, "id": "n", "speech": False}])
    assert [(clip["speech"], clip["duck"]) for clip in saved["music"]] == [(True, None), (False, -12)]

    for music, message in (
        ([{**added, "duck": -12}], "Music Clip t is Speech, which is never ducked"),
        ([{"id": "s", "start": 0, "secs": 1, "offset": 1.0, "speech": True}], "Music Clip s plays the episode's sound, whose Words are its speech"),
    ):
        response = client.patch(candidate_url(job, saved), json={"music": music})
        assert response.status_code == 422 and message in response.text, (music, response.text)


@pytest.mark.anyio
async def test_the_agent_marks_speech_and_the_dry_run_lists_the_songs_speech_from_it(mcp, tmp_path):
    song_file, take_file = tmp_path / "song.wav", tmp_path / "take.wav"
    make(song_file, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    make(take_file, "-f", "lavfi", "-i", "sine=frequency=660:duration=3")
    song_item = await call(mcp, "add_asset", kind="media", path=str(song_file))
    take_item = await call(mcp, "add_asset", kind="media", path=str(take_file))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    # The episode Muted, so that its Words aren't speech: only the Take's span is.
    segments = [{"id": "e", "start": candidate["start"], "end": candidate["end"], "muted": True}]
    song_clip = {"id": "m", "media": song_item["id"], "start": 0.0, "secs": 1.5, "duck": -12}
    take_clip = {"id": "t", "media": take_item["id"], "start": 0.4, "secs": 0.6}
    edited = await call(mcp, "edit_candidate", **ids, changes={"segments": segments, "music": [song_clip, {**take_clip, "speech": True}]})
    assert [(clip["speech"], clip["duck"]) for clip in edited["music"]] == [(False, -12), (True, None)]
    # merge_candidate_items switches it off and on; with a duck it is refused.
    merged = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "t", "speech": False}])
    assert merged["music"][1]["speech"] is False
    refused = await fails(mcp, "merge_candidate_items", **ids, music=[{"id": "t", "speech": True, "duck": -12}])
    assert "Music Clip t is Speech, which is never ducked" in refused, refused
    merged = await call(mcp, "merge_candidate_items", **ids, music=[{"id": "t", "speech": True}])
    assert merged["music"][1]["speech"] is True

    plan = await call(mcp, "edit_candidate", **ids, changes={"music": merged["music"]}, dry_run=True)
    sounds = {sound["id"]: sound for sound in plan["sounds"]}
    # The Take is listed as speech; the song is ducked under its span, its ramps included.
    assert sounds["t"].get("speech") is True and "duck" not in sounds["t"]
    assert sounds["m"]["speech_spans"] == [[0.4, 1.0]]
    assert sounds["m"]["ducked"] == [[0.15, 1.5]]


# Seam A: the real ffmpeg


def test_a_song_is_12_db_quieter_mid_take_and_back_to_full_after_the_release(client, settings, video_source, plain_video, tones):
    """The episode Muted, so that only the Take is speech; a reference tone that nothing ducks is the
    measure, in the same window, so that the loudness pass cancels out: the song with the Take marked
    Speech against the song with it unmarked."""
    video_source.video = plain_video
    song_id, take_id, reference_id = (upload(client, tones[name], f"{name}.wav").json()["id"] for name in ("song", "take", "reference"))
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    segments = [{"id": "e", "start": candidate["start"], "end": candidate["end"], "muted": True}]
    under = [
        {"id": "m", "media": song_id, "start": 0.0, "secs": 4.0, "duck": -12},
        {"id": "r", "media": reference_id, "start": 0.0, "secs": 4.0, "duck": None},
    ]
    voice = {"id": "t", "media": take_id, "start": 1.0, "secs": 1.5, "duck": None}

    def rendered(speech: bool) -> Path:
        saved = patch(client, job, candidate, segments=segments, music=[*under, {**voice, "speech": speech}])
        return clip_of(client, settings, job, saved)

    def ratios(video: Path, times: tuple[float, ...]) -> list[float]:
        return [tone_level(settings, video, 880, at) / tone_level(settings, video, 440, at) for at in times]

    # Mid-Take; back to full 0.6 s after it ends, its release (0.5 s) over.
    times = (1.75, 3.1)
    ducked = ratios(rendered(True), times)
    full = ratios(rendered(False), times)
    middle, after = [20 * np.log10(down / up) for down, up in zip(ducked, full)]
    assert middle == pytest.approx(-12, abs=0.5)
    assert after == pytest.approx(0, abs=0.5)
