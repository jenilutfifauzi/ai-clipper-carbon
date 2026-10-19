"""The Transition catalogue (docs/adr/0012-transitions-are-recipes-around-one-xfade.md): how each
kind is rendered, as a recipe around one xfade.

A recipe is:
- optionally, a filter chain on the outgoing picture and one on the incoming picture, each enabled
  only over the overlap;
- then one `xfade`: one of its own transitions, by name. No recipe takes a `custom` expression
  (ADR 0012's render budget).

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

from app.planner import TransitionEvent
from app.transition_kinds import TransitionKind


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
    """How a kind is rendered: xfade's own transition named `xfade`; and before it, the `outgoing`
    and `incoming` sides' chains, if any."""

    xfade: str
    outgoing: SideChain | None = None
    incoming: SideChain | None = None


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

# Each strength-reading kind's strength when its Transition's is unset (a Spin's third is one turn).
STRENGTHS = {
    TransitionKind.FILMBURN: 0.6, TransitionKind.LIGHTLEAK: 0.7, TransitionKind.RGBSPLIT: 0.5,
    TransitionKind.BLURDISSOLVE: 0.5, TransitionKind.WHIPLEFT: 0.5, TransitionKind.WHIPRIGHT: 0.5,
    TransitionKind.ZOOMBLUR: 0.5, TransitionKind.SPIN: 1 / 3, TransitionKind.GLITCH: 0.5,
}


def strength(event: TransitionEvent) -> float:
    """The Transition's strength, or its kind's own when unset."""
    return event.strength if event.strength is not None else STRENGTHS[event.kind]


def _overlap(event: TransitionEvent, side: Side) -> str:
    """The timeline `enable` of the overlap, in the side's seconds."""
    return f"enable='between(t,{side.start:.3f},{side.start + event.length:.3f})'"


def _peak(event: TransitionEvent, side: Side) -> str:
    """An expression in the side's `t`: 0 at either end of the overlap, 1 at its middle."""
    half = event.length / 2
    return f"max(0,1-abs(t-{side.start + half:.4f})/{half:.4f})"


def _dipped(event: TransitionEvent, side: Side) -> str:
    """Dip to colour: the outgoing picture faded out to the colour over the first half, the incoming
    one in from it over the second, so the middle is the colour alone."""
    half = event.length / 2
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
    length, name = event.length, side.name
    # Its share at each point of the band: the brightness at the middle of the overlap, less towards
    # either end of it and away from the band's line (the points whose (X/W + Y/H)/2 is its place).
    alpha = f"255*{strength(event):.3f}*(1-abs(2*T/{length:.4f}-1))*max(0,1-abs((X/W+Y/H)/2+0.3-1.6*T/{length:.4f})*2.5)"
    return (
        f"null[{name}p];"
        f"color=c=black@0:s=48x48:r=30:d={length:.4f},format=rgba,geq=r=255:g=214:b=150:a='{alpha}',"
        f"scale={side.width}x{side.height},setpts=PTS+{side.start:.4f}/TB[{name}l];"
        f"[{name}p][{name}l]overlay=eof_action=pass"
    )


def _overlapped(event: TransitionEvent, side: Side, filters: str) -> str:
    """`filters` on the overlap alone, for those that take planar RGB (`rgbashift`): the overlap is
    taken out (trimmed), filtered and brought back to the Clip's pixel format, and the side put back
    together, so the rest of the side isn't converted (5 ms a frame at 1080x1920)."""
    name, filtered = side.name, f"{filters},format=yuv420p"
    # The outgoing side's overlap is its end, the incoming side's its start.
    if side.incoming:
        edge = event.length
        before, after = f"trim=end={edge:.4f},{filtered}", f"trim=start={edge:.4f},setpts=PTS-STARTPTS"
    else:
        before, after = f"trim=end={side.start:.4f}", f"trim=start={side.start:.4f},setpts=PTS-STARTPTS,{filtered}"
    return f"split[{name}a][{name}b];[{name}a]{before}[{name}c];[{name}b]{after}[{name}d];[{name}c][{name}d]concat=n=2:v=1:a=0"


def _split(event: TransitionEvent, side: Side) -> str:
    """RGB split: the red picture moved one way and the blue the other by the spread (at most a 27th
    of the width), over the overlap only."""
    spread = round(strength(event) * side.width / 27)
    return _overlapped(event, side, f"rgbashift=rh={-spread}:bh={spread}")


