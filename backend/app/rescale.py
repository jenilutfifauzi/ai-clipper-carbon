"""Rescaling a Candidate onto another Canvas when its Canvas Aspect changes (docs/adr/0022), once, so
that its edit looks the same on the new shape. Pure, so that the PATCH, a draft's Preview Plan and
the MCP tools share one rule (app/review.py runs it), and so that a Template made on another aspect
can later be laid on with it.

Only what the Candidate owns is in its Canvas's pixels and moves: its Transforms (of its Framing,
Segments, Overlays, Text Layers, Shapes and Layout Overrides), their Keyframes and its Cue Edits.
Its Style keeps its places in the Reference Space, which the planner maps onto every Canvas.
- A centre keeps its fraction of the Canvas.
- A Framing (a media Segment's, the Source's in Manual, a Layout Override's) keeps its scale relative
  to the scale that covers the frame: a picture that filled the frame still fills it.
- An Overlay keeps its drawn size in pixels: its scale times its fitted size on the old Canvas over
  its fitted size on the new. A Text Layer and a Shape are drawn at their own size, which no Canvas
  fits, so their scale stays.
- A scale Keyframe follows its item's rule, and everything is kept on the new Canvas and within a
  Transform's scales."""

from collections.abc import Mapping
from dataclasses import replace

from app.candidates import (
    MAX_SCALE,
    MIN_SCALE,
    Candidate,
    Crop,
    CueEdit,
    Framing,
    Keyframe,
    KeyProperty,
    Keys,
    Transform,
)
from app.canvas import Aspect, canvas_for
from app.pictures import cover_scale, fitted, kept

# Pictures' sizes (a Media Library item's, or the Source's), by id.
type Sizes = Mapping[str, tuple[int, int]]


def rescaled(candidate: Candidate, aspect: Aspect, sizes: Sizes, source: tuple[int, int] | None) -> Candidate:
    """`candidate` on the Canvas of `aspect`, its own positions rescaled from its Canvas's (see the
    module): the Media Library items' `sizes` and the `source`'s size fit its pictures. A picture of
    unknown size keeps its scale; its centre still moves."""
    old, new = candidate.canvas, canvas_for(aspect)
    if old == new:
        return replace(candidate, aspect=aspect)
    across, down = new.width / old.width, new.height / old.height

    def cover(size: tuple[int, int] | None, crop: Crop) -> float:
        """How much a Framing's scale grows: it keeps its share of the cover scale."""
        if size is None:
            return 1.0
        _, _, width, height = kept(*size, crop)
        return cover_scale(width, height, new.size) / cover_scale(width, height, old.size)

    def fit(size: tuple[int, int] | None, crop: Crop) -> float:
        """How much an Overlay's scale grows: its drawn size is kept."""
        if size is None:
            return 1.0
        _, _, width, height = kept(*size, crop)
        return fitted(width, height, old.size)[0] / fitted(width, height, new.size)[0]

    def moved(transform: Transform, grows: float) -> Transform:
        return replace(
            transform,
            x=_on(transform.x * across, new.width),
            y=_on(transform.y * down, new.height),
            scale=_scale(transform.scale * grows),
        )

    def keyed(keys: Keys, grows: float) -> Keys:
        def key(prop: KeyProperty, given: Keyframe) -> Keyframe:
            if prop is KeyProperty.X:
                return replace(given, value=_on(given.value * across, new.width))
            if prop is KeyProperty.Y:
                return replace(given, value=_on(given.value * down, new.height))
            if prop is KeyProperty.SCALE:
                return replace(given, value=_scale(given.value * grows))
            return given

        return {prop: [key(prop, given) for given in values] for prop, values in keys.items()}

    def framed(framing: Framing | None, size: tuple[int, int] | None) -> Framing | None:
        if framing is None:
            return None
        return replace(framing, transform=moved(framing.transform, cover(size, framing.crop)))

    def cue(edit: CueEdit) -> CueEdit:
        x = None if edit.x is None else round(_on(edit.x * across, new.width))
        y = None if edit.y is None else round(_on(edit.y * down, new.height))
        return replace(edit, x=x, y=y)

    segments = []
    for segment in candidate.segments:
        if segment.framing is None:
            segments.append(segment)
            continue
        size = sizes.get(segment.media) if segment.media else None
        grows = cover(size, segment.framing.crop)
        segments.append(replace(segment, framing=framed(segment.framing, size), keys=keyed(segment.keys, grows)))
    overrides = []
    for override in candidate.layout_overrides:
        grows = cover(source, override.framing.crop) if override.framing else 1.0
        overrides.append(replace(override, framing=framed(override.framing, source), keys=keyed(override.keys, grows)))
    overlays = []
    for overlay in candidate.overlays:
        grows = fit(sizes.get(overlay.media), overlay.crop)
        overlays.append(replace(overlay, transform=moved(overlay.transform, grows), keys=keyed(overlay.keys, grows)))
    return replace(
        candidate,
        aspect=aspect,
        framing=framed(candidate.framing, source),
        segments=segments,
        layout_overrides=overrides,
        overlays=overlays,
        text_layers=[replace(layer, transform=moved(layer.transform, 1.0), keys=keyed(layer.keys, 1.0)) for layer in candidate.text_layers],
        shapes=[replace(shape, transform=moved(shape.transform, 1.0), keys=keyed(shape.keys, 1.0)) for shape in candidate.shapes],
        cue_edits=[cue(edit) for edit in candidate.cue_edits],
    )


def _on(value: float, most: float) -> float:
    """A centre on the Canvas, to a hundredth of a pixel (as the planner places it)."""
    return round(min(max(value, 0.0), most), 2)


def _scale(value: float) -> float:
    return round(min(max(value, MIN_SCALE), MAX_SCALE), 6)
