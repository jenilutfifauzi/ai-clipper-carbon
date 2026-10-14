"""Seam A: Selection through the HTTP API, with a fake LLM answering in the response schemas.

Most tests use the 62-minute episode from conftest, whose Word timings are known: line k starts
at 4k s and is followed by 1 s of silence, so its first Word can take the whole 0.35 s lead-in
and its last Word the whole 0.45 s tail. Inside a line the Words touch, so there's no room for
either.
"""

import json
import math
import re

import pytest

from app.llm import QuotaExceeded, TransientLlmError
from app.prompts import PROMPT_VERSION
from conftest import FILLER, FIXTURES, caption_track
from fakes import windows_in
from test_jobs_api import create_job, statuses

DETAIL_RESPONSE = json.loads((FIXTURES / "detail_response.json").read_text())


def clip(start: str, end: str, predicted_score: int = 70, **fields) -> dict:
    """A Detail-pass clip as Gemini writes it."""
    return {
        "window_id": "w001",
        "start": start,
        "end": end,
        "reason": "A concrete confession lands in the first two seconds.",
        "emotion": "relatable",
        "hook_strength": 70,
        "retention_notes": "The open question holds viewers until the answer at the end.",
        "predicted_score": predicted_score,
        "viral_hook_text": "Ini yang nggak pernah dibahas",
        "title": "Hal yang Jarang Dibahas Soal Kerja",
        "tiktok_description": "Jarang ada yang mau ngomongin ini. Dengerin sampai habis.",
        "instagram_description": "Satu hal soal kerja yang jarang dibahas terang-terangan.",
        "shorts_description": "Hal yang jarang dibahas soal kerja.",
        "hashtags": ["#podcastindonesia", "#kerja"],
    } | fields


def analyzed(client, wait_for_status, **options) -> dict:
    job = wait_for_status(create_job(client, **options)["id"], "review", "error")
    assert job["status"] == "review", job["error"]
    return job


def spans(job: dict) -> list[tuple[float, float]]:
    return [(candidate["start"], candidate["end"]) for candidate in job["candidates"]]


def seconds(label: str) -> int:
    parts = [int(part) for part in label.split(":")]
    return parts[-1] + 60 * parts[-2] + 3600 * (parts[0] if len(parts) == 3 else 0)


def label(time: float) -> str:
    whole = int(time)
    return f"{whole // 3600}:{whole // 60 % 60:02}:{whole % 60:02}" if whole >= 3600 else f"{whole // 60}:{whole % 60:02}"


def test_job_reaches_review_with_candidates_ranked_by_predicted_score(client, from_episode, llm, wait_for_status):
    llm.clips = DETAIL_RESPONSE["clips"]
    job = analyzed(client, wait_for_status)

    assert statuses(job) == ["queued", "downloading", "transcribing", "analyzing", "review"]
    assert (job["stage"], job["progress"], job["message"]) == (None, None, None)
    assert job["prompt_version"] == PROMPT_VERSION
    # 62 minutes make a target of 7: the two weakest of the 9 proposals are left out.
    proposed = sorted(DETAIL_RESPONSE["clips"], key=lambda clip: clip["predicted_score"], reverse=True)
    assert [candidate["predicted_score"] for candidate in job["candidates"]] == [c["predicted_score"] for c in proposed[:7]]

    best = job["candidates"][0]
    assert re.fullmatch(r"[0-9a-f]{8}", best["id"])
    assert len({candidate["id"] for candidate in job["candidates"]}) == 7
    assert best == {
        "id": best["id"],
        # 11:56 is line 179's label: its first Word less the lead-in. 12:52 is the line after the
        # clip's last, which ends at 771 s: plus the tail.
        "start": 715.65,
        "end": 771.45,
        "predicted_score": 92,
        "hook_strength": 90,
        "emotion": "shocking",
        "reason": "Opens on a concrete half-billion-rupiah loss confession, with the hard lesson as payoff.",
        "retention_notes": "The loss is stated up front; viewers stay to learn which decision caused it. "
        "Payoff lands at the end.",
        "hook_text": "Gue pernah rugi 500 juta",
        "title": "Rugi 500 Juta Gara-Gara Satu Keputusan Bodoh",
        "descriptions": {
            "tiktok": "Satu keputusan, setengah miliar melayang. Pelajarannya mahal banget.",
            "instagram": "Dia pernah rugi 500 juta cuma karena satu keputusan. Ini yang dia pelajari dari situ.",
            "shorts": "Kisah rugi 500 juta dan pelajaran yang nggak diajarin di sekolah.",
        },
        "hashtags": ["#podcastindonesia", "#bisnis", "#keuangan", "#pelajaranhidup"],
        "window_id": "w007",
        "window_score": 50,
        "origin": "ai",
        "layout": "auto",
        "selected": False,
        "edited": False,
        "preset_id": "default",
        "style_overrides": {"caption": {}, "hook": {}},
    }
    assert client.get(f"/api/jobs/{job['id']}").json()["candidates"] == job["candidates"]


