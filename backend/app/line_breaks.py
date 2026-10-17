"""Breaking a Text Layer's words into lines no wider than its wrap width (docs/adr/0010): at each
newline, and greedily between words at the break opportunities of Unicode's line breaking algorithm
(UAX #14) that the bundled scripts meet. A word wider than the width on its own is broken between
its characters. Pure: the width of a line is whatever the `measure` given says, so that the planner
measures it in its Face, with its tracking.

The break opportunities kept from UAX #14:
- after spaces (its SP), and after a zero width space (ZW);
- after a hyphen or a dash (HY, BA), but not a hyphen before a digit ("-5");
- before and after an ideograph, a kana or a fullwidth form (ID), as Chinese and Japanese are set
  without spaces;
- never before closing punctuation, an exclamation or question mark, a comma or a stop, nor a small
  kana or an iteration mark (CL, CP, EX, IS, NS), nor after opening punctuation (OP), even after a
  space ("Halo !" stays whole);
- before and after an emoji sequence (ID, EB), as between ideographs;
- never inside a character and the marks, joiners and variation selectors that follow it, nor
  between two characters a zero width joiner joins, nor inside an emoji sequence: before its skin
  tone or its tags (EM, CM), nor between the regional indicators of a flag (RI).
"""

import unicodedata
from collections.abc import Callable

from app.emoji import ZWJ, clusters, emoji_modifier, is_emoji, regional_indicator

# A line no wider than the width by this many pixels still fits it: a width set to a line's own,
# which floating point arithmetic may measure a hair over.
FIT_SLACK = 1e-6

_SPACE = " \t\u3000"
_ZERO_WIDTH_SPACE = "\u200b"
# Break after: hyphens and dashes (HY, BA), the soft hyphen.
_HYPHENS = "-\u00ad\u058a\u2010\u2012\u2013\u2014\u2027\u2e17"
# No break before: closing punctuation (CL, CP), ! and ? (EX), commas and stops (IS), small kana,
# prolonged sound and iteration marks (NS).
_NO_BREAK_BEFORE = set(
    ")]}!?,.:;\u00bb\u2019\u201d\u203a\u2030\u2031\u2032\u2033"
    "\u3001\u3002\u3005\u3009\u300b\u300d\u300f\u3011\u3015\u3017\u3019\u301b\u301e\u301f\u303b\u303c"
    "\u3041\u3043\u3045\u3047\u3049\u3063\u3083\u3085\u3087\u308e\u3095\u3096\u309b\u309c\u309d\u309e\u30a0"
    "\u30a1\u30a3\u30a5\u30a7\u30a9\u30c3\u30e3\u30e5\u30e7\u30ee\u30f5\u30f6\u30fb\u30fc\u30fd\u30fe"
    "\uff01\uff09\uff0c\uff0e\uff1a\uff1b\uff1f\uff3d\uff5d\uff60\uff61\uff63\uff64\uff65\uff9e\uff9f"
)
# No break after: opening punctuation (OP).
_NO_BREAK_AFTER = set("([{\u00ab\u2018\u201c\u2039\u3008\u300a\u300c\u300e\u3010\u3014\u3016\u3018\u301a\u301d\uff08\uff3b\uff5b\uff5f\uff62")
# Ideographs, kana and fullwidth forms (ID): a break may come before and after each.
_IDEOGRAPHIC = (
    (0x2E80, 0x2FFF), (0x3040, 0x30FF), (0x3100, 0x31FF), (0x3200, 0x33FF), (0x3400, 0x4DBF), (0x4E00, 0x9FFF),
    (0xF900, 0xFAFF), (0xFF00, 0xFFEF), (0x20000, 0x3FFFD),
)
# Kept with the character before them: zero width joiners and variation selectors (marks are found
# by their category); and after a zero width joiner, the character it joins.
_ZERO_WIDTH_JOINER = "\u200d"
_JOINED = {"\u200c", _ZERO_WIDTH_JOINER, *map(chr, range(0xFE00, 0xFE10))}


def broken_lines(text: str, width: float, measure: Callable[[str], float]) -> list[str]:
    """`text` as lines no wider than `width` (as `measure` measures a line): broken at its newlines,
    then greedily at its break opportunities, each line as long as fits; the spaces a line breaks at
    left out. A word wider than `width` is broken between its characters, a line holding at least
    one. A blank paragraph is a blank line."""
    return [line for paragraph in text.split("\n") for line in _wrapped(paragraph, width, measure)]


def _wrapped(paragraph: str, width: float, measure: Callable[[str], float]) -> list[str]:
    def fits(line: str) -> bool:
        return measure(line.rstrip(_SPACE)) <= width + FIT_SLACK

    lines: list[str] = []
    line = ""
    for word in _words(paragraph):
        if fits(line + word):
            line += word
            continue
        if line:
            lines.append(line.rstrip(_SPACE))
            line = ""
        if fits(word):
            line = word
            continue
        for character in _characters(word):
            if line and not fits(line + character):
                lines.append(line.rstrip(_SPACE))
                line = ""
            line += character
    lines.append(line.rstrip(_SPACE))
    return lines


def _words(paragraph: str) -> list[str]:
    """`paragraph` cut at its break opportunities: each piece with the spaces after it."""
    pieces: list[str] = []
    start = 0
    for at in range(1, len(paragraph)):
        if _breaks_before(paragraph, at):
            pieces.append(paragraph[start:at])
            start = at
    pieces.append(paragraph[start:])
    return [piece for piece in pieces if piece]


def _breaks_before(text: str, at: int) -> bool:
    """Whether a line may break between `text[at - 1]` and `text[at]`."""
    before, after = text[at - 1], text[at]
    if after in _SPACE or after in _NO_BREAK_BEFORE or _joined(after) or before == _ZERO_WIDTH_JOINER:
        return False
    if emoji_modifier(after):
        return False
    if regional_indicator(before) and regional_indicator(after):
        # A flag is a pair: a break comes only after an even number of them.
        run = at
        while run > 0 and regional_indicator(text[run - 1]):
            run -= 1
        return (at - run) % 2 == 0
    # After spaces: unless what precedes them opens.
    if before in _SPACE:
        last = text[:at].rstrip(_SPACE)
        return not last or last[-1] not in _NO_BREAK_AFTER
    if before in _NO_BREAK_AFTER:
        return False
    if before == _ZERO_WIDTH_SPACE:
        return True
    if before in _HYPHENS:
        return not (before == "-" and after.isdigit())
    return _ideographic(before) or _ideographic(after) or _pictographic(before) or _pictographic(after)


def _characters(word: str) -> list[str]:
    """`word`'s characters, each with the marks, joiners and variation selectors after it, and its
    emoji sequences whole (app/emoji.py's `clusters`)."""
    characters: list[str] = []
    for character, _ in clusters(word):
        if characters and (_joined(character[0]) or characters[-1].endswith(_ZERO_WIDTH_JOINER)):
            characters[-1] += character
        else:
            characters.append(character)
    return characters


def _joined(character: str) -> bool:
    return character in _JOINED or unicodedata.category(character) in ("Mn", "Mc", "Me")


def _ideographic(character: str) -> bool:
    return any(low <= ord(character) <= high for low, high in _IDEOGRAPHIC)


def _pictographic(character: str) -> bool:
    """An emoji, or a character that ends an emoji sequence (a skin tone, a tag, a keycap)."""
    return is_emoji(character) and character != ZWJ
