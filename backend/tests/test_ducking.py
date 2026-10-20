"""Ducking (.scratch/audio-mixing/issues/10-ducking-agent-render-preview.md, docs/adr/0016): a Music
Clip of a song or of a video's sound turned down by its depth while speech is heard. Speech is the
Words of the Source Segments and Music Clips of the Source that aren't Muted, where each plays on the
Timeline. Seam B on the planner's speech spans and the duck they make, then Seam A through the API,
MCP and the real ffmpeg. How loud a ducked sound is at a time is in the shared cases
(fixtures/gain_vectors.json, test_gain.py)."""

from pathlib import Path

import numpy as np
import pytest

from app.candidates import MusicClip, TransitionKind
from app.config import DuckTuning
from app.ducking import ducked_stretches
from app.planner import Join, MediaInfo, SegmentInput, gain_at, plan_render
from app.transcript import Word
from conftest import wait_for
from test_jobs_api import create_job
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

SONG = "ef" * 16
VIDEO = "ab" * 16
ITEMS = {SONG: MediaInfo(0, 0, 60.0, True), VIDEO: MediaInfo(640, 360, 60.0, True)}
# −20 dB: a tenth.
DEPTH = -20.0


def said(*spans: tuple[float, float]) -> list[Word]:
    return [Word("kata", start, end) for start, end in spans]


def song(**fields) -> MusicClip:
    """A ducked song under the whole Clip."""
    return MusicClip(**{"id": "m", "media": SONG, "start": 0.0, "secs": 30.0, "duck": DEPTH, **fields})


def speech(main_track: list[SegmentInput], music: list[MusicClip] | None = None, **planned) -> list[tuple[float, float]]:
    """The speech spans the ducked song `m` carries, in a Clip of `main_track`."""
    plan = plan_render(0, 1, SOURCE, main_track=main_track, music=[song(), *(music or [])], media_info=ITEMS, **planned)
    [ducked] = [event for event in plan.audio if event.id == "m"]
    assert ducked.duck == DEPTH
    return ducked.speech_spans


# Seam B: the speech spans


def test_a_source_segments_words_are_speech_where_they_play_at_its_speed_and_cut_at_a_transitions_middle():
    # 0 to 4 s into the Clip; a Word in it after the Transition's middle (3.5 s) is the next one's.
    first = SegmentInput(10, 14, words=said((1.0, 2.0), (3.0, 3.4), (3.6, 4.0)))
    # At 2×, from 3 s (a 1 s Transition overlaps the two): its first Word heard from 3.25 s, cut at
    # the Transition's middle, joined with the one before (0.1 s apart); its next from 5 to 5.5 s.
    second = SegmentInput(20, 26, words=said((0.5, 1.5), (4.0, 5.0)), speed=2, join=Join(TransitionKind.FADE, 1.0))
    assert speech([first, second]) == [(1.0, 2.0), (3.0, 3.75), (5.0, 5.5)]


def test_none_comes_from_a_muted_a_reversed_or_a_held_segment_nor_from_a_video():
    words = said((0.5, 1.5))
    assert speech([SegmentInput(10, 12, words=words)]) == [(0.5, 1.5)]
    for silent in (
        SegmentInput(10, 12, words=words, muted=True),
        SegmentInput(10, 12, words=words, reverse=True),
        SegmentInput(10, 10, words=words, hold=2.0),
        SegmentInput(0, 2, media=VIDEO, width=640, height=360, words=words),
    ):
        assert speech([silent]) == [], silent
    # A Muted one among others: only its own Words are left out.
    assert speech([SegmentInput(10, 12, words=words, muted=True), SegmentInput(20, 22, words=words)]) == [(2.5, 3.5)]


def test_spans_stay_joined_through_a_short_pause_and_not_through_a_long_one():
    assert speech([SegmentInput(10, 20, words=said((1.0, 2.0), (2.5, 3.0)))]) == [(1.0, 3.0)]
    assert speech([SegmentInput(10, 20, words=said((1.0, 2.0), (4.0, 5.0)))]) == [(1.0, 2.0), (4.0, 5.0)]
    plan = plan_render(0, 1, SOURCE, main_track=[SegmentInput(10, 20, words=said((1.0, 2.0), (4.0, 5.0)))], music=[song()], media_info=ITEMS)
    [ducked] = plan.audio
    tenth = 10 ** (DEPTH / 20)
    # Down through the 0.5 s pause; back up 0.5 s after the first Word, and down again from 0.25 s
    # before the next.
    assert [round(gain_at(ducked, time, plan.ducking), 6) for time in (1.5, 2.5, 3.0, 3.75, 4.5)] == [tenth, 1, 1, 1, tenth]