@pytest.mark.parametrize(("long", "count"), [(False, 3), (True, 7)])
def test_target_count_is_one_per_9_minutes_and_at_least_3(client, llm, request, wait_for_status, long, count):
    if long:
        request.getfixturevalue("from_episode")  # 62 minutes; the default Source is 2 s
    analyzed(client, wait_for_status)

    [detail] = llm.detail_requests
    assert f"\nCLIP_COUNT: {count}\n" in detail.prompt
    assert "add up to 2 spare clips" in detail.prompt


@pytest.mark.parametrize(("max_secs", "window_secs"), [(90, 135), (50, 90)])
def test_score_pass_scores_overlapping_windows_in_batches_of_at_most_8(
    client, from_episode, llm, wait_for_status, max_secs, window_secs
):
    job = analyzed(client, wait_for_status, max_secs=max_secs)

    assert {request.temperature for request in llm.score_requests} == {0.2}
    batches = [windows_in(request.prompt) for request in llm.score_requests]
    sizes = [len(batch) for batch in batches]
    windows = [window for batch in batches for window in batch]
    assert len(batches) == math.ceil(len(windows) / 8)
    assert max(sizes) <= 8 and max(sizes) - min(sizes) <= 1
    assert [id for id, *_ in windows] == [f"w{i:03}" for i in range(1, len(windows) + 1)]

    # Each Window is whole Words, as long as fits in window_secs, and starts at the first Word
    # less than 30 s before the previous one ends. The labels are rounded down to the second, and
    # a line's silence can fall at a Window's edge, so the checks allow for that.
    words = " ".join(word["text"] for word in job["transcript"]["words"])
    assert all(f" {text} " in f" {words} " for *_, text in windows)
    times = [(seconds(start), seconds(end)) for _, start, end, _ in windows]
    assert times[0][0] == 0
    assert times[-1][1] == job["transcript"]["words"][-1]["end"]
    assert all(window_secs - 3 <= end - start <= window_secs for start, end in times)
    assert all(27 <= end - next_start <= 31 for (_, end), (next_start, _) in zip(times[:-2], times[1:-1]))


def test_detail_pass_reads_the_full_transcript_and_the_best_scoring_windows(client, from_episode, llm, wait_for_status):
    marks = {"rugi": 95, "rahasia": 85, "nangis": 75}
    llm.score_window = lambda text: max([score for word, score in marks.items() if word in text], default=30)
    job = analyzed(client, wait_for_status)

    scores = {id: llm.score_window(text) for r in llm.score_requests for id, *_, text in windows_in(r.prompt)}
    [detail] = llm.detail_requests
    assert detail.temperature == 0.9
    shortlist = re.findall(r"^- (w\d+) \[", detail.prompt, re.M)
    assert len(shortlist) == 2 * 7
    assert shortlist == sorted(shortlist)
    assert {id for id, score in scores.items() if score > 30} <= set(shortlist)
    assert min(scores[id] for id in shortlist) >= max(score for id, score in scores.items() if id not in shortlist)

    lines = "\n".join(f"[{label(segment['start'])}] {segment['text']}" for segment in job["transcript"]["segments"])
    assert f"\nFULL TRANSCRIPT:\n{lines}\n" in detail.prompt
    assert "\n[59:56] " in detail.prompt and "\n[1:00:00] " in detail.prompt
    assert "\nCLIP_DURATION: 20–90 seconds\n" in detail.prompt


