"""The Reference Set file: the entries it accepts, and a line-specific error for each problem."""

import pytest

from app.references import EXAMPLE, Reference, ReferenceSetError, load_reference_set

EPISODE = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"


def write(tmp_path, text: str):
    path = tmp_path / "references.yaml"
    path.write_text(text)
    return path


def test_entries_hold_url_start_end_note_and_role_grouped_by_episode_across_url_forms(tmp_path):
    forms = [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
        "http://m.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
        "www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ?si=Xy12&t=42",
        "https://www.youtube.com/live/dQw4w9WgXcQ?si=Xy12",
        "https://www.youtube.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
    ]
    times = [("12:34", "13:20"), ('"0:05"', "45.5"), ("1:02:03", "1:03:10.5"), ("754", "'800'")]
    entries = [
        f"- url: {url}\n  start: {start}\n  end: {end}\n  note: klip {i}\n  role: eval\n"
        for i, (url, (start, end)) in enumerate(zip(forms, times * 2))
    ]
    other = "- url: https://youtu.be/9xo4pOaTsxY\n  start: 1:00\n  end: 1:40\n  note: contoh\n  role: fewshot\n"
    references = load_reference_set(write(tmp_path, "".join(entries) + other))

    seconds = [(754, 800), (5, 45.5), (3723, 3790.5), (754, 800)] * 2
    assert references.episodes("eval") == {
        EPISODE: [
            Reference(EPISODE, start, end, f"klip {i}", "eval", 1 + 5 * i) for i, (start, end) in enumerate(seconds)
        ]
    }
    assert references.episodes("fewshot") == {
        "https://www.youtube.com/watch?v=9xo4pOaTsxY": [
            Reference("https://www.youtube.com/watch?v=9xo4pOaTsxY", 60, 100, "contoh", "fewshot", 41)
        ]
    }


def test_invalid_entries_are_each_reported_with_their_line(tmp_path):
    path = write(
        tmp_path,
        """\
- url: https://youtu.be/dQw4w9WgXcQ
  start: 1:75
  end: 2:00
  note: detik tidak valid
  role: eval
- url: https://youtu.be/dQw4w9WgXcQ
  start: 2:30
  end: 2:10
  note: terbalik
  role: eval
- url: https://youtu.be/dQw4w9WgXcQ
  start: 3:00
  end: 3:40
  note: peran salah
  role: evaluation
- url: https://vimeo.com/123456789
  start: 4:00
  end: 4:30
  role: eval
- url: https://youtu.be/dQw4w9WgXcQ
  start: 5:00
  end: 5:30
  note: kolom asing
  role: eval
  rol: eval
- url: https://youtu.be/dQw4w9WgXcQ
  start: 6:00
  end:
  note: [satu, dua]
  role: eval
- just a line
- url: https://youtu.be/dQw4w9WgXcQ
  start: 7:00
  end: 7:40
  note: baik
  role: eval
""",
    )
    with pytest.raises(ReferenceSetError) as raised:
        load_reference_set(path)

    assert raised.value.errors == [
        f"{path}:2: start '1:75' is not a time: write m:ss, h:mm:ss or seconds",
        f"{path}:8: end 2:10 is not after start 2:30",
        f"{path}:15: unknown role 'evaluation': use eval or fewshot",
        f"{path}:16: 'https://vimeo.com/123456789' is not a YouTube video URL",
        f"{path}:16: missing note",
        f"{path}:25: unknown field 'rol' (the fields are url, start, end, note, role)",
        f"{path}:28: end is empty",
        f"{path}:29: note must be a single value",
        f"{path}:31: expected a clip with the fields url, start, end, note, role",
    ]
    assert str(raised.value) == "\n".join(raised.value.errors)


def test_an_episode_listed_under_both_roles_is_refused(tmp_path):
    path = write(
        tmp_path,
        """\
- url: https://www.youtube.com/watch?v=dQw4w9WgXcQ
  start: 1:00
  end: 1:40
  note: dinilai
  role: eval
- url: https://youtu.be/dQw4w9WgXcQ
  start: 9:00
  end: 9:40
  note: contoh
  role: fewshot
""",
    )
    with pytest.raises(ReferenceSetError) as raised:
        load_reference_set(path)

    assert raised.value.errors == [
        f"{path}:6: {EPISODE} is a fewshot episode here and an eval episode on line 1: an episode has one role "
        "only, or the eval would score clips the prompts show as examples"
    ]


@pytest.mark.parametrize(
    ("text", "error"),
    [
        ("- url: x\n  start: [1\n", "3: not valid YAML: expected ',' or ']', but got '<stream end>'"),
        ("url: https://youtu.be/dQw4w9WgXcQ\n", "1: expected a list of clips, each starting with `- url:`"),
    ],
)
def test_a_file_that_isnt_a_list_of_clips_is_refused(tmp_path, text, error):
    path = write(tmp_path, text)
    with pytest.raises(ReferenceSetError) as raised:
        load_reference_set(path)

    assert raised.value.errors == [f"{path}:{error}"]


def test_the_example_file_is_a_valid_reference_set_with_both_roles():
    references = load_reference_set(EXAMPLE)

    assert len(references.episodes("eval")) == 2
    assert len(references.episodes("fewshot")) == 1
