"""The render cost of each Video Effect and of a Blend Mode (.scratch/video-effects/issues/10-measure-render-cost.md,
ADR 0014): a measurement, not an assertion. Each case renders a Clip of a generated 1080x1920 Source
through the API and the real ffmpeg, and the table prints its wall time against a plain render's.

Opt-in, being slow (about 13 minutes): RENDER_COST=1 .venv/bin/python -m pytest tests/test_render_cost.py -s
RENDER_COST=glow,bloom-pulse measures those effects only (and the plain renders); RENDER_COST=outside
the frames drawn outside the span of an item with effects or a Blend Mode."""

import os
import subprocess
import time
from pathlib import Path

import pytest

from app.config import load_settings
from app.video_effects import effects
from test_media_library import upload
from test_render import add, render, reviewed
from test_review import patch
from test_save_frame import saved_frame

pytestmark = pytest.mark.skipif(not os.environ.get("RENDER_COST"), reason="a measurement; run with RENDER_COST=1")

# Each case is rendered this many times, and its fastest kept.
RUNS = 2
# The Source's length: the Candidate from "halo" to "ya" (captions.json3) is about 6 s of it.
SOURCE_SECS = 8
# The effects an Adjustment Layer is measured with: the ones ADR 0014 expects to cost the most.
LAYERED = ("glow", "bloom-pulse", "film-grain")


@pytest.fixture(scope="module")
def tall_video(tmp_path_factory) -> Path:
    """SOURCE_SECS of a moving 1080x1920 test pattern at 25 fps, with a tone."""
    path = tmp_path_factory.mktemp("cost") / "tall.mp4"
    command = [
        str(load_settings().ffmpeg_bin), "-v", "error",
        "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=25",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
        "-t", str(SOURCE_SECS), "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(path),
    ]
    subprocess.run(command, check=True)
    return path


def ffmpeg_version() -> str:
    command = [str(load_settings().ffmpeg_bin), "-version"]
    return subprocess.run(command, capture_output=True, text=True, check=True).stdout.splitlines()[0]


def rendered_in(client, job: dict, candidate: dict) -> float:
    """The fastest of RUNS renders of the Candidate: from the request to the Job's return to review."""
    times = []
    for _ in range(RUNS):
        began = time.monotonic()
        render(client, job, [candidate["id"]])
        while (polled := client.get(f"/api/jobs/{job['id']}").json())["status"] != "review" or any(
            clip["status"] in ("queued", "rendering") for clip in polled["clips"]
        ):
            assert time.monotonic() - began < 600
            time.sleep(0.02)
        times.append(time.monotonic() - began)
        [clip] = [clip for clip in polled["clips"] if clip["candidate_id"] == candidate["id"]]
        assert clip["status"] == "done", clip["error"]
    return min(times)


