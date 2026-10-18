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


RECIPES: dict[TransitionKind, Recipe] = {
    TransitionKind.FADE: Recipe(xfade="fade"),
    TransitionKind.FADEBLACK: Recipe(xfade="fadeblack"),
    TransitionKind.FADEWHITE: Recipe(xfade="fadewhite"),
    TransitionKind.SLIDELEFT: Recipe(xfade="slideleft"),
    TransitionKind.SLIDERIGHT: Recipe(xfade="slideright"),
    TransitionKind.SLIDEUP: Recipe(xfade="slideup"),
    TransitionKind.SLIDEDOWN: Recipe(xfade="slidedown"),
    TransitionKind.WIPELEFT: Recipe(xfade="wipeleft"),
    TransitionKind.ZOOMIN: Recipe(xfade="zoomin"),
    TransitionKind.CIRCLEOPEN: Recipe(xfade="circleopen"),
}
