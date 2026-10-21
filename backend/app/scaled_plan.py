"""A Render Plan drawn at another size (docs/adr/0021-export-presets-and-a-plan-drawn-at-any-size.md).

The planner works in 1080×1920 output pixels whatever the Export Settings' resolution: the preview,
the Preview Plan, the plan file beside a Clip and every saved position are in them. The renderer
draws a plan at the output's size by `scaled_plan`: every coordinate and size the plan holds in
output pixels is multiplied by one factor, the output's height over the plan's (2/3 at 720p, 2 at
4K). What is in other pixels stays: a Scene's crops and their paths are in the Source's, a Picture's
crop and item size in its item's; and times, Eases, scales, rotations and opacities have no pixels.

- A Scene's panels' areas are scaled even and kept inside the frame, as the planner lays them,
  since `pad` and `overlay` take even places on 4:2:0 frames. Its `framing` (a Candidate's, what a
  switch to Manual starts from) isn't drawn and stays as it is.
- A Picture's drawn size (even), centre, bounds, corners, border, shadow and the Keyframes of its
  centre are scaled; its drawn size at scale 1 too, so that a keyed scale still gives its size.
  An Overlay's Video Effects' sizes (docs/adr/0014) are scaled with it.
- A picture layer's picture is rasterised at the output's size: its layout's scale is multiplied by
  the factor (under MAX_LAYER_PICTURE, as `picture_scale` keeps it), which names another picture
  (`PictureLayout.name` hashes the scale) of the same `picture_key`, so that a 4K picture and a
  1080 one of the same layer don't collide.
- The captions' and the hook's boxes, sizes and anchors and the Watermark's area are scaled, so
  that the plan is whole. The renderer, though, writes their ASS script from the plan in its own
  pixels (PlayRes 1080×1920, which its styles' sizes, outlines and shadows are in), and libass
  scales it to the frame, drawing the text sharp at any size. The Logo is laid over by the scaled area.

A plan at its own size is itself.
"""

from dataclasses import replace

from app.candidates import Keyframe, KeyProperty, Keys
from app.pictures import turned_size
from app.video_effects import scaled_effects
from app.planner import (
    FRAME,
    MAX_LAYER_PICTURE,
    Box,
    HookEvent,
    Picture,
    PictureLayer,
    RenderPlan,
    ScenePlan,
    TextEvent,
)


def scaled_plan(plan: RenderPlan, size: tuple[int, int]) -> RenderPlan:
    """`plan` as drawn in a `size` (width, height) frame: itself at its own size."""
    if size == (plan.width, plan.height):
        return plan
    k = size[1] / plan.height
    watermark = plan.watermark
    return replace(
        plan,
        width=size[0],
        height=size[1],
        scenes=[_scaled_scene(scene, k, size) for scene in plan.scenes],
        captions=[replace(event, area=_scaled_box(event.area, k), size=event.size * k) for event in plan.captions],
        hook=None if plan.hook is None else _scaled_hook(plan.hook, k),
        watermark=None if watermark is None else replace(watermark, area=_scaled_box(watermark.area, k), size=watermark.size * k),
        overlays=[
            replace(event, picture=_scaled_picture(event.picture, k), video_effects=scaled_effects(event.video_effects, k)) for event in plan.overlays
        ],
        texts=[_scaled_layer(event, k) for event in plan.texts],
        shapes=[_scaled_layer(event, k) for event in plan.shapes],
    )


def drawn_scale(plan: RenderPlan) -> float:
    """How many of a drawn plan's pixels one of the planner's output pixels is: 1 for a plan at the
    planner's size, 2 for one drawn at 4K. What the renderer has in the planner's pixels (Blur's
    tuning, a Slide's distance) is scaled by it."""
    return plan.height / FRAME[1]