def test_proposed_times_are_snapped_to_word_boundaries(client, from_episode, llm, wait_for_status):
    llm.clips = [
        clip("10:00", "10:44", 80),  # line labels, as the prompt asks for
        clip("20:01.2", "20:40.7", 75),  # times inside lines
        clip("1:00:00", "1:00:40", 70),  # labels past the first hour
        clip("30:02.6", "30:44", 65),  # a start on a line's last Word
    ]
    job = analyzed(client, wait_for_status)

    assert spans(job) == [
        # From the first Word of the line labelled 10:00, less the lead-in, to the last Word
        # before the line labelled 10:44, plus the tail.
        (599.65, 643.45),
        # The Word starting nearest 1201.2 s: its neighbour touches it, so a lead-in would cut into
        # that, and the next sentence (after the line's silence) starts 3 s later, too far to
        # take the start for a fragment. The Word ending nearest 1240.7 s is in mid-sentence: the
        # end moves on to the end of its line, 2.5 s later, plus the tail.
        (1201.0, 1243.45),
        (3599.65, 3639.45),
        # The Word starting nearest 1802.6 s is its line's last: a fragment, as the next line
        # starts 1.5 s later, after a silence. The clip starts there, less the lead-in.
        (1803.65, 1843.45),
    ]
    words = job["transcript"]["words"]
    assert not any(word["start"] < edge < word["end"] for word in words for span in spans(job) for edge in span)


def test_a_line_label_means_the_line_it_labels(client, video_source, episode, llm, tmp_path, wait_for_status):
    # Each line starts 0.9 s after its label, so the Word starting nearest the label is the last
    # Word of the line before.
    video_source.video = episode.video
    lines = [(4 * k + 0.9, FILLER[k % len(FILLER)]) for k in range(60)]
    video_source.caption_track = caption_track(tmp_path / "late-lines.json3", lines)
    llm.clips = [clip("0:20", "0:48")]
    job = analyzed(client, wait_for_status)

    # From line 20.9 s, less the lead-in, to the end of the line before 48.9 s, plus the tail.
    assert spans(job) == [(20.55, 48.35)]


def test_overlapping_candidates_keep_the_higher_predicted_score(client, from_episode, llm, wait_for_status):
    llm.clips = [
        clip("15:00", "15:52", 70, title="A"),
        clip("15:32", "16:20", 88, title="B"),  # shares 15:32–15:52 with A
        clip("30:00", "30:40", 60, title="C"),
        clip("30:48", "31:28", 65, title="D"),  # 9 s after C ends
    ]
    job = analyzed(client, wait_for_status)

    assert [candidate["title"] for candidate in job["candidates"]] == ["B", "D", "C"]
    _, (d_start, _), (_, c_end) = spans(job)
    assert c_end <= d_start


def test_of_back_to_back_or_same_topic_candidates_only_the_better_is_kept(client, from_episode, llm, wait_for_status):
    llm.clips = [
        clip("15:00", "15:52", 70, title="A", topic="Losing money on a deal"),
        clip("15:52", "16:40", 80, title="B", topic="Hiring friends"),  # 1 s of silence after A
        clip("30:00", "30:40", 60, title="C", topic="Hiring your friends is a mistake"),  # B's topic
        clip("45:00", "45:40", 65, title="D", topic="Why the podcast almost ended"),
        # One word of 3 in common with B's topic.
        clip("50:00", "50:40", 55, title="E", topic="Friends who become rivals"),
    ]
    job = analyzed(client, wait_for_status)

    assert [candidate["title"] for candidate in job["candidates"]] == ["B", "D", "E"]


