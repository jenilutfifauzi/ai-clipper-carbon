"""A Transition's kinds, lengths and sounds: a Candidate's Transitions (app/candidates.py) and a Style
Preset's Join Transition (app/styles.py) have them."""

from enum import StrEnum


class TransitionKind(StrEnum):
    """How one Segment gives way to the next: its stored id, rendered by its recipe (app/transitions.py).
    By the Transitions tab's groups: Basic, Slide, Wipe, Shape, Zoom, Light and Glitch."""

    FADE = "fade"
    FADEBLACK = "fadeblack"
    FADEWHITE = "fadewhite"
    FADEGRAYS = "fadegrays"
    DIPCOLOUR = "dipcolour"
    DISSOLVE = "dissolve"
    SLIDELEFT = "slideleft"
    SLIDERIGHT = "slideright"
    SLIDEUP = "slideup"
    SLIDEDOWN = "slidedown"
    COVERLEFT = "coverleft"
    COVERRIGHT = "coverright"
    COVERUP = "coverup"
    COVERDOWN = "coverdown"
    WIPELEFT = "wipeleft"
    WIPERIGHT = "wiperight"
    WIPEUP = "wipeup"
    WIPEDOWN = "wipedown"
    RADIAL = "radial"
    CIRCLEOPEN = "circleopen"
    CIRCLECLOSE = "circleclose"
    CIRCLECROP = "circlecrop"
    RECTCROP = "rectcrop"
    VERTOPEN = "vertopen"
    HORZOPEN = "horzopen"
    ZOOMIN = "zoomin"
    SQUEEZEH = "squeezeh"
    SQUEEZEV = "squeezev"
    FILMBURN = "filmburn"
    LIGHTLEAK = "lightleak"
    RGBSPLIT = "rgbsplit"
    PIXELIZE = "pixelize"
    HBLUR = "hblur"
    DISTANCE = "distance"
    HLSLICE = "hlslice"


# How long a Transition can be, and a new one's length.
TRANSITION_SECS = (0.1, 3.0)
TRANSITION_DEFAULT_SECS = 0.5


class TransitionSound(StrEnum):
    """How a Transition's sound crosses, whatever its kind: in straight lines, along quarter sines, or
    switched at its middle."""

    LINEAR = "linear"
    EQUAL_POWER = "equal_power"
    CUT = "cut"