def _scaled_scene(scene: ScenePlan, k: float, size: tuple[int, int]) -> ScenePlan:
    return replace(
        scene,
        panels=[replace(panel, area=_scaled_area(panel.area, k, size)) for panel in scene.panels],
        picture=None if scene.picture is None else _scaled_picture(scene.picture, k),
        ignored=_scaled_keys(scene.ignored, k),
    )


def _scaled_hook(hook: HookEvent, k: float) -> HookEvent:
    kicker = hook.kicker
    return replace(
        hook,
        area=_scaled_box(hook.area, k),
        size=hook.size * k,
        anchors=[(x * k, y * k) for x, y in hook.anchors],
        boxes=[_scaled_box(box, k) for box in hook.boxes],
        kicker=None if kicker is None else replace(
            kicker, size=kicker.size * k, box=_scaled_box(kicker.box, k), anchor=(kicker.anchor[0] * k, kicker.anchor[1] * k)
        ),
        quote=None if hook.quote is None else _scaled_box(hook.quote, k),
    )


def _scaled_layer(event: PictureLayer, k: float) -> PictureLayer:
    """A picture layer with its picture rasterised `k` times as large (under the cap) and placed `k`
    times as far."""
    layout = event.layout
    scale = round(min(layout.scale * k, MAX_LAYER_PICTURE / max(layout.width, layout.height)), 4)
    layout = replace(layout, scale=scale)
    picture = replace(_scaled_picture(event.picture, k), crop=Box(0, 0, *layout.raster), item_size=layout.raster)
    scaled = replace(event, layout=layout, picture=picture, area=_scaled_box(event.area, k), bounds=_scaled_box(event.bounds, k))
    if isinstance(scaled, TextEvent):
        box = scaled.box
        scaled = replace(scaled, anchors=[(x * k, y * k) for x, y in scaled.anchors], box=None if box is None else _scaled_box(box, k))
    return scaled


def _scaled_picture(picture: Picture, k: float) -> Picture:
    """`picture` drawn `k` times as large and as far, its bounds as the planner works them out from
    that; its item's pixels as they were."""
    width, height = _even(picture.width * k), _even(picture.height * k)
    x, y = round(picture.centre[0] * k, 2), round(picture.centre[1] * k, 2)
    across, down = turned_size(width, height, picture.rotation)
    border, shadow, unscaled = picture.border, picture.shadow, picture.unscaled
    return replace(
        picture,
        width=width,
        height=height,
        centre=(x, y),
        bounds=Box(round(x - across / 2), round(y - down / 2), round(across), round(down)),
        radius=picture.radius * k,
        border=None if border is None else replace(border, width=max(1, round(border.width * k))),
        shadow=None if shadow is None else replace(shadow, blur=shadow.blur * k, x=shadow.x * k, y=shadow.y * k),
        motion=_scaled_keys(picture.motion, k),
        unscaled=None if unscaled is None else (unscaled[0] * k, unscaled[1] * k),
    )


def _scaled_keys(keys: Keys, k: float) -> Keys:
    """`keys` with the centre's values (x and y, in output pixels) scaled; the rest have no pixels."""
    return {
        prop: [Keyframe(key.at, key.value * k, key.ease) for key in given] if prop in (KeyProperty.X, KeyProperty.Y) else given
        for prop, given in keys.items()
    }


def _scaled_box(box: Box, k: float) -> Box:
    return Box(round(box.x * k), round(box.y * k), round(box.width * k), round(box.height * k))


def _scaled_area(area: Box, k: float, size: tuple[int, int]) -> Box:
    """A panel's area at `size`: even on every side, as the planner lays panels, and inside the frame."""
    width, height = min(_even(area.width * k), size[0]), min(_even(area.height * k), size[1])
    x, y = min(max(_even(area.x * k), 0), size[0] - width), min(max(_even(area.y * k), 0), size[1] - height)
    return Box(x, y, width, height)


def _even(value: float) -> int:
    return max(2, 2 * round(value / 2))
