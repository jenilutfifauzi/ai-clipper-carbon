"""Emoji in Text Layers (docs/adr/0010-text-layers-are-rasterised-pictures.md): which characters are
emoji, how a line is cut into them, and the image each is drawn from.

The images are Noto Color Emoji's (Apache-2.0), downloaded by `make setup` into EMOJI_DIR, one PNG an
emoji sequence, named as Noto names them: `emoji_u` and its codepoints in hex joined by `_`, without
variation selectors (🔥 is emoji_u1f525.png, 👍🏽 emoji_u1f44d_1f3fd.png). Flags, which Noto draws from
region-flags, are saved under their emoji names too (🇮🇩 is emoji_u1f1ee_1f1e9.png).

The hook, the Kicker, the Watermark and captions are ASS events, which libass draws without colour
glyphs: they leave emoji out (planner.py's `without_emoji`).
"""

import logging
from functools import cache
from pathlib import Path

import cv2
import numpy as np

from app.config import EMOJI_DIR

log = logging.getLogger(__name__)

# Where the images are read from (tests point it at their own).
images_dir: Path = EMOJI_DIR
# Which set they are: part of a Text Layer picture's name, so that a new set makes new pictures.
IMAGE_SET = "noto-emoji-v2026-09-24-unicode18_0-512"

# Emoji (Unicode's Extended_Pictographic, but for ©, ® and ™, which fonts draw as text) and the
# characters that join and vary them: no bundled font has them, and libass draws none.
_EMOJI = (
    (0x203C, 0x203C), (0x2049, 0x2049), (0x2139, 0x2139), (0x2194, 0x2199), (0x21A9, 0x21AA), (0x231A, 0x231B),
    (0x2328, 0x2328), (0x2388, 0x2388), (0x23CF, 0x23CF), (0x23E9, 0x23F3), (0x23F8, 0x23FA), (0x24C2, 0x24C2),
    (0x25AA, 0x25AB), (0x25B6, 0x25B6), (0x25C0, 0x25C0), (0x25FB, 0x25FE), (0x2600, 0x27BF), (0x2934, 0x2935),
    (0x2B00, 0x2BFF), (0x3030, 0x3030), (0x303D, 0x303D), (0x3297, 0x3297), (0x3299, 0x3299), (0x1F000, 0x1FAFF),
    (0x1FC00, 0x1FFFD), (0xFE00, 0xFE0F), (0x200D, 0x200D), (0x20E3, 0x20E3), (0xE0020, 0xE007F),
)
ZWJ = "‍"
KEYCAP = "⃣"
_VARIATIONS = {"︎", "️"}
_KEYCAP_BASES = set("#*0123456789")


def is_emoji(char: str) -> bool:
    """Whether `char` is an emoji, or a character that joins or varies them."""
    return any(low <= ord(char) <= high for low, high in _EMOJI)


def regional_indicator(char: str) -> bool:
    return 0x1F1E6 <= ord(char) <= 0x1F1FF


def emoji_modifier(char: str) -> bool:
    """A character that belongs to the emoji before it: a variation selector, a skin tone, a tag
    (of a subdivision's flag) or the keycap."""
    code = ord(char)
    return char in _VARIATIONS or 0x1F3FB <= code <= 0x1F3FF or 0xE0020 <= code <= 0xE007F or char == KEYCAP


def emoji_base(char: str) -> bool:
    """A character an emoji sequence starts with."""
    return is_emoji(char) and not emoji_modifier(char) and char != ZWJ and not 0xFE00 <= ord(char) <= 0xFE0F


def clusters(text: str) -> list[tuple[str, bool]]:
    """`text` cut into its emoji sequences, each kept whole, and its other characters, one by one; each
    with whether it is an emoji. A sequence is an emoji with what varies it (variation selectors, a
    skin tone, the tags of a subdivision's flag) and any more joined to it by ZWJs; a pair of regional
    indicators (a flag); or a keycap (a digit, # or *, then the keycap). A joiner or a modifier on its
    own is an emoji of its own, which has no image."""
    cut: list[tuple[str, bool]] = []
    i = 0
    while i < len(text):
        end = _sequence_end(text, i)
        cut.append((text[i : end or i + 1], end is not None))
        i = end or i + 1
    return cut


def _sequence_end(text: str, start: int) -> int | None:
    """Where the emoji sequence at `start` in `text` ends; None when no emoji starts there."""
    char, end = text[start], start + 1
    if regional_indicator(char):
        return end + 1 if end < len(text) and regional_indicator(text[end]) else end
    if char in _KEYCAP_BASES:
        for keycap in (KEYCAP, "️" + KEYCAP):
            if text.startswith(keycap, end):
                return end + len(keycap)
        return None
    if not is_emoji(char):
        return None
    while emoji_base(char):
        while end < len(text) and emoji_modifier(text[end]):
            end += 1
        if not (end + 1 < len(text) and text[end] == ZWJ and emoji_base(text[end + 1])):
            break
        end += 2
    return end


def image_of(sequence: str) -> str | None:
    """The name of the image the emoji `sequence` is drawn from: its own, or else its first
    codepoint's; None when there is neither."""
    codes = [f"{ord(char):04x}" for char in sequence if char not in _VARIATIONS]
    names = _images(images_dir)
    for name in (f"emoji_u{'_'.join(codes)}.png", f"emoji_u{codes[0]}.png" if codes else None):
        if name in names:
            return name
    return None


@cache
def _images(folder: Path) -> frozenset[str]:
    if not folder.is_dir():
        log.warning("No emoji images in %s: Text Layers leave emoji out. Run make setup.", folder)
        return frozenset()
    return frozenset(path.name for path in folder.glob("emoji_u*.png"))


def image_path(name: str) -> Path:
    """The file of the emoji image `name` (from `image_of`)."""
    return images_dir / name


def image_pixels(name: str) -> np.ndarray:
    """The emoji image `name` as straight-alpha RGBA pixels."""
    pixels = cv2.imread(str(image_path(name)), cv2.IMREAD_UNCHANGED)
    if pixels is None:
        raise RuntimeError(f"The emoji image {name} couldn't be read from {images_dir}: run make setup")
    if pixels.ndim == 2:
        return cv2.cvtColor(pixels, cv2.COLOR_GRAY2RGBA)
    if pixels.shape[2] == 3:
        return cv2.cvtColor(pixels, cv2.COLOR_BGR2RGBA)
    return cv2.cvtColor(pixels, cv2.COLOR_BGRA2RGBA)
