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
"""

from collections.abc import Callable
from dataclasses import dataclass

from app.candidates import TransitionKind
from app.planner import TransitionEvent

# A filter chain on one side of a join (filters joined by commas), made for its Transition and for
# when the overlap starts in that side's own seconds: the outgoing side's are the Clip's, the
# incoming side's start at 0. It enables itself only over the overlap.
SideChain = Callable[[TransitionEvent, float], str]


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

RECIPES: dict[TransitionKind, Recipe] = {kind: Recipe(xfade=kind.value) for kind in BUILT_INS}
