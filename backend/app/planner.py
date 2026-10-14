"""The Render Planner: how a Clip is cut from its Source and framed in the 1080×1920 output, as a
Render Plan that the Renderer executes. Pure, so it is tested on synthetic input (Seam B): the Clip's
Scenes and face detections are found before planning (app/analysis.py) and passed in.

Each Scene of a landscape Source gets its own Layout, from its number of faces in LAYOUT_SAMPLES of
its sampled frames (scenes shorter than MIN_SCENE_SECS are first merged into a neighbour, so that the
layout doesn't flicker). The Candidate's layout override, unless Auto, replaces the choice in every Scene.
- One face: Track, a full-height 9:16 crop that follows the speaker's face.
- Two faces: Split, two 1080×960 panels stacked, the left face's on top, each with its own camera
  following its face. Forced with fewer than two faces, Split shows the frame's left and right halves.
- None, or three or more: Blur, the whole shot as wide as the output, centred over a blurred copy
  of itself that fills it.

The cameras:
- the Speaker Tracker gives each face an identity across the Scene's sampled frames; Track follows
  the largest and most often seen, sticking with it unless another clearly takes over, and Split
  the two seen most;
- the Smooth Camera moves a crop towards its face like a critically damped spring, once the face
  leaves its dead-zone, ignoring a detection that jumps away until others confirm it, and holds
  still while the face is lost.
A crop's path is kept as change points: the frames at which its position changes. A Scene starts
already framed on its faces, and the tracker starts afresh at every cut.

A portrait Source is passed through whole.

Captions come from the Clip's own Words (transcribed for it, on the Clip's timeline). They are
short lines, broken by the Caption Style's limits (by default UPPERCASE, at most 16 characters or
1.4 s long), each Word highlighted while it is spoken. With the style's Auto position a line sits on
the seam between the panels in a Split Scene and in the lower third otherwise, and moves when the
Layout changes under it; the other positions put every line in one place.

The hook (the Candidate's hook text, as last edited) is shown for the Clip's first HOOK_SECS in a
box, at the top of SAFE_AREA unless its Hook Style places it elsewhere: on one line if it fits,
else on two, set smaller when even two lines at the style's size would be too wide (`fit_hook`,
which Review also asks, to warn). With the default positions it stays above the captions in every
Layout: they never go above the seam's band, y 860.

Like the hook, captions stay inside SAFE_AREA, clear of the platforms' buttons and text. Both are
measured with their bundled font's own widths (`font_metrics`), the font libass sets them in. The
styles (app/styles.py) are kept in the plan, for the Renderer to draw it in them.
"""

import math
import unicodedata
from collections import Counter
from dataclasses import dataclass, field, replace
from enum import StrEnum
from functools import cache

from app.candidates import Layout, LayoutOverride, WordEdit
from app.config import CameraTuning
from app.fonts import DEFAULT_FONT, font
from app.styles import CaptionPosition, CaptionStyle, HookAlign, HookPosition, HookShape, HookStyle
from app.transcript import Word
from app.video_source import SourceMetadata

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920
# Split's panels are as wide as the output and half as tall.
SPLIT_HEIGHT = OUTPUT_HEIGHT // 2
# A Scene's Layout follows its number of faces in this many of its sampled frames, spread through it.
LAYOUT_SAMPLES = 5
# A Scene shorter than this is merged into a neighbour before Layouts are chosen.
MIN_SCENE_SECS = 1.0
# In a Split panel, the face's centre is put this far down the panel (as a share of its height),
# where the frame allows: a little above the middle, leaving the seam between the panels clear.
SPLIT_FACE_AT = 0.4
# A caption line stays on screen this long after its last Word, unless the next line comes sooner.
# (How lines are broken is the Caption Style's.)
CAPTION_LINGER_SECS = 0.3
# A Word Edit applies to the Word whose span holds its time, or failing that to the nearest Word
# within this long of it.
WORD_EDIT_REACH_SECS = 0.25
# Where the Layout changes under a line, the line moves; it isn't shown for less than this in one place.
CAPTION_MIN_SECS = 0.2
# The hook is shown from the Clip's start for this long, in at most two lines at its style's font
# size (Default's: 88, as libass sets Montserrat, like the captions': 56 px to the em, capitals 39 px
# tall), unless it is too long for them.
HOOK_SECS = 3.0
HOOK_SIZE = HookStyle().size
# Its lines' baselines are this many sizes apart.
HOOK_LEADING = 0.82
# The box's padding, in pixels: either side of the longest line, above the capitals of the first
# and below the descenders of the last.
HOOK_PAD_X = 36
HOOK_PAD_Y = 26
# A strip's padding, in sizes: either side of its line, and above the capitals and below the
# descenders; and the gap between one strip and the next.
STRIP_PAD_X = 0.25
STRIP_PAD_Y = 0.14
STRIP_GAP = 0.06


# The planner's input, found by app/analysis.py.


@dataclass(frozen=True)
class Scene:
    """A shot between two cuts, in seconds into the Clip."""

    start: float
    end: float


@dataclass(frozen=True)
class Face:
    """A detected face's box in Source pixels, from its top-left corner, and the detector's confidence."""

    x: float
    y: float
    width: float
    height: float
    score: float

    @property
    def centre_x(self) -> float:
        return self.x + self.width / 2

    @property
    def centre_y(self) -> float:
        return self.y + self.height / 2


