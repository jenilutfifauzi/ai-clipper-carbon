"""The real person model (.scratch/background-removal/issues/09-measure-the-real-model.md, ADR 0015): RVM
on a short clip with a person, through `Mattes.make` as the runner drives it. It checks the Matte keeps
a plausible area, and that `RvmMatter` through CoreML (MLProgram, on a fixed-shape copy: ticket 13)
makes the CPU's Matte, and prints the figures ADR 0015's Consequences record: the Matte's throughput at
MATTE_SIDE on the CPU and through CoreML, with how far CoreML's Matte is from the CPU's, and what a
render with Background removal costs against a plain one, through the API with the real matter.

Opt-in, being slow and needing what the repo doesn't hold:
    MATTE_MODEL=1 MATTE_CLIP=<a clip with a person, 10 s or more> .venv/bin/python -m pytest tests/test_matte_model.py -s
The model is DATA_DIR/models/rvm_mobilenetv3_fp32.onnx (downloaded by the app), or MATTE_MODEL_PATH."""

import os
import shutil
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.candidates import Subject
from app.config import load_settings
from app.main import create_app
from app.matte import MATTES_DIR, Mattes, RvmMatter
from app.person_model import PERSON_MODEL_FILE, PersonModel, fixed_copy
from app.ports import Ports
from test_render import add, render, reviewed
from test_render_cost import ffmpeg_version, rendered_in
from test_review import patch


def model_path() -> Path:
    named = os.environ.get("MATTE_MODEL_PATH")
    return Path(named).expanduser() if named else PersonModel(load_settings().data_dir / "models").path


pytestmark = [
    pytest.mark.skipif(not os.environ.get("MATTE_MODEL"), reason="the real person model; run with MATTE_MODEL=1"),
    pytest.mark.skipif(not model_path().is_file(), reason="the person model isn't downloaded (or MATTE_MODEL_PATH)"),
    pytest.mark.skipif(not Path(os.environ.get("MATTE_CLIP", "")).is_file(), reason="MATTE_CLIP: a clip with a person"),
]

# The share of a frame's pixels a Matte of a person keeps (above half), on every frame of a clip of
# people talking at a table, wide or close.
AREA = (0.05, 0.80)


class CpuRvmMatter(RvmMatter):
    """RVM on the CPU alone, as `RvmMatter` runs where CoreML can't be had: the reference."""

    coreml = False


def timed(matter: RvmMatter) -> tuple[RvmMatter, list[float]]:
    """The matter, its runs' frames timed into the list it gives."""
    spent: list[float] = []
    run = matter.run

    def timed_run() -> Callable[[np.ndarray], np.ndarray]:
        alpha = run()

        def timed_alpha(frame: np.ndarray) -> np.ndarray:
            began = time.monotonic()
            found = alpha(frame)
            spent.append(time.monotonic() - began)
            return found

        return timed_alpha

    matter.run = timed_run  # type: ignore[method-assign]
    return matter, spent


def probed(path: Path) -> tuple[tuple[int, int, float], float]:
    settings = load_settings()
    command = [
        str(settings.ffprobe_bin), "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate:format=duration", "-of", "default=nw=1",
    ]
    out = dict(line.split("=", 1) for line in subprocess.run([*command, str(path)], capture_output=True, text=True, check=True).stdout.split())
    num, den = out["avg_frame_rate"].split("/")
    return (int(out["width"]), int(out["height"]), int(num) / int(den)), float(out["duration"])


def gray_frames(path: Path, size: tuple[int, int]) -> np.ndarray:
    command = [str(load_settings().ffmpeg_bin), "-v", "error", "-i", str(path), "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
    raw = subprocess.run(command, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, size[1], size[0])


def machine() -> str:
    chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
    memory = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True, text=True).stdout.strip() or 0) / 2**30
    return f"{chip}, {memory:.0f} GB, load {os.getloadavg()[0]:.1f}"