def test_print_the_render_cost_of_each_effect_and_blend_mode(client, video_source, tall_video):
    if os.environ["RENDER_COST"] == "outside":
        pytest.skip("RENDER_COST=outside measures frames outside a span alone")
    video_source.video = tall_video
    item = upload(client, tall_video.read_bytes(), "tall.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    secs = candidate["end"] - candidate["start"]
    # The whole Candidate as one Segment: a plain one is saved as the range.
    whole = {"id": "s0", "start": candidate["start"], "end": candidate["end"]}
    shown = {"id": "o", "media": item["id"], "start": 0.0, "secs": round(secs, 3), "transform": {"scale": 1}}

    def timed(**change) -> float:
        patch(client, job, candidate, **({"segments": [whole], "overlays": [], "adjustment_layers": []} | change))
        return rendered_in(client, job, candidate)

    timed()  # A warm-up: the first render of a Job also makes what later ones reuse.
    plain = timed()
    overlaid = timed(overlays=[shown])
    rows: list[tuple[str, str, float, float]] = [("(none)", "Segment", plain, plain), ("(none)", "Overlay", overlaid, plain)]
    named = os.environ["RENDER_COST"].split(",")
    for effect in effects() if named == ["1"] else [effect for effect in effects() if effect.id in named]:
        stack = [{"id": effect.id}]
        if not effect.keys:
            rows.append((effect.name, "Segment", timed(segments=[whole | {"video_effects": stack}]), plain))
        rows.append((effect.name, "Overlay", timed(overlays=[shown | {"video_effects": stack}]), overlaid))
        if effect.id in LAYERED:
            layer = {"id": "a", "start": 0.0, "secs": round(secs, 3), "video_effects": stack}
            rows.append((effect.name, "Adjustment Layer", timed(adjustment_layers=[layer]), plain))
    if named == ["1"] or "screen" in named:
        rows.append(("Blend Mode Screen", "Overlay", timed(overlays=[shown | {"blend": "screen"}]), overlaid))
    again = timed()

    print(f"\n{ffmpeg_version()}; a {secs:.2f} s Clip at 1080x1920, fastest of {RUNS}; plain again at the end: {again:.2f} s")
    print("| Effect | On | Wall time | Factor | Extra s per Clip second |")
    print("|---|---|---|---|---|")
    for name, on, wall, base in rows:
        print(f"| {name} | {on} | {wall:.2f} s | {wall / base:.2f}× | {(wall - base) / secs:+.2f} |")


# The span the items of the "outside" measurement show over, and the Timeline times drawn outside it.
SPAN = (1.8, 4.8)
OUTSIDE = (1.7, 5.8)


@pytest.mark.skipif("outside" not in os.environ.get("RENDER_COST", "").split(","), reason="RENDER_COST=outside")
def test_print_what_items_cost_a_frame_drawn_outside_their_span(client, settings, video_source, tall_video):
    """Compare render's cost (one frame drawn as the render draws it, POST …/frame) at a time no item
    shows, with a Screen Overlay, an Adjustment Layer of Film grain and Bloom pulse and a Chroma-keyed
    Overlay over SPAN, each alone and all together, against the Candidate without them; and a whole
    render of each. RENDER_COST=outside .venv/bin/python -m pytest tests/test_render_cost.py -s"""
    video_source.video = tall_video
    item = upload(client, tall_video.read_bytes(), "tall.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    whole = {"id": "s0", "start": candidate["start"], "end": candidate["end"]}
    start, secs = SPAN[0], round(SPAN[1] - SPAN[0], 3)
    shown = {"media": item["id"], "start": start, "secs": secs, "transform": {"scale": 1}}
    cases = {
        "(none)": {},
        "Screen Overlay": {"overlays": [shown | {"id": "o", "blend": "screen"}]},
        "Layer: grain + Bloom pulse": {
            "adjustment_layers": [{"id": "a", "start": start, "secs": secs, "video_effects": [{"id": "film-grain"}, {"id": "bloom-pulse"}]}],
        },
        "Chroma-keyed Overlay": {"overlays": [shown | {"id": "k", "video_effects": [{"id": "chroma-key"}]}]},
    }
    cases["All three"] = {"overlays": cases["Screen Overlay"]["overlays"] + cases["Chroma-keyed Overlay"]["overlays"]} | cases[
        "Layer: grain + Bloom pulse"
    ]

    def drawn(at: float) -> float:
        """The fastest of RUNS frames at `at` of the Candidate."""
        times = []
        for _ in range(RUNS):
            began = time.monotonic()
            saved_frame(client, job, candidate, at=at)
            times.append(time.monotonic() - began)
        return min(times)

    rendered_in(client, job, candidate)  # A warm-up.
    rows = []
    for name, change in cases.items():
        patch(client, job, candidate, **({"segments": [whole], "overlays": [], "adjustment_layers": []} | change))
        rows.append((name, *(drawn(at) for at in OUTSIDE), rendered_in(client, job, candidate)))
    print(f"\n{ffmpeg_version()}; a {candidate['end'] - candidate['start']:.2f} s Clip at 1080x1920, items over {SPAN[0]}–{SPAN[1]} s, fastest of {RUNS}")
    print(f"| Items | Frame at {OUTSIDE[0]} s | Frame at {OUTSIDE[1]} s | Whole render |")
    print("|---|---|---|---|")
    for name, before, after, whole_render in rows:
        print(f"| {name} | {before:.2f} s | {after:.2f} s | {whole_render:.2f} s |")
