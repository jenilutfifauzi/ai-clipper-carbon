"""The Transition catalogue (docs/adr/0012-transitions-are-recipes-around-one-xfade.md): how each
kind is rendered, as a recipe around one xfade.

A recipe is:
- optionally, a filter chain on the outgoing picture and one on the incoming picture, each enabled
  only over the overlap;
- then one `xfade`: one of its own transitions by name, or its `custom` one with an expression
  that reads only `A`, `B`, `X`, `Y`, `P` and constants, never sampling the pictures (ADR 0012's
  render budget).

So the filter graph keeps one xfade (and one acrossfade) per join, whatever the kind. Every
`TransitionKind` has a recipe here, and a CSS look in the preview's catalogue
(frontend/src/pages/job/editor/transitions.ts).

A recipe reads the Transition's knobs: `strength` (0..1, unset for the kind's own, `STRENGTHS`) and
Dip to colour's `colour`. The looks of light and colour are drawn by native filters on the sides,
not by a `custom` expression: even xfade's plainest one (`A*P+B*(1-P)`) took 1-3 s more than `fade`
for a 0.5 s join at 1080x1920, and one clamped to white 8-11 s more.
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.candidates import TransitionKind
from app.planner import TransitionEvent


@dataclass(frozen=True)
class Side:
    """One side of a join, as its chain sees it: when the overlap starts in that side's own seconds
    (the outgoing side's are the Clip's; the incoming side's start at 0, with the overlap), whether
    it is the incoming one, the picture's size, and a name for the chain's own labels."""

    start: float
    incoming: bool
    width: int
    height: int
    name: str


# A filter chain on one side of a join, made for its Transition and its `Side`: filters joined by
# commas, or a graph of its own whose first filter takes the side's picture and whose last one gives
# it. It changes the picture only over the overlap.
SideChain = Callable[[TransitionEvent, Side], str]


@dataclass(frozen=True)
class Recipe:
    """How a kind is rendered: xfade's own transition named `xfade`, or its `custom` one with
    `expr`; and before it, the `outgoing` and `incoming` sides' chains, if any."""

    xfade: str | None = None
    expr: str | None = None
    outgoing: SideChain | None = None
    incoming: SideChain | None = None

    def __post_init__(self) -> None:
        if (self.xfade is None) == (self.expr is None):
            raise ValueError("A recipe's xfade is one of its own transitions or a custom expression, not both or neither")

    @property
    def transition(self) -> str:
        """xfade's `transition` option (and with it, a custom one's expression)."""
        return self.xfade if self.xfade is not None else f"custom:expr='{self.expr}'"


# xfade's own transitions, each a kind of the same name with nothing around it.
BUILT_INS = [
    TransitionKind.FADE, TransitionKind.FADEBLACK, TransitionKind.FADEWHITE, TransitionKind.FADEGRAYS, TransitionKind.DISSOLVE,
    TransitionKind.SLIDELEFT, TransitionKind.SLIDERIGHT, TransitionKind.SLIDEUP, TransitionKind.SLIDEDOWN,
    TransitionKind.COVERLEFT, TransitionKind.COVERRIGHT, TransitionKind.COVERUP, TransitionKind.COVERDOWN,
    TransitionKind.WIPELEFT, TransitionKind.WIPERIGHT, TransitionKind.WIPEUP, TransitionKind.WIPEDOWN, TransitionKind.RADIAL,
    TransitionKind.CIRCLEOPEN, TransitionKind.CIRCLECLOSE, TransitionKind.CIRCLECROP, TransitionKind.RECTCROP,
    TransitionKind.VERTOPEN, TransitionKind.HORZOPEN,
    TransitionKind.ZOOMIN, TransitionKind.SQUEEZEH, TransitionKind.SQUEEZEV,
    TransitionKind.PIXELIZE, TransitionKind.HBLUR, TransitionKind.DISTANCE, TransitionKind.HLSLICE,
]

# Each strength-reading kind's strength when its Transition's is unset.
STRENGTHS = {TransitionKind.FILMBURN: 0.6, TransitionKind.LIGHTLEAK: 0.7, TransitionKind.RGBSPLIT: 0.5}


def strength(event: TransitionEvent) -> float:
    """The Transition's strength, or its kind's own when unset."""
    return event.strength if event.strength is not None else STRENGTHS[event.kind]


def _overlap(event: TransitionEvent, side: Side) -> str:
    """The timeline `enable` of the overlap, in the side's seconds."""
    return f"enable='between(t,{side.start:.3f},{side.start + event.end - event.start:.3f})'"


def _peak(event: TransitionEvent, side: Side) -> str:
    """An expression in the side's `t`: 0 at either end of the overlap, 1 at its middle."""
    half = (event.end - event.start) / 2
    return f"max(0,1-abs(t-{side.start + half:.4f})/{half:.4f})"


def _dipped(event: TransitionEvent, side: Side) -> str:
    """Dip to colour: the outgoing picture faded out to the colour over the first half, the incoming
    one in from it over the second, so the middle is the colour alone."""
    half = (event.end - event.start) / 2
    colour = (event.colour or "#000000").lstrip("#")
    if side.incoming:
        return f"fade=t=in:st={side.start + half:.4f}:d={half:.4f}:c=0x{colour}"
    return f"fade=t=out:st={side.start:.4f}:d={half:.4f}:c=0x{colour}"


def _burnt(event: TransitionEvent, side: Side) -> str:
    """Film burn: a warm flash on both sides, peaking at the middle by the heat: the luma lifted
    (clamped to white) and the chroma turned towards red and away from blue, by `eq`'s per-frame
    brightness and its gammas of the chroma planes."""
    heat, peak = strength(event), _peak(event, side)
    return (
        f"eq=brightness='{0.6 * heat:.3f}*{peak}':gamma_r='1+{1.5 * heat:.3f}*{peak}':gamma_b='1/(1+{1.5 * heat:.3f}*{peak})'"
        f":eval=frame:{_overlap(event, side)}"
    )


def _leaked(event: TransitionEvent, side: Side) -> str:
    """Light leak: a warm, soft band across the picture's diagonal, swept from its top left to its
    bottom right over the overlap and brightest at the middle, laid over both sides alike. The band
    is drawn small (48x48, so its expression costs nothing) and scaled up, smooth, to the picture."""
    length, name = event.end - event.start, side.name
    # Its share at each point of the band: the brightness at the middle of the overlap, less towards
    # either end of it and away from the band's line (the points whose (X/W + Y/H)/2 is its place).
    alpha = f"255*{strength(event):.3f}*(1-abs(2*T/{length:.4f}-1))*max(0,1-abs((X/W+Y/H)/2+0.3-1.6*T/{length:.4f})*2.5)"
    return (
        f"null[{name}p];"
        f"color=c=black@0:s=48x48:r=30:d={length:.4f},format=rgba,geq=r=255:g=214:b=150:a='{alpha}',"
        f"scale={side.width}x{side.height},setpts=PTS+{side.start:.4f}/TB[{name}l];"
        f"[{name}p][{name}l]overlay=eof_action=pass"
    )


def _split(event: TransitionEvent, side: Side) -> str:
    """RGB split: the red picture moved one way and the blue the other by the spread (at most a 27th
    of the width), over the overlap only. `rgbashift` takes planar RGB, so the overlap alone is
    taken out (trimmed), shifted and brought back to the Clip's pixel format, and the side put back
    together, so the rest of the side isn't converted."""
    spread, name = round(strength(event) * side.width / 27), side.name
    shifted = f"rgbashift=rh={-spread}:bh={spread},format=yuv420p"
    # The outgoing side's overlap is its end, the incoming side's its start.
    if side.incoming:
        edge = event.end - event.start
        before, after = f"trim=end={edge:.4f},{shifted}", f"trim=start={edge:.4f},setpts=PTS-STARTPTS"
    else:
        before, after = f"trim=end={side.start:.4f}", f"trim=start={side.start:.4f},setpts=PTS-STARTPTS,{shifted}"
    return f"split[{name}a][{name}b];[{name}a]{before}[{name}c];[{name}b]{after}[{name}d];[{name}c][{name}d]concat=n=2:v=1:a=0"


RECIPES: dict[TransitionKind, Recipe] = {kind: Recipe(xfade=kind.value) for kind in BUILT_INS} | {
    TransitionKind.DIPCOLOUR: Recipe(xfade="fade", outgoing=_dipped, incoming=_dipped),
    TransitionKind.FILMBURN: Recipe(xfade="fade", outgoing=_burnt, incoming=_burnt),
    TransitionKind.LIGHTLEAK: Recipe(xfade="fade", outgoing=_leaked, incoming=_leaked),
    TransitionKind.RGBSPLIT: Recipe(xfade="fade", outgoing=_split, incoming=_split),
}