def test_out_of_range_durations_are_fitted_at_word_boundaries_or_dropped(client, from_episode, llm, wait_for_status):
    llm.clips = [
        clip("5:00", "5:24", 80, title="6 s too short"),
        clip("40:00", "41:12", 75, title="12 s too long"),
        clip("50:00", "50:08", 90, title="22 s too short"),
        clip("55:00", "57:00", 85, title="60 s too long"),
        # Overlaps "60 s too long", which is dropped before it can push this one out.
        clip("55:40", "56:20", 50, title="inside the dropped one"),
    ]
    job = analyzed(client, wait_for_status, min_secs=30, max_secs=60)

    assert [(candidate["title"], candidate["start"], candidate["end"]) for candidate in job["candidates"]] == [
        # Words added after the end until it lasts 30 s: 299.65 to the Word ending at 330 s.
        ("6 s too short", 299.65, 330.0),
        # Words taken off the end until it lasts at most 60 s: the line ending at 2459 s, plus the tail.
        ("12 s too long", 2399.65, 2459.45),
        ("inside the dropped one", 3339.65, 3379.45),
    ]


def touching_lines(tmp_path, lines: dict[int, str], count: int = 70):
    """A Source whose caption lines start every 3 s and run into each other, like YouTube's: the
    Words touch, so only punctuation can end a sentence. `lines` replaces lines by number."""
    lines = [(3 * k, lines.get(k, FILLER[k % len(FILLER)])) for k in range(count)]
    return caption_track(tmp_path / "touching.json3", lines)


def test_quoted_opening_and_closing_words_place_the_edges(
    client, video_source, episode, llm, tmp_path, wait_for_status
):
    video_source.video = episode.video
    video_source.caption_track = touching_lines(
        tmp_path, {10: "gue pernah rugi lima ratus juta", 20: "dan itu pelajaran paling mahal gue"}
    )
    llm.clips = [
        # Quotes inside lines, written with other capitals and punctuation.
        clip("0:30", "1:03", 80, opening_words="Rugi lima ratus juta,", closing_words="itu pelajaran paling mahal"),
        # A quote of a line said every 18 s: the match nearest the proposed time.
        clip("2:00", "2:30", 75, opening_words="dipikir pikir emang aneh ya"),
        # A quote that isn't there: the label decides.
        clip("3:00", "3:30", 70, opening_words="kata yang tidak pernah diucapkan"),
    ]
    job = analyzed(client, wait_for_status)

    # The Words touch, so there is no lead-in or tail, except after the last Word.
    assert spans(job) == [(31.0, 62.5), (120.5, 150.0), (180.0, 210.45)]


def test_edges_are_moved_to_whole_sentences(client, video_source, episode, llm, tmp_path, wait_for_status):
    video_source.video = episode.video
    video_source.caption_track = touching_lines(
        tmp_path,
        {
            10: "terus kita pulang. Gue pernah rugi",
            20: "itu pelajaran paling mahal buat",
            21: "gue. oke kita lanjut ke topik",
            47: "dan itu yang bikin gue sadar.",
        },
    )
    llm.clips = [
        # Opens on a sentence's tail, and stops a Word short of its last sentence's end.
        clip("0:30", "1:03", 80),
        # 63 s, too long: cut at its last sentence end, at 144 s, not at the last Word that fits, at 150 s.
        clip("1:30", "2:33", 75),
        # Opens in mid-sentence with no sentence starting near: it stays.
        clip("3:00", "3:30", 70),
    ]
    job = analyzed(client, wait_for_status, min_secs=20, max_secs=60)

    assert spans(job) == [(31.5, 63.5), (90.0, 144.0), (180.0, 210.45)]


def test_quoted_edges_move_for_punctuation_but_not_for_pauses(
    client, video_source, episode, llm, tmp_path, wait_for_status
):
    video_source.video = episode.video
    video_source.caption_track = touching_lines(tmp_path, {10: "terus kita pulang. Gue pernah rugi"})
    llm.clips = [clip("0:30", "1:03", 80, opening_words="kita pulang. Gue pernah rugi")]
    job = analyzed(client, wait_for_status)

    # The quote opens on a sentence's tail: the clip starts at "Gue".
    assert spans(job)[0][0] == 31.5