def test_speech_is_gathered_with_captions_off():
    main_track = [SegmentInput(10, 20, words=said((1.0, 2.0)))]
    plan = plan_render(0, 1, SOURCE, main_track=main_track, music=[song()], media_info=ITEMS, captioned=False)
    assert plan.captions == [] and plan.audio[0].speech_spans == [(1.0, 2.0)]
    assert plan_render(0, 1, SOURCE, main_track=main_track).captions != []
    # A Clip of one range too, its Words heard in it only (those of the margins aren't).
    whole = plan_render(10, 20, SOURCE, words=said((-1.0, -0.4), (1.0, 2.0), (9.8, 10.6)), music=[song()], media_info=ITEMS, captioned=False)
    assert whole.captions == [] and whole.audio[0].speech_spans == [(1.0, 2.0)]


def test_a_music_clip_of_the_sources_words_are_speech_where_it_plays_at_its_speed():
    main_track = [SegmentInput(10, 20)]
    # Its Words in seconds from its offset, as a Segment's from its start: those of its margins aren't heard.
    words = {"s": said((-0.5, -0.1), (0.5, 1.0), (1.8, 2.4))}
    detached = MusicClip("s", 3.0, 2.0, offset=100.0)
    assert speech(main_track, [detached], music_words=words) == [(3.5, 4.0)]
    # Moved 1 s later, it ducks 1 s later.
    assert speech(main_track, [MusicClip("s", 4.0, 2.0, offset=100.0)], music_words=words) == [(4.5, 5.0)]
    # At 2×, its 4 s read in 2 s.
    assert speech(main_track, [MusicClip("s", 3.0, 2.0, offset=100.0, speed=2)], music_words=words) == [(3.25, 4.2)]
    for silent in (MusicClip("s", 3.0, 2.0, offset=100.0, muted=True), MusicClip("s", 3.0, 2.0, offset=100.0, reverse=True)):
        assert speech(main_track, [silent], music_words=words) == [], silent


def test_a_ducked_sound_carries_the_spans_whose_ramps_reach_it_and_the_plan_its_ramps():
    main_track = [SegmentInput(10, 30, words=said((1.0, 2.0), (4.4, 4.6), (8.1, 9.0), (12.0, 13.0)))]
    plan = plan_render(0, 1, SOURCE, main_track=main_track, music=[song(start=5.0, secs=3.0)], media_info=ITEMS)
    # Its release reaches 5.1 s, past its start; the next's lead begins at 7.85 s, before its end.
    assert plan.audio[0].speech_spans == [(4.4, 4.6), (8.1, 9.0)]
    assert plan.ducking == DuckTuning(lead_secs=0.25, release_secs=0.5, bridge_secs=0.8)
    # Where it is turned down, ramps included, cut to it: what the dry run lists and the Timeline shades.
    assert plan.audio[0].ducked == [(5.0, 5.1), (7.85, 8.0)]


def test_the_ducked_stretches_are_joined_where_they_meet_and_cut_to_the_sound():
    # Spans as given (the planner's are joined already): overlapping, meeting, apart, and past either end.
    spans = [(2.0, 3.0), (0.5, 1.0), (3.2, 3.4), (5.0, 5.2), (9.9, 12.0)]
    assert ducked_stretches(spans, 1.0, 10.0, DuckTuning()) == [(1.0, 1.5), (1.75, 3.9), (4.75, 5.7), (9.65, 10.0)]
    assert ducked_stretches([(20.0, 21.0)], 1.0, 10.0, DuckTuning()) == []