def _blurred(event: TransitionEvent, side: Side, sigma: float, across: bool = False) -> str:
    """`gblur` over the overlap, rising to `sigma` at its middle and falling back, or `across` only.
    gblur's sigma takes no expression, so `sendcmd` steps it 30 times a second."""
    length, blur = event.length, f"gblur@{side.name}"
    steps = max(2, round(length * 30))
    sigmas = (sigma * (1 - abs(2 * k / steps - 1)) for k in range(steps + 1))
    commands = ";".join(f"{side.start + length * k / steps:.4f} {blur} sigma {each:.2f}" for k, each in enumerate(sigmas))
    return f"sendcmd=c='{commands}',{blur}=sigma=0{':sigmaV=0' if across else ''}:{_overlap(event, side)}"


def _dissolved(event: TransitionEvent, side: Side) -> str:
    """Blur dissolve: both pictures blurred, most at the middle, by up to a 27th of the width."""
    return _blurred(event, side, strength(event) * side.width / 27)


def _whipped(event: TransitionEvent, side: Side) -> str:
    """Whip pan: both pictures smeared across, most at the middle, by up to an eighth of the width,
    as xfade's push carries them along."""
    return _blurred(event, side, strength(event) * side.width / 8, across=True)


def _zoomed(event: TransitionEvent, side: Side) -> str:
    """Zoom blur: both pictures scaled up about their middles, most at the middle of the overlap (by
    up to 60% of their size), cut back to the frame, and blurred along with it. Outside the overlap
    the scale is 1, so `scale` passes the picture on."""
    zoom = f"{0.6 * strength(event):.3f}*{_peak(event, side)}"
    width, height = side.width, side.height
    return (
        f"scale=w='2*trunc({width}*(1+{zoom})/2)':h='2*trunc({height}*(1+{zoom})/2)':eval=frame:flags=fast_bilinear,"
        f"crop={width}:{height}:x='{width / 2}*{zoom}':y='{height / 2}*{zoom}',"
        + _blurred(event, side, strength(event) * side.width / 54)
    )


def _spun(event: TransitionEvent, side: Side) -> str:
    """Spin: both pictures turned together by the turns (half a turn to two), easing in and out, the
    outgoing one from upright and the incoming one to it; and shrunk by up to 30% at the middle so
    their corners show. `rotate` fills what it uncovers with black."""
    turns, length = 0.5 + 1.5 * strength(event), event.length
    share = f"clip((t-{side.start:.4f})/{length:.4f},0,1)"
    eased = f"({share}*{share}*(3-2*{share}){'-1' if side.incoming else ''})"
    size = f"(1-0.3*{_peak(event, side)})"
    width, height = side.width, side.height
    return (
        f"scale=w='2*trunc({width}*{size}/2)':h='2*trunc({height}*{size}/2)':eval=frame:flags=fast_bilinear,"
        f"pad={width}:{height}:x='(ow-iw)/2':y='(oh-ih)/2':eval=frame,"
        f"rotate=a='{2 * turns:.4f}*PI*{eased}':c=black:{_overlap(event, side)}"
    )


def _glitched(event: TransitionEvent, side: Side) -> str:
    """Glitch: the colours torn apart (red one way, blue the other, green down) by up to an 18th of
    the width, and flickering noise, over the overlap only, while xfade slices one picture into the
    other."""
    amount = strength(event)
    spread = round(amount * side.width / 18)
    return _overlapped(event, side, f"rgbashift=rh={-spread}:bh={spread}:gv={spread // 3},noise=alls={round(60 * amount)}:allf=t+u")


RECIPES: dict[TransitionKind, Recipe] = {kind: Recipe(xfade=kind.value) for kind in BUILT_INS} | {
    TransitionKind.DIPCOLOUR: Recipe(xfade="fade", outgoing=_dipped, incoming=_dipped),
    TransitionKind.FILMBURN: Recipe(xfade="fade", outgoing=_burnt, incoming=_burnt),
    TransitionKind.LIGHTLEAK: Recipe(xfade="fade", outgoing=_leaked, incoming=_leaked),
    TransitionKind.RGBSPLIT: Recipe(xfade="fade", outgoing=_split, incoming=_split),
    TransitionKind.BLURDISSOLVE: Recipe(xfade="fade", outgoing=_dissolved, incoming=_dissolved),
    TransitionKind.WHIPLEFT: Recipe(xfade="slideleft", outgoing=_whipped, incoming=_whipped),
    TransitionKind.WHIPRIGHT: Recipe(xfade="slideright", outgoing=_whipped, incoming=_whipped),
    TransitionKind.ZOOMBLUR: Recipe(xfade="fade", outgoing=_zoomed, incoming=_zoomed),
    TransitionKind.SPIN: Recipe(xfade="fade", outgoing=_spun, incoming=_spun),
    TransitionKind.GLITCH: Recipe(xfade="hlslice", outgoing=_glitched, incoming=_glitched),
}
