"""Media Words: a video from the Media Library, placed as a Segment, captioned from its own Words
(.scratch/captions-advanced/issues/04-tracer-media-words-caption-media-segments.md, ADR 0020).

Seam B on the planner and candidate_plan, then Seam A through the API, the FakeTranscriber and the
real ffmpeg.
"""

from dataclasses import replace

import numpy as np

from app.candidates import Framing, Segment, TransitionKind, WordEdit, manual_candidate
from app.config import CameraTuning
from app.planner import LOWER_CAPTIONS, TOP_CAPTIONS, Join, SegmentInput, plan_render
from app.rendering import candidate_plan
from app.styles import CaptionPosition, CaptionStyle, PresetStore
from app.transcript import Word
from app.video_source import SourceMetadata
from conftest import cue_text
from test_media_library import upload
from test_media_segments import INTRO, Library, clips  # noqa: F401
from test_render import add, full_frame, pixels, preview, render, rendered, reviewed
# The Source Seam A renders from (from_render_video makes render_video every test's).
from test_render import from_render_video, render_video  # noqa: F401
from test_review import patch

SOURCE = SourceMetadata(duration=600, fps=30.0, width=1920, height=1080, codec="h264")
# What the red video of `clips` says (in seconds into it), as the FakeTranscriber hears it.
SAID = [Word("halo", 0.5, 0.9), Word("semua", 0.9, 1.3)]


def talking(start: float, end: float, words: list[Word], **given) -> SegmentInput:
    """A Segment of the INTRO video (720x1280) from `start` to `end` seconds into it, heard saying
    `words` (in seconds into the Segment, as candidate_plan gives a Segment its Words)."""
    return SegmentInput(start, end, media=INTRO, width=720, height=1280, words=words, **given)


def cues(*main_track: SegmentInput, style: CaptionStyle = CaptionStyle()) -> list[tuple[str, float, float, float, str | None]]:
    planned = plan_render(10, 20, SOURCE, main_track=list(main_track), caption_style=style)
    return [(cue.text, cue.start, cue.end, cue.key.at, cue.key.media) for cue in planned.captions]


# Seam B: planning a media Segment's Words.


def test_a_media_segments_words_are_captioned_and_keyed_on_its_items_timeline():
    words = [Word("halo", 1.0, 1.4), Word("semua.", 1.4, 2.0), Word("apa", 3.0, 3.4)]
    assert cues(talking(0.5, 4.0, words)) == [
        ("HALO SEMUA", 1.0, 2.3, 1.7, INTRO),
        ("APA", 3.0, 3.5, 3.7, INTRO),
    ]


def test_a_media_segment_at_2x_has_its_cues_at_half_the_items_times():
    words = [Word("halo", 1.0, 1.4), Word("apa", 3.0, 3.4)]
    # At 2x, 4 s of the video play in 2 s of the Timeline; the keys stay on the item's timeline.
    assert [(text, start, at) for text, start, _, at, _ in cues(talking(0.0, 4.0, words, speed=2.0))] == [
        ("HALO", 0.5, 1.2),
        ("APA", 1.5, 3.2),
    ]


def test_a_reversed_media_segment_and_a_freeze_frame_of_one_have_no_cues():
    words = [Word("halo", 1.0, 1.4)]
    assert cues(talking(0.0, 2.0, words, reverse=True)) == []
    assert cues(talking(1.2, 1.2, words, hold=2.0)) == []


def test_cues_break_at_a_media_segments_joins_and_transitions():
    intro = talking(0.0, 2.0, [Word("halo", 1.5, 1.9)])
    episode = SegmentInput(10.0, 12.0, words=[Word("kawan", 0.1, 0.4)])
    # Back to back, HALO and KAWAN would fit one line: the join parts them.
    assert [cue[:2] for cue in cues(intro, episode)] == [("HALO", 1.5), ("KAWAN", 2.1)]
    # Through a 0.5 s Transition (from 1.5 s to 2 s), HALO ends at its middle.
    faded = replace(episode, words=[Word("kawan", 0.4, 0.8)], join=Join(TransitionKind.FADE, 0.5))
    assert [cue[:3] for cue in cues(intro, faded)][0] == ("HALO", 1.5, 1.75)
    assert [cue[:2] for cue in cues(intro, faded)][1] == ("KAWAN", 1.9)


def test_a_media_segments_scenes_are_captioned_at_the_caption_styles_position_auto_in_the_lower_third():
    words = [Word("halo", 0.2, 0.6)]
    [auto] = plan_render(0, 2, SOURCE, main_track=[talking(0.0, 2.0, words)]).captions
    assert (auto.area.y, auto.area.height) == (LOWER_CAPTIONS.y, LOWER_CAPTIONS.height)
    top = CaptionStyle(position=CaptionPosition.TOP)
    [placed] = plan_render(0, 2, SOURCE, main_track=[talking(0.0, 2.0, words)], caption_style=top).captions
    assert placed.area.y == TOP_CAPTIONS.y


def test_candidate_plan_captions_a_media_segment_with_its_media_words_and_no_source_word_edit_touches_them(tmp_path):
    candidate = replace(
        manual_candidate("c1", 10, 12),
        segments=[Segment("i", 0, 2, media=INTRO, framing=Framing()), Segment("e", 10, 12)],
        # At 0.7 s of the Source: the time of the intro's Word on its own timeline.
        word_edits=[WordEdit(at=0.7, text="dunia")],
    )
    words = [[Word("halo", 0.5, 0.9)], [Word("kawan", 0.5, 0.9)]]
    planned = candidate_plan(candidate, SOURCE, words, [None, None], PresetStore(tmp_path / "presets.json"), CameraTuning(), media=Library())
    assert [(cue.text, cue.start, cue.key.at, cue.key.media) for cue in planned.captions] == [
        ("HALO", 0.5, 0.7, INTRO),
        ("KAWAN", 2.5, 10.7, None),
    ]