def test_quoted_edges_are_kept_at_pauses(client, from_episode, llm, wait_for_status):
    # The same edges as test_proposed_times_are_snapped_to_word_boundaries' last clip, which moved
    # to the next line, but quoted: a start on a line's last Word, an end inside a line.
    llm.clips = [
        clip("30:02.6", "30:46", 80, opening_words="gue jadi waktu itu kita", closing_words="oke kita lanjut")
    ]
    job = analyzed(client, wait_for_status)

    assert spans(job) == [(1802.5, 1845.5)]


def test_a_closing_quote_is_found_before_a_long_silence(
    client, video_source, episode, llm, tmp_path, wait_for_status
):
    # Nothing is said from 63 s to 120 s, so the line after the clip is labelled 2:00.
    video_source.video = episode.video
    lines = [(3 * k, FILLER[k % len(FILLER)]) for k in range(21)]
    lines += [(120 + 3 * k, FILLER[k % len(FILLER)]) for k in range(20)]
    lines[20] = (60, "dan itu pelajaran paling mahal gue")
    video_source.caption_track = caption_track(tmp_path / "silence.json3", lines)
    llm.clips = [clip("0:30", "2:00", 80, closing_words="itu pelajaran paling mahal")]
    job = analyzed(client, wait_for_status)

    assert spans(job) == [(30.0, 62.5)]


def test_the_detail_transcript_has_a_line_per_sentence(client, video_source, episode, llm, tmp_path, wait_for_status):
    video_source.video = episode.video
    video_source.caption_track = touching_lines(tmp_path, {10: "terus kita pulang. Gue pernah rugi"})
    analyzed(client, wait_for_status)

    # A sentence starts at "Gue", inside a caption line. Without punctuation, lines run on to the
    # first caption line starting 12 s or more after them.
    [detail] = llm.detail_requests
    lines = re.findall(r"^\[(\d+:\d\d)\] (.*)$", detail.prompt, re.M)
    assert [start for start, _ in lines[:6]] == ["0:00", "0:12", "0:24", "0:31", "0:45", "0:57"]
    assert lines[2][1] == f"{FILLER[2]} {FILLER[3]} terus kita pulang."
    assert lines[3][1].startswith("Gue pernah rugi ")


def test_transient_llm_errors_are_retried(client, from_episode, llm, wait_for_status):
    llm.fail_with(TransientLlmError("Gemini is unavailable. 503 UNAVAILABLE: The model is overloaded."), times=2)
    llm.clips = [clip("10:00", "10:44")]
    job = analyzed(client, wait_for_status)

    first, second, third, *_ = llm.score_requests
    assert first == second == third
    assert len(llm.score_requests) == len({request.prompt for request in llm.score_requests}) + 2
    assert spans(job) == [(599.65, 643.45)]


@pytest.mark.parametrize(
    ("error", "times", "message"),
    [
        (
            TransientLlmError("Gemini is unavailable. 503 UNAVAILABLE: The model is overloaded."),
            5,
            "Gave up after 5 attempts: Gemini is unavailable. 503 UNAVAILABLE: The model is overloaded.",
        ),
        # With no time left to wait for the quota, the first quota error fails the Job.
        pytest.param(
            QuotaExceeded("Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: Quota exceeded."),
            1,
            "Gave up after waiting 0 s for Gemini's quota. "
            "Gemini's quota is used up; try again later. 429 RESOURCE_EXHAUSTED: Quota exceeded.",
            marks=pytest.mark.quota(give_up_secs=0),
        ),
    ],
)
def test_llm_errors_that_persist_put_the_job_in_error(client, llm, wait_for_status, error, times, message):
    llm.fail_with(error, times)
    job = wait_for_status(create_job(client)["id"], "review", "error")

    assert (job["status"], job["stage"], job["error"]) == ("error", "analyzing", message)
    assert len(llm.score_requests) == times
    assert job["candidates"] is None