def test_the_real_model_keeps_a_plausible_matte_through_coreml_as_on_the_cpu_and_prints_both_speeds(tmp_path):
    clip = Path(os.environ["MATTE_CLIP"])
    frame, duration = probed(clip)
    assert duration >= 10, "MATTE_CLIP should be 10 s or more: one whole piece"
    ffmpeg = load_settings().ffmpeg_bin
    # A model of its own, so that its fixed-shape copy is made afresh, and timed.
    model = tmp_path / "models" / PERSON_MODEL_FILE
    model.parent.mkdir()
    shutil.copyfile(model_path(), model)
    rows = []
    reference = None
    for name, kind in (("CPU", CpuRvmMatter), ("RvmMatter (CoreML MLProgram, fixed shape)", RvmMatter)):
        mattes = Mattes(tmp_path / name, clip, frame, duration)
        size = mattes.size()
        loading = time.monotonic()
        matter, spent = timed(kind(model))
        provider = matter.session(size).get_providers()[0]
        loaded = time.monotonic() - loading
        began = time.monotonic()
        piece = mattes.make(ffmpeg, matter, Subject.PERSON, 0)
        wall = time.monotonic() - began
        matte = gray_frames(piece, size)
        kept = (matte > 127).mean(axis=(1, 2))
        if reference is None:
            # The Matte Background removal reads: one frame per frame, a plausible area that follows
            # the picture (the speakers move and the shots cut).
            reference = (matte, kept)
            assert len(kept) == mattes.frames(0)[0]
            assert AREA[0] < kept.min() and kept.max() < AREA[1], (kept.min(), kept.max())
            assert kept.max() - kept.min() > 0.02, (kept.min(), kept.max())
        off = np.abs(matte.astype(np.int16) - reference[0])
        area = np.abs(kept - reference[1])
        rows.append((name, provider, size, len(spent), loaded, wall, float(np.median(spent[3:])), kept, float(off.mean()), int(off.max()), float(area.max())))
    # CoreML's Matte is the CPU's: within 1 of 255 on average, its kept area within 1 % on every frame.
    assert rows[1][1] == "CoreMLExecutionProvider" and fixed_copy(model, rows[1][2]).is_file()
    assert rows[1][8] <= 1 and rows[1][10] <= 0.01, rows[1][8:]

    print(f"\n{machine()}; {ffmpeg_version()}; a {frame[0]}x{frame[1]} {frame[2]:g} fps clip, piece 0 (10 s)")
    print(
        "| Matter | First provider | Matte size | Load (and copy) | Frames | Piece wall time | Frames/s (piece) | Model s/frame (median) "
        "| Kept area min/median/max | Diff from the CPU's, mean/max (of 255) | Kept area diff, max |"
    )
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for name, provider, size, frames, loaded, wall, median, kept, off, most, area in rows:
        print(
            f"| {name} | {provider} | {size[0]}x{size[1]} | {loaded:.1f} s | {frames} | {wall:.1f} s | {frames / wall:.1f} "
            f"| {median:.3f} s | {kept.min():.2f}/{np.median(kept):.2f}/{kept.max():.2f} | {off:.2f}/{most} | {area:.4f} |"
        )


def test_print_what_a_render_with_background_removal_costs(tmp_path, settings, video_source, transcriber, llm):
    """A Candidate's render through the API and the real ffmpeg: plain, with Background removal on its
    Segment while its Matte is still to be made (asked for by the save and made by the runner and the
    render), and again with the Matte ready."""
    clip = Path(os.environ["MATTE_CLIP"])
    person_model = PersonModel(settings.data_dir / "models")
    person_model.path.parent.mkdir(parents=True, exist_ok=True)
    person_model.path.symlink_to(model_path().resolve())
    video_source.video = clip
    ports = Ports(video_source, transcriber, llm, person_model=person_model, matter=RvmMatter)
    with TestClient(create_app(settings, ports)) as client:
        try:
            job = reviewed(client)
            candidate = add(client, job, "halo", "ya")
            secs = candidate["end"] - candidate["start"]
            whole = {"id": "s0", "start": candidate["start"], "end": candidate["end"]}
            patch(client, job, candidate, segments=[whole])
            rendered_in(client, job, candidate)  # A warm-up.
            plain = rendered_in(client, job, candidate)
            mattes = settings.data_dir / "jobs" / job["id"] / MATTES_DIR
            shutil.rmtree(mattes, ignore_errors=True)
            began = time.monotonic()
            patch(client, job, candidate, segments=[whole | {"background_removal": {"subject": "person", "feather": 4}}])
            first_total = rendered_once(client, job, candidate, began)
            ready = rendered_in(client, job, candidate)
            made = sorted(path.name for path in mattes.iterdir())
        finally:
            video_source.release()
            transcriber.release()
            transcriber.stop()
    print(f"\n{machine()}; {ffmpeg_version()}; a {secs:.2f} s Clip (1080x1920) of a {probed(clip)[0][:2]} Source; pieces {made}")
    print("| Render | Wall time | Extra s per Clip second |")
    print("|---|---|---|")
    print(f"| Plain | {plain:.2f} s | |")
    print(f"| Background removal, Matte to make (save to done) | {first_total:.2f} s | {(first_total - plain) / secs:+.2f} |")
    print(f"| Background removal, Matte ready | {ready:.2f} s | {(ready - plain) / secs:+.2f} |")


def rendered_once(client, job: dict, candidate: dict, began: float) -> float:
    """One render of the Candidate: the time from `began` to the Job's return to review."""
    render(client, job, [candidate["id"]])
    while (polled := client.get(f"/api/jobs/{job['id']}").json())["status"] != "review" or any(
        clip["status"] in ("queued", "rendering") for clip in polled["clips"]
    ):
        assert time.monotonic() - began < 900
        time.sleep(0.05)
    [clip] = [clip for clip in polled["clips"] if clip["candidate_id"] == candidate["id"]]
    assert clip["status"] == "done", clip["error"]
    return time.monotonic() - began
