"""The Render Planner: how a Clip is cut from its Source and framed in the 1080×1920 output, as a
Render Plan that the Renderer executes. Pure, so it is tested on synthetic input (Seam B): the Clip's
Scenes and face detections are found before planning (app/analysis.py) and passed in.

A landscape Source is reframed with a full-height 9:16 crop per Scene (Track), which follows the
speaker's face:
- the Speaker Tracker gives each face an identity across the Scene's sampled frames and picks the one
  to follow, the largest and most often seen, sticking with it unless another clearly takes over;
- the Smooth Camera moves the crop towards the target face like a critically damped spring, once a
  face leaves its dead-zone, ignoring a detection that jumps away until others confirm it, and holds
  still while the face is lost.
The crop's path is kept as change points: the frames at which its position changes. A Scene starts
already framed on its target, and the tracker starts afresh at every cut.

A portrait Source is passed through whole. Ticket 14 adds a layout per Scene (Split's two panels,
each with its own camera; Blur's wide shot over a blurred background) and the layout override,
ticket 15 the caption events and ticket 16 the hook event.
"""

import math
from dataclasses import dataclass, field, replace
from enum import StrEnum

from app.config import CameraTuning
from app.video_source import SourceMetadata

OUTPUT_WIDTH = 1080
OUTPUT_HEIGHT = 1920


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


@dataclass(frozen=True)
class ScenePlan:
    # Seconds into the Clip.
    start: float
    end: float
    layout: SceneLayout
    panels: list[Panel]


@dataclass(frozen=True)
class CaptionWord:
    """A caption Word, highlighted from `start` to `end` (seconds into the Clip)."""

    text: str
    start: float
    end: float


@dataclass(frozen=True)
class CaptionEvent:
    """A caption line on screen from `start` to `end` (seconds into the Clip), inside `area`. Ticket 15."""

    text: str
    start: float
    end: float
    words: list[CaptionWord]
    area: Box


@dataclass(frozen=True)
class HookEvent:
    """The hook's lines on screen from `start` to `end` (seconds into the Clip), inside `area`. Ticket 16."""

    lines: list[str]
    start: float
    end: float
    area: Box


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
    camera: CameraTuning = CameraTuning(),
) -> RenderPlan:
    """The Render Plan for the Clip from `start` to `end` seconds of `source`, whose shots are `scenes`
    and whose sampled frames have `faces` (both in seconds into the Clip). Without `scenes` the Clip is
    one Scene; without `faces` its crop stays in the middle."""
    if not 0 <= start < end:
        raise ValueError(f"A Clip runs forwards from 0 s or later, not {start:g}–{end:g} s")
    duration = round(end - start, 3)
    if not reframes(source):
        plans = [ScenePlan(0.0, duration, SceneLayout.PASSTHROUGH, [_passthrough(source.width, source.height)])]
    else:
        cuts = sorted({round(scene.start, 3) for scene in scenes or []} - {0.0})
        edges = [0.0, *(cut for cut in cuts if cut < duration), duration]
        plans = []
        for a, b in zip(edges, edges[1:]):
            seen = None if faces is None else [frame for frame in faces if a <= frame.at < b]
            plans.append(ScenePlan(a, b, SceneLayout.TRACK, [_track(a, b, seen, source, camera)]))
    return RenderPlan(
        start=start,
        end=end,
        source_width=source.width,
        source_height=source.height,
        fps=source.fps,
        scenes=plans,
    )


def _track(start: float, end: float, faces: list[FrameFaces] | None, source: SourceMetadata, camera: CameraTuning) -> Panel:
    """A full-height 9:16 crop that follows the speaker's face through the Scene from `start` to `end`;
    in the middle of the frame while no face is known."""
    panel = _centre_crop(source.width, source.height)
    [middle] = panel.path
    if not faces:
        return replace(panel, path=[replace(middle, at=start)])
    tracked = _track_faces(faces, source.width, source.height, camera)
    targets = [(at, face.centre_x if face else None) for at, face in _follow_speaker(tracked, source.fps, camera)]
    highest = _even_floor(source.width - panel.crop_width)
    half = panel.crop_width / 2
    path: list[CropPoint] = []
    for at, centre in _camera_path(targets, start, end, source.fps, half, source.width - half, panel.crop_width, camera):
        x = min(max(_even(centre - half), 0), highest)
        if not path:
            path.append(CropPoint(start, x, middle.y))
        elif x != path[-1].x:
            path.append(CropPoint(round(at, 3), x, middle.y))
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


def _passthrough(width: int, height: int) -> Panel:
    """A portrait frame whole, as large as fits in the output and centred in it: a 9:16 one fills it."""
    crop_width, crop_height = _even_floor(width), _even_floor(height)
    scale = min(OUTPUT_WIDTH / crop_width, OUTPUT_HEIGHT / crop_height)
    area_width = min(_even(crop_width * scale), OUTPUT_WIDTH)
    area_height = min(_even(crop_height * scale), OUTPUT_HEIGHT)
    area = Box(_centred(OUTPUT_WIDTH, area_width), _centred(OUTPUT_HEIGHT, area_height), area_width, area_height)
    return Panel(area, crop_width, crop_height, [CropPoint(0.0, 0, 0)])


# Sizes and offsets are kept even: 4:2:0 video can't be cut at odd pixels.
def _even(value: float) -> int:
    return 2 * round(value / 2)


def _even_floor(value: float) -> int:
    return 2 * int(value // 2)


def _centred(outer: int, inner: int) -> int:
    """The even offset that centres `inner` pixels in `outer` most nearly, keeping it inside."""
    return min(_even((outer - inner) / 2), _even_floor(outer - inner))
