"""Small font files for the Face tests, built with fontTools: each draws every capital letter as one
upright bar, as wide as its `stem` (in a variable font, its Bold instance's is 300 units wider)."""

from io import BytesIO

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTCollection, TTFont
from fontTools.ttLib.tables.TupleVariation import TupleVariation

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# OS/2 fsType's Restricted License embedding.
RESTRICTED = 0x0002


def _bar(pen, stem: int) -> None:
    pen.moveTo((100, 0))
    pen.lineTo((100, 700))
    pen.lineTo((100 + stem, 700))
    pen.lineTo((100 + stem, 0))
    pen.closePath()


def font_file(
    family: str,
    style: str = "Regular",
    weight: int = 400,
    italic: bool = False,
    fs_type: int = 0,
    cff: bool = False,
    stem: int = 100,
    variable: bool = False,
    typographic: tuple[str, str] | None = None,
    em: int = 1000,
) -> bytes:
    """A TTF (an OTF when `cff`) of `family` in `style`. `variable` adds a Weight axis from 400 to
    700, named Regular and Bold, whose Bold bars are 300 units wider. `typographic` sets name IDs
    16 and 17; `em` is its units per em."""
    ps_name = f"{family.replace(' ', '')}-{style.replace(' ', '')}"
    builder = FontBuilder(em, isTTF=not cff)
    order = [".notdef", "space", *LETTERS]
    builder.setupGlyphOrder(order)
    builder.setupCharacterMap({32: "space", **{ord(letter): letter for letter in LETTERS}})
    glyphs = {}
    for name in order:
        pen = T2CharStringPen(600, None) if cff else TTGlyphPen(None)
        if name != "space":
            _bar(pen, stem)
        glyphs[name] = pen.getCharString() if cff else pen.glyph()
    if cff:
        builder.setupCFF(ps_name, {"FullName": f"{family} {style}"}, glyphs, {})
    else:
        builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (600, 0 if name == "space" else 100) for name in order})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    names = {
        "familyName": family,
        "styleName": style,
        "fullName": f"{family} {style}",
        "psName": ps_name,
        "copyright": f"Copyright 2026 The {family} Authors",
        "licenseDescription": f"{family} is licensed under the Test Licence",
        "licenseInfoURL": "https://example.com/licence",
    }
    if typographic:
        names |= {"typographicFamily": typographic[0], "typographicSubfamily": typographic[1]}
    builder.setupNameTable(names)
    builder.setupOS2(
        usWeightClass=weight, fsType=fs_type, fsSelection=0x01 if italic else 0x40, sTypoAscender=800,
        sTypoDescender=-200, sTypoLineGap=0, usWinAscent=800, usWinDescent=200, sCapHeight=700, sxHeight=500,
    )
    builder.setupPost(italicAngle=-10 if italic else 0)
    builder.updateHead(macStyle=0x02 if italic else 0)
    if variable:
        builder.setupFvar(
            [("wght", 400, 400, 700, "Weight")],
            [{"location": {"wght": 400}, "stylename": "Regular"}, {"location": {"wght": 700}, "stylename": "Bold"}],
        )
        # The bar's right side moves out; its four points, then the four phantom points.
        wider = [(0, 0), (0, 0), (300, 0), (300, 0), (0, 0), (0, 0), (0, 0), (0, 0)]
        builder.setupGvar({letter: [TupleVariation({"wght": (0, 1.0, 1.0)}, wider)] for letter in LETTERS})
    out = BytesIO()
    builder.save(out)
    return out.getvalue()


def collection(*members: bytes) -> bytes:
    """A TTC of `members`."""
    ttc = TTCollection()
    ttc.fonts = [TTFont(BytesIO(member)) for member in members]
    out = BytesIO()
    ttc.save(out)
    return out.getvalue()
