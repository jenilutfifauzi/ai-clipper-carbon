"""The render cost of each Video Effect and of a Blend Mode (.scratch/video-effects/issues/10-measure-render-cost.md,
ADR 0014): a measurement, not an assertion. Each case renders a Clip of a generated 1080x1920 Source
through the API and the real ffmpeg, and the table prints its wall time against a plain render's.

Opt-in, being slow (about 13 minutes): RENDER_COST=1 .venv/bin/python -m pytest tests/test_render_cost.py -s
RENDER_COST=glow,bloom-pulse measures those effects only (and the plain renders)."""

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


def test_print_the_render_cost_of_each_effect_and_blend_mode(client, video_source, tall_video):
    video_source.video = tall_video
    item = upload(client, tall_video.read_bytes(), "tall.mp4").json()
    job = reviewed(client)
    candidate = add(client, job, "halo", "ya")
    secs = candidate["end"] - candidate["start"]
    # The whole Candidate as one Segment: a plain one is saved as the range.
    whole = {"id": "s0", "start": candidate["start"], "end": candidate["end"]}
    shown = {"id": "o", "media": item["id"], "start": 0.0, "secs": round(secs, 3), "transform": {"scale": 1}}

    def timed(**change) -> float:
        """The fastest of RUNS renders of the Candidate with `change`: from the request to the Job's
        return to review."""
        patch(client, job, candidate, **({"segments": [whole], "overlays": [], "adjustment_layers": []} | change))
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