def test_an_unducked_song_carries_no_speech_and_a_music_clip_of_the_source_refuses_a_duck():
    plan = plan_render(0, 1, SOURCE, main_track=[SegmentInput(10, 20, words=said((1.0, 2.0)))], music=[song(duck=None)], media_info=ITEMS)
    assert (plan.audio[0].duck, plan.audio[0].speech_spans) == (None, [])
    assert gain_at(plan.audio[0], 1.5) == 1
    with pytest.raises(ValueError, match="Music Clip s plays the episode's sound, which is never ducked"):
        MusicClip("s", 0.0, 2.0, duck=-12.0)


# Seam A: the API and MCP


@pytest.fixture(scope="session")
def tone(tmp_path_factory) -> bytes:
    """5 s of an 880 Hz tone: the song."""
    return make(tmp_path_factory.mktemp("ducking") / "tone.wav", "-f", "lavfi", "-i", "sine=frequency=880:sample_rate=44100:duration=5")


def test_a_new_song_ducks_at_minus_12_unless_the_edit_says_and_a_stored_one_stays_as_it_is(client, tone):
    song_id = upload(client, tone, "tone.wav").json()["id"]
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    added = {"id": "m", "media": song_id, "start": 0.0, "secs": 2.0}
    saved = patch(client, job, candidate, music=[added, {**added, "id": "n", "duck": None}, {**added, "id": "o", "duck": -6}])
    assert [clip["duck"] for clip in saved["music"]] == [-12, None, -6]
    # Sent again without `duck`, a Music Clip the Candidate has is as sent: a stored one isn't ducked.
    again = patch(client, job, saved, music=[added])
    assert again["music"][0]["duck"] is None
    # A draft's new song ducks in the preview too, under the Words.
    [event] = preview(client, job, again, {"music": [{**added, "id": "p"}]})["plan"]["audio"]
    assert event["duck"] == -12 and event["speech_spans"]

    for music, message in (
        ([{"id": "s", "start": 0, "secs": 1, "offset": 1.0, "duck": -12}], "Music Clip s plays the episode's sound, which is never ducked"),
        ([{**added, "duck": -31}], "greater than or equal to -30"),
        ([{**added, "duck": 0}], "less than or equal to -1"),
    ):
        response = client.patch(candidate_url(job, again), json={"music": music})
        assert response.status_code == 422 and message in response.text, (music, response.text)


