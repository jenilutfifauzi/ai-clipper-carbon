"""The fonts captions and the hook can be set in: bundled files, given to libass through `fontsdir`
and to the browser's preview by GET /api/fonts/{id}, so that both set the same glyphs."""

from dataclasses import dataclass
from pathlib import Path

from app.config import FONTS_DIR


@dataclass(frozen=True)
class Font:
    id: str
    # What the UI calls it.
    label: str
    # The family name libass matches a style's Fontname against: the file's own (its `name` table).
    family: str
    file: Path


FONTS = {
    font.id: font
    for font in [
        Font("montserrat-extrabold", "Montserrat ExtraBold", "Montserrat ExtraBold", FONTS_DIR / "Montserrat-ExtraBold.ttf"),
    ]
}
DEFAULT_FONT = "montserrat-extrabold"


def font(font_id: str) -> Font:
    """The registered font `font_id`; KeyError for one that isn't."""
    return FONTS[font_id]