@dataclass(frozen=True)
class FrameFaces:
    """The faces found in the sampled frame `at` seconds into the Clip."""

    at: float
    faces: list[Face]


# The Render Plan.


class SceneLayout(StrEnum):
    """How a scene is framed: the Layouts of review, and a portrait Source shown as it is."""

    TRACK = "track"
    SPLIT = "split"
    BLUR = "blur"
    PASSTHROUGH = "passthrough"


@dataclass(frozen=True)
class Box:
    """A rectangle in pixels, from its top-left corner."""

    x: int
    y: int
    width: int
    height: int


# The platforms' buttons and text cover the top 12%, the bottom 20% and the right 12% of the frame:
# captions and the hook stay inside the rest, y 232–1536 and x 0–950.
SAFE_AREA = Box(0, 232, 950, 1304)
# Where a caption line is centred: as far from the left edge as the safe area's right edge is from
# the right, so that lines are centred in the frame. On the seam between Split's panels (y 860–1060,
# clear of the faces, which sit at 40% of each panel), or in the lower third (y 1296–1496: below
# Blur's shot, which ends at 1264, and above the bottom safe zone).
_CAPTION_X = OUTPUT_WIDTH - (SAFE_AREA.x + SAFE_AREA.width)
SEAM_CAPTIONS = Box(_CAPTION_X, SPLIT_HEIGHT - 100, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
LOWER_CAPTIONS = Box(_CAPTION_X, 1296, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
# The Top position's: just below where a two-line hook at the top ends (y 410 at most).
TOP_CAPTIONS = Box(_CAPTION_X, 430, OUTPUT_WIDTH - 2 * _CAPTION_X, 200)
# The widest a hook line can be: its box, padding included, is as wide as the captions' area.
HOOK_WIDTH = OUTPUT_WIDTH - 2 * _CAPTION_X - 2 * HOOK_PAD_X
# Punctuation is left out of the captions at either end of a Word ("HALO" for "halo,"), except for
# the question and exclamation marks that end one ("KENAPA?") and signs that belong to it ("50%",
# "#1"). Inside a Word it stays ("MAIN-MAIN", "2,5").
_SIGNS = "%#@&"


@dataclass(frozen=True)
class CropPoint:
    """From `at` seconds into the Clip on, the panel's crop has its top-left corner at (x, y) in the Source."""

    at: float
    x: int
    y: int


@dataclass(frozen=True)
class Panel:
    """Part of the output frame, showing a crop of the Source scaled to fill it."""

    # Where the panel sits in the output frame.
    area: Box
    # The crop's size in Source pixels, with about the aspect of `area`.
    crop_width: int
    crop_height: int
    # Where the crop is: its change points in time order, the first at the scene's start. The crop
    # stays put between them.
    path: list[CropPoint]
    # Shown blurred: Blur's background.
    blur: bool = False


@dataclass(frozen=True)
class ScenePlan:
    # Seconds into the Clip.
    start: float
    end: float
    layout: SceneLayout
    panels: list[Panel]


@dataclass(frozen=True)
class CaptionWord:
    """A Word of a caption line, highlighted from `start` (when it is spoken) to `end` (when the next
    one is, or the line goes), in seconds into the Clip."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class CaptionEvent:
    """A caption line, on screen from `start` to `end` (seconds into the Clip), centred in `area` at
    font `size`: the Caption Style's, or smaller for a line too wide for the area. Its `words` are
    highlighted one after another, from its start to its end."""

    text: str
    start: float
    end: float
    words: list[CaptionWord]
    area: Box
    size: float


@dataclass(frozen=True)
class HookEvent:
    """The hook's lines, set at font `size`, on screen from `start` to `end` (seconds into the Clip).
    `area` holds all of it. Each line is placed by its anchor, the middle of its text and its
    baseline, over `boxes`: one behind every line (a block), one behind each (strips), or none."""

    lines: list[str]
    start: float
    end: float
    area: Box
    size: float
    anchors: list[tuple[float, float]]
    boxes: list[Box]
    # Each line's emphasised runs, as [start, end) ranges of its characters.
    emphasis: list[list[tuple[int, int]]]


@dataclass(frozen=True)
class RenderPlan:
    # The Clip's range on the Source's timeline.
    start: float
    end: float
    source_width: int
    source_height: int
    fps: float
    # Back to back, covering the Clip from 0 to its duration.
    scenes: list[ScenePlan]
    captions: list[CaptionEvent] = field(default_factory=list)
    hook: HookEvent | None = None
    # What the captions and the hook look like.
    caption_style: CaptionStyle = CaptionStyle()
    hook_style: HookStyle = HookStyle()
    width: int = OUTPUT_WIDTH
    height: int = OUTPUT_HEIGHT

    @property
    def duration(self) -> float:
        return self.end - self.start


def reframes(source: SourceMetadata) -> bool:
    """Whether Clips of `source` are reframed, and so need their Scenes and faces: all but a portrait
    Source, which is passed through."""
    return source.height <= source.width


def plan_render(
    start: float,
    end: float,
    source: SourceMetadata,
    scenes: list[Scene] | None = None,
    faces: list[FrameFaces] | None = None,
    layout: Layout = Layout.AUTO,
    words: list[Word] | None = None,
    hook: str = "",
    camera: CameraTuning = CameraTuning(),
    caption_style: CaptionStyle = CaptionStyle(),
    hook_style: HookStyle = HookStyle(),
    word_edits: list[WordEdit] | None = None,
    hook_start: float = 0.0,
    hook_secs: float = HOOK_SECS,
    layout_overrides: list[LayoutOverride] | None = None,
) -> RenderPlan:
    """The Render Plan for the Clip from `start` to `end` seconds of `source`, whose shots are `scenes`
    and whose sampled frames have `faces` (both in seconds into the Clip), framed in `layout` (Auto:
    each Scene by its faces), captioned with `words` (in seconds into the Clip; those beyond its
    ends are left out) in `caption_style` and corrected by `word_edits` (their times in seconds into
    the Clip), with the `hook` text in `hook_style` from `hook_start` for `hook_secs`. A Scene that
    holds one of `layout_overrides` (their times in seconds into the Clip) takes its Layout instead
    of `layout`, the last one if it holds several. Without `scenes` the Clip is one Scene;
    without `faces` (not analysed) an Auto Scene is tracked with its crop in the middle; without
    `words`, nothing is captioned; with a blank `hook`, no hook is shown."""
    if not 0 <= start < end:
        raise ValueError(f"A Clip runs forwards from 0 s or later, not {start:g}–{end:g} s")
    duration = round(end - start, 3)
    if not reframes(source):
        plans = [ScenePlan(0.0, duration, SceneLayout.PASSTHROUGH, [_fitted(source.width, source.height, 0.0)])]
    else:
        cuts = sorted({round(scene.start, 3) for scene in scenes or []} - {0.0})
        edges = [0.0, *(cut for cut in cuts if cut < duration), duration]
        plans = []
        for a, b in _merge_short(edges):
            seen = None if faces is None else [frame for frame in faces if a <= frame.at < b]
            count = None if seen is None else _face_count(seen)
            held = [o.layout for o in layout_overrides or [] if a <= o.at < b or (b == duration and o.at == b)]
            chosen = _choose(held[-1] if held else layout, count)
            if chosen is SceneLayout.TRACK:
                panels = [_track(a, b, seen, source, camera)]
            elif chosen is SceneLayout.SPLIT:
                panels = _split(a, b, seen if count and count >= 2 else None, source, camera)
            else:
                panels = _blur(a, source)
            plans.append(ScenePlan(a, b, chosen, panels))
    return RenderPlan(
        start=start,
        end=end,
        source_width=source.width,
        source_height=source.height,
        fps=source.fps,
        scenes=plans,
        captions=_captions(words or [], plans, duration, caption_style, word_edits or []),
        hook=_hook(hook, duration, hook_style, hook_start, hook_secs),
        caption_style=caption_style,
        hook_style=hook_style,
    )


def fit_hook(text: str, style: HookStyle = HookStyle()) -> tuple[list[str], float]:
    """How the hook `text` is set in `style`: its lines (none when it is blank) and their font size.
    The fewest lines, up to the style's max_lines, that fit in HOOK_WIDTH at its size, broken between
    words where the longest is shortest. Lines still too wide are set smaller, so that the longest
    just fits: the text fits when the size is the style's."""
    words = [word for word, _ in _hook_words(text, style.uppercase)]
    if not words:
        return [], style.size
    metrics = font_metrics(style.font)

    def widest(lines: list[str]) -> float:
        return max(metrics.width(line, style.size) for line in lines)

    for count in range(1, min(style.max_lines, len(words)) + 1):
        lines = _balanced(words, count, metrics)
        if widest(lines) <= HOOK_WIDTH:
            return lines, style.size
    return lines, math.floor(style.size * HOOK_WIDTH / widest(lines) * 10) / 10


# Emoji and the characters that join and vary them: no bundled font has them, and libass draws none.
_EMOJI = (
    (0x1F000, 0x1FAFF), (0x2600, 0x27BF), (0x2B00, 0x2BFF), (0x1F1E6, 0x1F1FF), (0xFE00, 0xFE0F), (0x200D, 0x200D),
    (0x20E3, 0x20E3), (0xE0020, 0xE007F),
)


def _is_emoji(char: str) -> bool:
    return any(low <= ord(char) <= high for low, high in _EMOJI)


def _hook_words(text: str, uppercase: bool) -> list[tuple[str, tuple[bool, ...]]]:
    """The hook `text`'s words as shown, each with which of its characters are emphasised: those
    between a pair of asterisks, which aren't shown (an unpaired last one is). Without emoji, and in
    capitals if `uppercase`."""
    stars = [i for i, char in enumerate(text) if char == "*"]
    paired = stars[: len(stars) // 2 * 2]
    marks = set(paired)
    chars: list[tuple[str, bool]] = []
    inside = False
    for i, char in enumerate(text):
        if i in marks:
            inside = not inside
        elif not _is_emoji(char):
            chars.append((char.upper() if uppercase else char, inside))
    words, word = [], []
    for char, emphasised in [*chars, (" ", False)]:
        if char.isspace():
            if word:
                words.append(("".join(c for c, _ in word), tuple(e for _, e in word)))
            word = []
        else:
            word.append((char, emphasised))
    return words


def _emphasis(words: list[tuple[str, tuple[bool, ...]]]) -> list[tuple[int, int]]:
    """The emphasised runs of a line of `words` (joined by spaces), as [start, end) ranges of its
    characters; a space between two emphasised characters is in their run."""
    flags = [flag for i, (_, word) in enumerate(words) for flag in ((False,) if i else ()) + word]
    for i in range(1, len(flags) - 1):
        flags[i] = flags[i] or (flags[i - 1] and flags[i + 1])
    spans, start = [], None
    for i, flag in enumerate([*flags, False]):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            spans.append((start, i))
            start = None
    return spans


def _balanced(words: list[str], count: int, metrics: "FontMetrics") -> list[str]:
    """`words` on `count` lines, broken where the widest line is narrowest (of equals, with the
    earliest breaks)."""
    space = metrics.advances.get(" ", metrics.units)
    ends = [0]
    for word in words:
        ends.append(ends[-1] + sum(metrics.advances.get(char, metrics.units) for char in word))

    def units(i: int, j: int) -> int:
        return ends[j] - ends[i] + (j - i - 1) * space

    # best[k][j]: the narrowest widest line of words[:j] on k lines, and where its last line starts.
    best = [{j: (units(0, j), 0) for j in range(1, len(words) + 1)}]
    for k in range(2, count + 1):
        best.append({
            j: min(((max(best[-1][i][0], units(i, j)), i) for i in range(k - 1, j)), key=lambda option: option[0])
            for j in range(k, len(words) + 1)
        })
    lines, j = [], len(words)
    for k in range(count, 0, -1):
        i = best[k - 1][j][1]
        lines.insert(0, " ".join(words[i:j]))
        j = i
    return lines


def _hook(text: str, duration: float, style: HookStyle, start: float = 0.0, secs: float = HOOK_SECS) -> HookEvent | None:
    """The hook `text` from `start` for `secs` seconds of the Clip, which lasts `duration` (until its
    end, if that comes sooner), centred like the captions and as large as its lines and padding,
    placed by `style`: just below the top of SAFE_AREA, in the middle of the frame, just above the
    bottom of SAFE_AREA, or with its top at the style's height (kept inside SAFE_AREA).
    None when the text is blank or it would start at or after the Clip's end.

    A block (or no box) is HOOK_PAD_X wider than the longest line either side, its first line's
    capitals HOOK_PAD_Y below its top and the baselines HOOK_LEADING sizes apart. Strips are each
    their line's width, padded by STRIP_PAD_X and STRIP_PAD_Y, STRIP_GAP apart. Left-aligned lines
    (and strips) start at the left of the longest."""
    lines, size = fit_hook(text, style)
    start = round(max(start, 0.0), 3)
    if not lines or start >= duration:
        return None
    words, emphasis = _hook_words(text, style.uppercase), []
    for line in lines:
        count = len(line.split())
        emphasis.append(_emphasis(words[:count]))
        words = words[count:]
    metrics = font_metrics(style.font)
    widths = [metrics.width(line, size) for line in lines]
    left = style.align == HookAlign.LEFT
    # Boxes from the hook's top-left corner, and anchors from where it is.
    if style.shape == HookShape.STRIPS:
        pad_x, pad_y = STRIP_PAD_X * size, STRIP_PAD_Y * size
        strip_height = math.ceil((metrics.cap_height + metrics.descent) / metrics.units * size + 2 * pad_y)
        pitch = strip_height + round(STRIP_GAP * size)
        strips = [math.ceil(line + 2 * pad_x) for line in widths]
        width, height = max(strips), (len(lines) - 1) * pitch + strip_height
        offsets = [0 if left else (width - strip) // 2 for strip in strips]
        boxes = [Box(x, i * pitch, strip, strip_height) for i, (x, strip) in enumerate(zip(offsets, strips))]

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + box.x + box.width / 2, y + box.y + pad_y + metrics.cap_height / metrics.units * size) for box in boxes
            ]
    else:
        width = math.ceil(max(widths)) + 2 * HOOK_PAD_X
        letters = (metrics.cap_height + metrics.descent) / metrics.units * size + (len(lines) - 1) * HOOK_LEADING * size
        height = math.ceil(letters) + 2 * HOOK_PAD_Y
        boxes = [Box(0, 0, width, height)] if style.shape == HookShape.BLOCK else []

        def anchors(x: int, y: int) -> list[tuple[float, float]]:
            return [
                (x + HOOK_PAD_X + line / 2 if left else x + width / 2,
                 y + HOOK_PAD_Y + (metrics.cap_height / metrics.units + i * HOOK_LEADING) * size)
                for i, line in enumerate(widths)
            ]
    bottom = SAFE_AREA.y + SAFE_AREA.height - height
    top = {
        HookPosition.TOP: SAFE_AREA.y,
        HookPosition.MIDDLE: (OUTPUT_HEIGHT - height) // 2,
        HookPosition.BOTTOM: bottom,
        HookPosition.CUSTOM: min(max(style.y, SAFE_AREA.y), bottom),
    }[style.position]
    area = Box((OUTPUT_WIDTH - width) // 2, top, width, height)
    return HookEvent(
        lines,
        start,
        round(min(start + secs, duration), 3),
        area,
        size,
        anchors=anchors(area.x, area.y),
        boxes=[Box(area.x + box.x, area.y + box.y, box.width, box.height) for box in boxes],
        emphasis=emphasis,
    )


@dataclass(frozen=True)
class FontMetrics:
    """The measures of a font captions or the hook are set in, in its units. libass sets a font so
    that its Windows ascent plus descent, `units`, is the font size."""

    # The advance width of each character the font has.
    advances: dict[str, int]
    units: int
    # Units per em: a browser sets a font so that this is its font size.
    em: int
    # The Windows ascent, from the top of a line to its baseline.
    ascent: int
    # How tall capitals are, and how far below the baseline descenders (g, p) go.
    cap_height: int
    descent: int

    def width(self, text: str, size: float) -> float:
        """How wide `text` is at font `size`, in pixels; a character the font hasn't got counts a size wide."""
        return sum(self.advances.get(char, self.units) for char in text) / self.units * size


@cache
def font_metrics(font_id: str = DEFAULT_FONT) -> FontMetrics:
    """A bundled font's measures (app/fonts.py), read with fontTools."""
    from fontTools.ttLib import TTFont

    file = TTFont(font(font_id).file, lazy=True)
    widths = file["hmtx"]
    os2 = file["OS/2"]
    return FontMetrics(
        advances={chr(code): widths[glyph][0] for code, glyph in file.getBestCmap().items()},
        units=os2.usWinAscent + os2.usWinDescent,
        em=file["head"].unitsPerEm,
        ascent=os2.usWinAscent,
        cap_height=os2.sCapHeight,
        descent=-os2.sTypoDescender,
    )


@dataclass(frozen=True)
class _Spoken:
    """A Word as captions show it, on the Clip's timeline."""

    text: str
    start: float
    end: float
    ends_sentence: bool
    # Edited to start a line.
    breaks_before: bool = False


def match_edits(words: list[Word], edits: list[WordEdit]) -> list[WordEdit | None]:
    """Each Word's Word Edit, or None: the Words and the edits' times on the same timeline. An edit
    applies to the Word whose span holds its time, else to the nearest Word within
    WORD_EDIT_REACH_SECS; of two edits of one Word, the later in `edits`."""
    matched: list[WordEdit | None] = [None] * len(words)
    for edit in edits:
        best, distance = None, WORD_EDIT_REACH_SECS
        for i, word in enumerate(words):
            gap = max(word.start - edit.at, edit.at - word.end, 0.0)
            if gap < distance:
                best, distance = i, gap
            if gap == 0:
                break
        if best is not None:
            matched[best] = edit
    return matched


def _captions(
    words: list[Word], scenes: list[ScenePlan], duration: float, style: CaptionStyle, edits: list[WordEdit]
) -> list[CaptionEvent]:
    """The caption lines of `words` over the Clip, which lasts `duration` and is laid out in `scenes`,
    in `style`, with the Word Edits `edits` applied (match_edits): an edited Word shows the edit's
    text (none, when it is empty) and a Word edited to break starts a line.

    The Words whose middle is in the Clip are taken in order into a line, in UPPERCASE (unless the
    style keeps their case) and without the punctuation at their ends, until the next would make it
    longer than the style's max_chars, max_words or max_secs, comes after a pause of its pause_secs,
    follows the end of a sentence, or starts in a Scene whose captions go elsewhere. A line starts
    with its first Word and ends CAPTION_LINGER_SECS after its last, when the next line starts if
    that is sooner, and after max_secs at most. A Word is highlighted from when it is spoken until
    the next one is.
    A line still being spoken at a Layout change that moves the captions moves there with it (unless
    that would show it for less than CAPTION_MIN_SECS in one place); one whose Words are all spoken
    goes at the change."""
    spoken = []
    ordered = sorted(words, key=lambda word: word.start)
    for word, edit in zip(ordered, match_edits(ordered, edits)):
        given = edit.text if edit is not None and edit.text is not None else word.text
        text, ends_sentence = _caption_text(given, style.uppercase)
        if text and 0 <= (word.start + word.end) / 2 < duration:
            breaks = edit is not None and edit.break_before
            spoken.append(_Spoken(text, max(word.start, 0.0), min(max(word.end, word.start), duration), ends_sentence, breaks))

    areas = [_caption_area(style, scene.layout) for scene in scenes]
    # The Layout changes that move the captions.
    moves = [scene.start for scene, area, before in zip(scenes[1:], areas[1:], areas) if area != before]

    def area_at(at: float) -> Box:
        return next(area for scene, area in zip(reversed(scenes), reversed(areas)) if scene.start <= at or scene is scenes[0])

    lines: list[list[_Spoken]] = []
    for word in spoken:
        line = lines[-1] if lines else None
        if (
            line is None
            or word.breaks_before
            or len(" ".join([*(w.text for w in line), word.text])) > style.max_chars
            or (style.max_words is not None and len(line) >= style.max_words)
            or word.end - line[0].start > style.max_secs
            or word.start - line[-1].end >= style.pause_secs
            or line[-1].ends_sentence
            or area_at(word.start) != area_at(line[0].start)
        ):
            lines.append([word])
        else:
            line.append(word)

    events = []
    for i, line in enumerate(lines):
        start = line[0].start
        end = min(line[-1].end + CAPTION_LINGER_SECS, start + style.max_secs, duration)
        if i + 1 < len(lines):
            end = min(end, lines[i + 1][0].start)
        end = min([end, *(at for at in moves if line[-1].end <= at < end)])
        if end <= start:
            continue
        text = " ".join(word.text for word in line)
        starts = [max(word.start, start) for word in line]
        highlights = list(zip(line, starts, [*starts[1:], end]))
        edges = [start, *(at for at in moves if start < at < end), end]
        # Each part of the line between Layout changes, where it is shown: one too short joins the next
        # (the last, the one before it), taking the next one's place.
        parts = [[a, b, area_at(a)] for a, b in zip(edges, edges[1:])]
        while len(parts) > 1:
            short = next((i for i, (a, b, _) in enumerate(parts) if b - a < CAPTION_MIN_SECS), None)
            if short is None:
                break
            if short + 1 < len(parts):
                parts[short + 1][0] = parts[short][0]
            else:
                parts[short - 1][1] = parts[short][1]
            del parts[short]
        for a, b, area in parts:
            events.append(CaptionEvent(
                text=text,
                start=round(a, 3),
                end=round(b, 3),
                words=[CaptionWord(word.text, round(min(max(on, a), b), 3), round(min(max(off, a), b), 3))
                       for word, on, off in highlights],
                area=area,
                size=_caption_size(text, area, style),
            ))
    return events


def _caption_area(style: CaptionStyle, layout: SceneLayout) -> Box:
    """Where a caption line is centred in a Scene in `layout`."""
    match style.position:
        case CaptionPosition.AUTO:
            return SEAM_CAPTIONS if layout is SceneLayout.SPLIT else LOWER_CAPTIONS
        case CaptionPosition.TOP:
            return TOP_CAPTIONS
        case CaptionPosition.MIDDLE:
            return SEAM_CAPTIONS
        case CaptionPosition.BOTTOM:
            return LOWER_CAPTIONS
        case CaptionPosition.CUSTOM:
            half = LOWER_CAPTIONS.height // 2
            centre = min(max(style.y, SAFE_AREA.y + half), SAFE_AREA.y + SAFE_AREA.height - half)
            return replace(LOWER_CAPTIONS, y=centre - half)


def _caption_size(text: str, area: Box, style: CaptionStyle) -> float:
    """The font size for a caption line: the style's, or smaller if the line (with its outline) would
    be wider than its area at that size."""
    outline = style.outline
    width = font_metrics(style.font).width(text, style.size) + 2 * outline
    if width <= area.width:
        return style.size
    return math.floor(style.size * (area.width - 2 * outline) / (width - 2 * outline) * 10) / 10


def _caption_text(text: str, uppercase: bool = True) -> tuple[str, bool]:
    """A Word as captions show it, in UPPERCASE (or its own case) without the punctuation at its ends
    (empty when it is all punctuation), and whether it ends a sentence."""

    def punctuation(char: str) -> bool:
        return unicodedata.category(char)[0] == "P" and char not in _SIGNS

    shown = text.strip()
    first, last = 0, len(shown)
    while first < last and punctuation(shown[first]):
        first += 1
    while last > first and punctuation(shown[last - 1]):
        last -= 1
    ends_sentence = any(char in ".?!…" for char in shown[last:])
    marks = "".join(char for char in shown[last:] if char in "?!")
    shown = shown[first:last] + marks
    return (shown.upper() if uppercase else shown) if first < last else "", ends_sentence


def _merge_short(edges: list[float]) -> list[tuple[float, float]]:
    """The Scenes between `edges`, with each one shorter than MIN_SCENE_SECS joined to the Scene
    before it (the first to the one after it)."""
    shots: list[tuple[float, float]] = []
    for a, b in zip(edges, edges[1:]):
        if shots and b - a < MIN_SCENE_SECS - 1e-9:
            shots[-1] = (shots[-1][0], b)
        else:
            shots.append((a, b))
    if len(shots) > 1 and shots[0][1] - shots[0][0] < MIN_SCENE_SECS - 1e-9:
        shots[:2] = [(shots[0][0], shots[1][1])]
    return shots


def _face_count(frames: list[FrameFaces]) -> int:
    """How many faces a Scene shows: the median count of LAYOUT_SAMPLES of its sampled frames, spread
    evenly through it (all of them in a Scene with fewer), so that a missed or false detection or two
    doesn't change it."""
    if not frames:
        return 0
    if len(frames) > LAYOUT_SAMPLES:
        frames = [frames[(2 * i + 1) * len(frames) // (2 * LAYOUT_SAMPLES)] for i in range(LAYOUT_SAMPLES)]
    counts = sorted(len(frame.faces) for frame in frames)
    return counts[len(counts) // 2]


def _choose(layout: Layout, count: int | None) -> SceneLayout:
    """The Scene's Layout: the override, or by its face count (Track when it wasn't analysed)."""
    if layout is not Layout.AUTO:
        return SceneLayout(layout.value)
    if count is None or count == 1:
        return SceneLayout.TRACK
    return SceneLayout.SPLIT if count == 2 else SceneLayout.BLUR


def _track(start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning) -> Panel:
    """A full-height 9:16 crop that follows the speaker's face through the Scene from `start` to `end`;
    in the middle of the frame while no face is known."""
    panel = _centre_crop(source.width, source.height)
    if not faces:
        return replace(panel, path=[replace(panel.path[0], at=start)])
    tracked = _track_faces(faces, source.width, source.height, camera)
    return _follow(panel, _follow_speaker(tracked, source.fps, camera), start, end, source, camera)


def _split(start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning) -> list[Panel]:
    """Two 9:8 crops, each half as wide as the frame, for the panels stacked top and bottom: the
    two faces seen most in the Scene's sampled frames `faces`, each followed by its own camera, the
    left one's on top. Without `faces`, the frame's left half on top and its right half below."""
    width, height = source.width, source.height
    crop_width = _even_floor(width / 2)
    crop_height = _even(crop_width * SPLIT_HEIGHT / OUTPUT_WIDTH)
    if crop_height > _even_floor(height):
        crop_height = _even_floor(height)
        crop_width = _even(crop_height * OUTPUT_WIDTH / SPLIT_HEIGHT)
    y = _centred(height, crop_height)
    halves = [
        Panel(Box(0, i * SPLIT_HEIGHT, OUTPUT_WIDTH, SPLIT_HEIGHT), crop_width, crop_height,
              [CropPoint(start, min(max(_even(centre - crop_width / 2), 0), _even_floor(width - crop_width)), y)])
        for i, centre in enumerate((width / 4, width * 3 / 4))
    ]
    if not faces:
        return halves
    tracked = _track_faces(faces, width, height, camera)
    seen = Counter(id for frame in tracked for id in frame.faces)
    area = Counter()
    for frame in tracked:
        for id, face in frame.faces.items():
            area[id] += face.width * face.height
    pair = sorted(seen, key=lambda id: (-seen[id], -area[id]))[:2]
    if len(pair) < 2:
        return halves
    centre = {id: sum(f.faces[id].centre_x for f in tracked if id in f.faces) / seen[id] for id in pair}
    pair.sort(key=centre.__getitem__)
    rise = (0.5 - SPLIT_FACE_AT) * crop_height
    return [
        _follow(panel, [(frame.at, frame.faces.get(id)) for frame in tracked], start, end, source, camera, rise)
        for panel, id in zip(halves, pair)
    ]


def _blur(start: float, source: SourceMetadata) -> list[Panel]:
    """The whole frame as large as fits in the output, centred over the full-height 9:16 crop from its
    middle, blurred, which fills the output."""
    background = _centre_crop(source.width, source.height)
    background = replace(background, path=[replace(background.path[0], at=start)], blur=True)
    return [background, _fitted(source.width, source.height, start)]


def _follow(
    panel: Panel,
    targets: list[tuple[float, Face | None]],
    start: float,
    end: float,
    source: SourceMetadata,
    camera: CameraTuning,
    rise: float = 0.0,
) -> Panel:
    """`panel` with its crop following the face of `targets` (its box at each sampled frame, or None
    where it isn't seen) through the Scene from `start` to `end`, a Smooth Camera on each axis. The
    crop's centre is aimed `rise` pixels below the face's centre, so that the face sits above the
    middle."""
    width, height = panel.crop_width, panel.crop_height
    axes = [
        _camera_path(
            [(at, None if face is None else centre(face)) for at, face in targets],
            start, end, source.fps, size / 2, frame - size / 2, size, camera,
        )
        for centre, size, frame in (
            (lambda face: face.centre_x, width, source.width),
            (lambda face: face.centre_y + rise, height, source.height),
        )
    ]
    highest_x, highest_y = _even_floor(source.width - width), _even_floor(source.height - height)
    path: list[CropPoint] = []
    for (at, centre_x), (_, centre_y) in zip(*axes):
        x = min(max(_even(centre_x - width / 2), 0), highest_x)
        y = min(max(_even(centre_y - height / 2), 0), highest_y)
        if not path:
            path.append(CropPoint(start, x, y))
        elif (x, y) != (path[-1].x, path[-1].y):
            path.append(CropPoint(round(at, 3), x, y))
    return replace(panel, path=path)


@dataclass(frozen=True)
class _TrackedFrame:
    """A sampled frame's faces by identity, and the score of every identity seen so far in the Scene."""

    at: float
    faces: dict[int, Face]
    scores: dict[int, float]


def _track_faces(frames: list[FrameFaces], width: int, height: int, camera: CameraTuning) -> list[_TrackedFrame]:
    """Identify the faces of one Scene's sampled frames (in time order, `width` x `height` pixels): a
    face is the same as the one last seen nearest to it, if that is within camera.match_distance x
    `width`. Each identity's score is its area as a share of the frame, summed over the frames it is
    seen in with camera.score_decay at every frame, so a face that is large and often seen scores high."""
    limit = camera.match_distance * width
    centres: dict[int, tuple[float, float]] = {}
    scores: dict[int, float] = {}
    tracked = []
    for frame in frames:
        scores = {id: score * camera.score_decay for id, score in scores.items()}
        pairs = sorted(
            (distance, i, id)
            for i, face in enumerate(frame.faces)
            for id, (x, y) in centres.items()
            if (distance := math.hypot(face.centre_x - x, face.centre_y - y)) < limit
        )
        matched: dict[int, int] = {}
        for _, i, id in pairs:
            if i not in matched and id not in matched.values():
                matched[i] = id
        seen = {}
        for i, face in enumerate(frame.faces):
            id = matched.get(i, len(centres))
            centres[id] = (face.centre_x, face.centre_y)
            scores[id] = scores.get(id, 0.0) + face.width * face.height / (width * height)
            seen[id] = face
        tracked.append(_TrackedFrame(frame.at, seen, dict(scores)))
    return tracked


def _follow_speaker(tracked: list[_TrackedFrame], fps: float, camera: CameraTuning) -> list[tuple[float, Face | None]]:
    """The Speaker Tracker: the face to follow at each of one Scene's sampled frames, or None where it
    isn't seen. The first face seen is followed, the highest-scoring if there are several. Another face
    seen takes over once its score is over camera.stickiness x the target's, unless the target changed
    less than camera.cooldown_frames ago."""
    cooldown = camera.cooldown_frames / fps
    target: int | None = None
    since = 0.0
    follow = []
    for frame in tracked:
        rivals = [id for id in frame.faces if id != target]
        best = max(rivals, key=frame.scores.__getitem__, default=None)
        if best is not None and (
            target is None
            or frame.at - since >= cooldown and frame.scores[best] > camera.stickiness * frame.scores[target]
        ):
            target, since = best, frame.at
        follow.append((frame.at, frame.faces.get(target) if target is not None else None))
    return follow


def _camera_path(
    targets: list[tuple[float, float | None]],
    start: float,
    end: float,
    fps: float,
    lowest: float,
    highest: float,
    crop: float,
    camera: CameraTuning,
) -> list[tuple[float, float]]:
    """The Smooth Camera along one axis: where the crop's centre is at each frame of the Scene from
    `start` to `end` (seconds into the Clip, frames at multiples of 1/`fps`), kept between `lowest`
    and `highest`, for a crop `crop` pixels long on that axis. `targets` are the target face's centre
    at the sampled frames, in time order, or None where it wasn't seen.

    The camera starts on the target's first known position (in the middle without one) and heads
    for a goal, which moves to where the target is seen once the target leaves the dead-zone around
    it. A target seen farther from where it was last seen than the dead-zone's half-width has jumped:
    it counts once camera.confirmations detections in a row have jumped the same way, so that one
    wrong detection is ignored. Missing detections leave
    the goal where it is. Between the sampled frames, and towards a new goal, the camera moves as a
    critically damped spring, at most camera.max_speed crops a second."""
    zone = camera.dead_zone * crop / 2
    top_speed = camera.max_speed * crop
    step = 1 / fps

    def inside(value: float) -> float:
        return min(max(value, lowest), highest)

    known = [inside(at) for _, at in targets if at is not None]
    goal = known[0] if known else inside((lowest + highest) / 2)
    position, speed = goal, 0.0
    # Where the target was last seen, and the detections since that jumped away from it.
    trail = goal
    jumped: list[float] = []
    upcoming = iter(targets)
    pending = next(upcoming, None)
    path = []
    for frame in range(math.ceil(start * fps - 1e-6), math.ceil(end * fps - 1e-6)):
        at = frame * step
        while pending is not None and pending[0] <= at + 1e-6:
            if pending[1] is not None:
                seen = inside(pending[1])
                if abs(seen - trail) > zone:
                    if jumped and (jumped[-1] > trail) != (seen > trail):
                        jumped.clear()
                    jumped.append(seen)
                if abs(seen - trail) <= zone or len(jumped) >= camera.confirmations:
                    trail = seen
                    jumped.clear()
                    if abs(trail - goal) > zone:
                        goal = trail
            pending = next(upcoming, None)
        if path:
            position, speed = _spring(position, speed, goal, camera.spring_rate, step, top_speed)
        path.append((at, position))
    return path


def _spring(position: float, speed: float, goal: float, rate: float, step: float, top_speed: float) -> tuple[float, float]:
    """One step of a critically damped spring pulling `position` towards `goal`, solved exactly, then
    held to `top_speed` and stopped at the goal rather than past it."""
    offset = position - goal
    decay = math.exp(-rate * step)
    pull = speed + rate * offset
    moved = (offset + pull * step) * decay
    speed = (speed - rate * pull * step) * decay
    limit = top_speed * step
    moved = offset + min(max(moved - offset, -limit), limit)
    speed = min(max(speed, -top_speed), top_speed)
    if offset and moved * offset <= 0:
        return goal, 0.0
    return goal + moved, speed


def _centre_crop(width: int, height: int) -> Panel:
    """The full-height 9:16 crop from the middle of a landscape (or square) frame."""
    crop_height = _even_floor(height)
    crop_width = min(_even(crop_height * OUTPUT_WIDTH / OUTPUT_HEIGHT), _even_floor(width))
    x = _centred(width, crop_width)
    y = _centred(height, crop_height)
    return Panel(Box(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT), crop_width, crop_height, [CropPoint(0.0, x, y)])


def _fitted(width: int, height: int, start: float) -> Panel:
    """The whole frame, as large as fits in the output and centred in it: a 9:16 one fills it."""
    crop_width, crop_height = _even_floor(width), _even_floor(height)
    scale = min(OUTPUT_WIDTH / crop_width, OUTPUT_HEIGHT / crop_height)
    area_width = min(_even(crop_width * scale), OUTPUT_WIDTH)
    area_height = min(_even(crop_height * scale), OUTPUT_HEIGHT)
    area = Box(_centred(OUTPUT_WIDTH, area_width), _centred(OUTPUT_HEIGHT, area_height), area_width, area_height)
    return Panel(area, crop_width, crop_height, [CropPoint(start, 0, 0)])


# Sizes and offsets are kept even: 4:2:0 video can't be cut at odd pixels.
def _even(value: float) -> int:
    return 2 * round(value / 2)


def _even_floor(value: float) -> int:
    return 2 * int(value // 2)


def _centred(outer: int, inner: int) -> int:
    """The even offset that centres `inner` pixels in `outer` most nearly, keeping it inside."""
    return min(_even((outer - inner) / 2), _even_floor(outer - inner))