# Seam A: Media Words through the API, the FakeTranscriber and the real ffmpeg.


def talking_candidate(client, job: dict, media_id: str, end: float = 1.5) -> dict:
    """A Candidate of the red video (from 0 to `end` s into it) and then "halo" to "semua" of the episode."""
    candidate = add(client, job, "halo", "semua")
    return patch(client, job, candidate, segments=[
        {"id": "i", "start": 0, "end": end, "media": media_id, "framing": {}},
        {"id": "e", "start": candidate["start"], "end": candidate["end"]},
    ])


def prepare(client, job: dict, candidate: dict) -> dict:
    response = client.post(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/prepare")
    assert response.status_code == 202, response.text
    return response.json()


def test_preparing_a_candidate_transcribes_its_talking_media_segment_and_captions_it(client, settings, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])

    # Nothing is known of the video yet: its Segment has no Cues, and the episode's shows the Transcript's.
    before = preview(client, job, candidate)
    assert before["words_status"] == {"i": "none", "e": "transcript"}
    assert all(cue["start"] >= 1.5 for cue in before["plan"]["captions"])

    # Prepared: the video's Media Words are on their way, then there, and its Segment is captioned
    # from them in Timeline time, each Cue keyed on the video's own timeline.
    transcriber.hold()
    assert prepare(client, job, candidate)["status"] == "rendering"
    assert preview(client, job, candidate)["words_status"] == {"i": "pending", "e": "transcript"}
    # Its caption files would be missing the video's Cues, so they are refused until it is heard.
    refused = client.get(f"/api/jobs/{job['id']}/candidates/{candidate['id']}/captions/srt")
    assert refused.status_code == 409 and "transcribed" in refused.json()["detail"]
    transcriber.release()
    rendered(client, job)
    ready = preview(client, job, candidate)
    assert ready["words_status"] == {"i": "media", "e": "clip"}
    [intro, *episode] = ready["plan"]["captions"]
    assert (cue_text(intro), intro["start"], intro["end"], intro["key"]) == ("HALO SEMUA", 0.5, 1.5, {"at": 0.7, "media": red["id"]})
    assert episode and all(cue["key"]["media"] is None for cue in episode)
    # The video was transcribed whole, once, in the Job's language, and the episode's range as before.
    assert transcriber.calls_for(red["id"]) == 1 and transcriber.calls_for("source") == 1
    assert ("id", 0.0, red["duration"]) in transcriber.calls
    [kept] = (settings.data_dir / "media" / f"{red['id']}.words").iterdir()
    assert kept.suffix == ".json" and kept.name.startswith("id-")


def test_trimming_the_segment_or_placing_the_item_in_another_candidate_or_job_doesnt_transcribe_it_again(client, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    prepare(client, job, candidate)
    rendered(client, job)
    assert transcriber.calls_for(red["id"]) == 1

    # Trimmed to its second half: still captioned, from the same Media Words, with nothing to prepare.
    episode = candidate["segments"][1]
    trimmed = patch(client, job, candidate, segments=[{"id": "i", "start": 0.8, "end": 1.5, "media": red["id"], "framing": {}}, episode])
    assert prepare(client, job, trimmed)["status"] == "review"
    shown = preview(client, job, trimmed)
    assert shown["words_status"]["i"] == "media"
    assert [cue_text(cue) for cue in shown["plan"]["captions"] if cue["key"]["media"]] == ["SEMUA"]

    # In a second Candidate of the Job, and in a Candidate of another Job in the same language.
    second = talking_candidate(client, job, red["id"])
    other_job = reviewed(client)
    other = talking_candidate(client, other_job, red["id"])
    for job_of, placed in ((job, second), (other_job, other)):
        prepare(client, job_of, placed)
        rendered(client, job_of)
        assert preview(client, job_of, placed)["words_status"]["i"] == "media"
    assert transcriber.calls_for(red["id"]) == 1


def test_a_render_transcribes_the_missing_media_words_first_and_captions_the_media_segment(
    client, settings, transcriber, clips,
):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    render(client, job)
    [clip] = rendered(client, job, timeout=60)["clips"]
    assert clip["status"] == "done", clip["error"]
    assert transcriber.calls_for(red["id"]) == 1

    # "HALO SEMUA" over the red video, in white, in the lower third (Auto).
    [intro, *_] = preview(client, job, candidate)["plan"]["captions"]
    assert intro["key"]["media"] == red["id"]
    frame = full_frame(settings, settings.data_dir / "jobs" / job["id"] / clip["output"]["video"], 1.0)
    rows, _ = pixels(frame, np.array([255, 255, 255]))
    assert len(rows) > 500
    assert rows.min() >= intro["area"]["y"] - 20 and rows.max() <= intro["area"]["y"] + intro["area"]["height"] + 20


def test_deleting_an_unused_item_deletes_its_media_words(client, settings, transcriber, clips):
    red = upload(client, clips["red"], "red.mp4").json()
    transcriber.heard[red["id"]] = SAID
    job = reviewed(client)
    candidate = talking_candidate(client, job, red["id"])
    prepare(client, job, candidate)
    rendered(client, job)
    folder = settings.data_dir / "media" / f"{red['id']}.words"
    assert folder.is_dir()

    # Used: kept. Unused: deleted, with its Media Words.
    assert client.delete(f"/api/media/{red['id']}").status_code == 409
    assert folder.is_dir()
    patch(client, job, candidate, segments=[candidate["segments"][1]])
    assert client.delete(f"/api/media/{red['id']}").status_code == 204
    assert not folder.exists()
