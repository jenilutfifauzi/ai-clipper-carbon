"""The caption files writer (pure): a plan's Cues as SRT and VTT."""

from app.caption_files import CaptionFormat, caption_file
from app.planner import Box, CaptionWord, Cue, CueKey

LOWER = Box(130, 1296, 820, 200)
TOP = Box(130, 430, 820, 200)


def cue(start: float, end: float, plain: list[str], at: float, area: Box = LOWER) -> Cue:
    """A Cue showing `plain` (its lines), drawn in UPPERCASE as a Caption Style would."""
    lines = [[CaptionWord(word.upper().strip(",.!?"), start, end) for word in line.split()] for line in plain]
    return Cue(start, end, lines, plain, area, 80, CueKey(at))


CUES = [
    cue(0.5, 2.25, ["Jadi, gue pernah", "rugi lima ratus juta."], 10.7),
    cue(2.25, 3.0, ["Serius?"], 12.6),
    # Past an hour, as a Clip never is, but the format is.
    cue(3725.004, 3727.9996, ["iPhone & <MacBook>"], 3735.1),
]


def test_srt_numbers_each_cue_with_its_shown_times_and_plain_lines():
    assert caption_file(CUES, CaptionFormat.SRT) == (
        "1\n"
        "00:00:00,500 --> 00:00:02,250\n"
        "Jadi, gue pernah\n"
        "rugi lima ratus juta.\n"
        "\n"
        "2\n"
        "00:00:02,250 --> 00:00:03,000\n"
        "Serius?\n"
        "\n"
        "3\n"
        "01:02:05,004 --> 01:02:08,000\n"
        "iPhone & <MacBook>\n"
    )


def test_vtt_has_its_header_dotted_times_and_escaped_text():
    assert caption_file(CUES, CaptionFormat.VTT) == (
        "WEBVTT\n"
        "\n"
        "1\n"
        "00:00:00.500 --> 00:00:02.250\n"
        "Jadi, gue pernah\n"
        "rugi lima ratus juta.\n"
        "\n"
        "2\n"
        "00:00:02.250 --> 00:00:03.000\n"
        "Serius?\n"
        "\n"
        "3\n"
        "01:02:05.004 --> 01:02:08.000\n"
        "iPhone &amp; &lt;MacBook&gt;\n"
    )


def test_a_cue_moved_at_a_layout_change_is_one_subtitle_cue():
    # Two plan entries with one key, the second starting where the first ends; then a Cue with the
    # same key later on (a repeated piece of the Source), which is a cue of its own.
    moved = [
        cue(1.0, 1.8, ["halo semua"], 4.2),
        cue(1.8, 2.6, ["halo semua"], 4.2, TOP),
        cue(2.6, 3.4, ["apa kabar"], 5.0, TOP),
        cue(5.0, 5.8, ["halo semua"], 4.2),
    ]
    assert caption_file(moved, CaptionFormat.SRT) == (
        "1\n00:00:01,000 --> 00:00:02,600\nhalo semua\n\n"
        "2\n00:00:02,600 --> 00:00:03,400\napa kabar\n\n"
        "3\n00:00:05,000 --> 00:00:05,800\nhalo semua\n"
    )


def test_no_cues_make_an_empty_file():
    assert caption_file([], CaptionFormat.SRT) == ""
    assert caption_file([], CaptionFormat.VTT) == "WEBVTT\n"
