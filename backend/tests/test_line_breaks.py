"""Breaking a Text Layer's words into lines at its wrap width (app/line_breaks.py), Seam B: measured
here by counting characters, a line `width` characters at most.
"""

from app.line_breaks import broken_lines


def counted(text: str, width: float) -> list[str]:
    return broken_lines(text, width, len)


def test_words_go_on_a_line_while_they_fit_and_the_spaces_a_line_breaks_at_are_left_out():
    assert counted("the quick brown fox jumps", 10) == ["the quick", "brown fox", "jumps"]
    assert counted("the quick brown fox jumps", 100) == ["the quick brown fox jumps"]
    # A line that just fits, to the last letter.
    assert counted("abcd efgh", 4) == ["abcd", "efgh"]


def test_newlines_are_kept_and_a_blank_line_stays_blank():
    assert counted("satu\n\ndua tiga", 100) == ["satu", "", "dua tiga"]
    assert counted("satu dua\ntiga", 5) == ["satu", "dua", "tiga"]


def test_a_word_wider_than_the_width_breaks_between_its_characters_and_the_next_word_follows_it():
    assert counted("a supercalifragilistic word", 8) == ["a", "supercal", "ifragili", "stic", "word"]
    # A width narrower than one character still puts one on each line.
    assert counted("abc", 0) == ["a", "b", "c"]
    # A character and its combining marks stay together.
    assert counted("e\u0301e\u0301e\u0301", 2) == ["e\u0301", "e\u0301", "e\u0301"]


def test_lines_break_after_hyphens_but_not_before_a_digit_nor_before_closing_punctuation():
    assert counted("well-known", 6) == ["well-", "known"]
    assert counted("suhu -5 derajat", 4) == ["suhu", "-5", "dera", "jat"]
    assert counted("Halo !", 4) == ["Halo", "!"]  # Too wide whole: broken between characters.
    assert counted("Halo ! dunia", 6) == ["Halo !", "dunia"]
    assert counted("(ok) kata", 4) == ["(ok)", "kata"]


def test_chinese_and_japanese_break_between_their_characters_but_not_before_a_stop():
    assert counted("今日は良い天気です。", 3) == ["今日は", "良い天", "気で", "す。"]
    assert counted("「今日」です", 3) == ["「今", "日」で", "す"]