def test_a_detached_videos_sound_added_without_a_duck_isnt_ducked(client, tmp_path):
    """A Detached sound is speech, a video's as well as the episode's: the new song's default skips it."""
    clip = make(
        tmp_path / "talk.mp4", "-f", "lavfi", "-i", "color=c=green:size=320x180:rate=30:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=1500:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest",
    )
    video = upload(client, clip, "talk.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "kabar")
    segments = [
        {"id": "e", "start": candidate["start"], "end": candidate["end"]},
        {"id": "v", "media": video["id"], "start": 0, "end": 2, "framing": {}, "muted": True},
    ]
    detached = {"id": "d", "media": video["id"], "start": 1.0, "secs": 2.0, "detached_from": "v"}
    saved = patch(client, job, candidate, segments=segments, music=[detached, {**detached, "id": "n", "detached_from": None}])
    assert [clip["duck"] for clip in saved["music"]] == [None, -12]


def test_with_captions_off_the_transcripts_words_duck_the_song(client, tone):
    song_id = upload(client, tone, "tone.wav").json()["id"]
    job = wait_for(client, create_job(client, captions=False)["id"], "review", "error")
    candidate = add(client, job, "halo", "Podcast")
    plan = preview(client, job, candidate, {"music": [{"id": "m", "media": song_id, "start": 0.0, "secs": 4.0}]})["plan"]
    assert plan["captions"] == []
    # halo to soal, then Podcast, back on the Source's timeline.
    spans = [[round(start + candidate["start"], 1), round(end + candidate["start"], 1)] for start, end in plan["audio"][0]["speech_spans"]]
    assert spans == [[0.1, 2.6], [4.0, 4.5]]


@pytest.mark.anyio
async def test_the_agent_ducks_switches_off_and_is_refused_a_duck_and_the_dry_run_lists_every_sound(mcp, tmp_path):
    song = tmp_path / "song.wav"
    make(song, "-f", "lavfi", "-i", "sine=frequency=330:duration=3")
    item = await call(mcp, "add_asset", kind="media", path=str(song))
    job = await reviewed_by_mcp(mcp)
    candidate = await manual(mcp, job, *HALO_KABAR)
    ids = {"job_id": job["id"], "candidate_id": candidate["id"]}
    added = {"id": "m", "media": item["id"], "start": 0.2, "secs": 1}
    merged = await call(mcp, "merge_candidate_items", **ids, music=[added, {**added, "id": "n", "duck": None}])
    assert [clip["duck"] for clip in merged["music"]] == [-12, None]
    # A change of another field keeps it; a depth sets it.
    assert (await call(mcp, "merge_candidate_items", **ids, music=[{"id": "m", "fade_in": 0.1}]))["music"][0]["duck"] == -12
    assert (await call(mcp, "merge_candidate_items", **ids, music=[{"id": "n", "duck": -20}]))["music"][1]["duck"] == -20
    # edit_candidate's whole list: a new one without it ducks.
    edited = await call(mcp, "edit_candidate", **ids, changes={"music": [{**added, "id": "e"}]})
    assert edited["music"][0]["duck"] == -12

    for music, message in (
        ([{"id": "s", "start": 0, "secs": 0.5, "offset": 1.0, "duck": -12}], "Music Clip s plays the episode's sound, which is never ducked"),
        ([{"id": "e", "duck": -31}], "greater than or equal to -30"),
    ):
        refused = await fails(mcp, "merge_candidate_items", **ids, music=music)
        assert message in refused, refused

    plan = await call(mcp, "edit_candidate", **ids, changes={"music": [{**added, "fade_out": 0.2}]}, dry_run=True)
    [sound] = plan["sounds"]
    assert {key: sound[key] for key in ("id", "start", "end", "fade_out", "duck")} == {"id": "m", "start": 0.2, "end": 1.2, "fade_out": 0.2, "duck": -12}
    # The Words run through the whole Clip: it is down all along.
    assert sound["ducked"] == [[0.2, 1.2]]


# Seam A: the real ffmpeg


def test_a_song_is_12_db_quieter_mid_sentence_and_back_to_full_half_a_second_after_the_last_word(client, settings, video_source, plain_video, tone):
    """The Source's own 440 Hz tone is the measure, in the same window, so that the loudness pass
    cancels out; a ducked render's song against an unducked one's, where the render's own Words
    (the plan's speech, once they are saved) say."""
    video_source.video = plain_video
    song_id = upload(client, tone, "tone.wav").json()["id"]
    job = reviewed(client)
    candidate = add(client, job, "halo", "Podcast")
    music = {"id": "m", "media": song_id, "start": 0.0, "secs": 4.0}

    def rendered(duck: float | None) -> tuple[dict, Path]:
        saved = patch(client, job, candidate, music=[{**music, "duck": duck}])
        return saved, clip_of(client, settings, job, saved)

    def ratios(video: Path, times: tuple[float, ...]) -> list[float]:
        """The song's level against the Source's at `times` (each render replaces the one before)."""
        return [tone_level(settings, video, 880, at) / tone_level(settings, video, 440, at) for at in times]

    saved, video = rendered(-12)
    [(said, ended), (again, _)] = preview(client, job, saved)["plan"]["audio"][0]["speech_spans"]
    # Mid-sentence; halfway up the release (0.225 to 0.275 s after the last Word); back to full,
    # before the next sentence's lead.
    times = ((said + ended) / 2, ended + 0.225, ended + 0.6)
    assert times[2] + 0.05 < again - 0.25
    ducked = ratios(video, times)
    full = ratios(rendered(None)[1], times)
    middle, release, after = [20 * np.log10(down / up) for down, up in zip(ducked, full)]
    assert middle == pytest.approx(-12, abs=0.5)
    low = 10 ** (-12 / 20)
    halfway = np.sqrt(np.mean(np.square([low + (1 - low) * (t - ended) / 0.5 for t in np.linspace(times[1], times[1] + 0.05, 101)])))
    # On a slope, the volume set per 10 ms block and the encode's few ms of delay count: within 1 dB.
    assert release == pytest.approx(20 * np.log10(halfway), abs=1)
    assert after == pytest.approx(0, abs=0.5)
