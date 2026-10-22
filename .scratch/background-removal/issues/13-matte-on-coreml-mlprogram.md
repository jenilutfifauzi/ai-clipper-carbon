# 13: The Matte on CoreML (MLProgram), 2.5–3× faster

**Parent spec:** `../spec.md` ("Matte store and runner"); ADR 0015 and its measured figures (ticket 09).

**What to build:** the Matte is made about 2.5–3× faster on Apple Silicon, with the same Matte the CPU makes.

Ticket 09 found:
- CoreML's default NeuralNetwork format gives a wrong Matte. That is why the Matte runs on the CPU (0.14–0.19 s a frame at 1280×720).
- CoreML's MLProgram format on a fixed-shape copy of the model runs at 0.045–0.05 s a frame, with the CPU's Matte (within 1 of 255).

**The work:**
- **Fixed-shape copy:** add the `onnx` package to the backend. Write a fixed-shape copy of the RVM model for each Matte size used, cached beside the model in `DATA_DIR/models` and removed with it.
- **Session:** run the copy with the CoreML provider in MLProgram format, falling back to the CPU when CoreML or the rewrite is unavailable.
- **Version:** bump the matter's version so that CPU pieces and CoreML pieces are never mixed. Alternatively, if they agree within 1/255, keep the version and say why in the Comments.
- **Measure again** with the opt-in `MATTE_MODEL=1` test, and replace ADR 0015's figures. Also amend 0015's "the Matte runs on the CPU".

**Blocked by:** 10

**Status:** done

- [x] The opt-in test checks the CoreML Matte against the CPU's (within 1/255 on average, kept area within 1 %) and prints both speeds.
- [x] Without CoreML (or with the rewrite failing), the CPU path is used and the Matte is unchanged.
- [x] Removing the person model removes the fixed-shape copies.
- [x] ADR 0015 records the new figures and the decision.

## Comments

**2026-10-22, done.**

- **Dependency:** `onnx>=1.23.2` in `backend/pyproject.toml`, `uv.lock` updated (`uv add onnx --no-sync`: onnx 1.23.2 and its new dependency ml-dtypes 0.6.0). For the shared main-checkout venv, `uv pip install onnx==1.23.2 ml-dtypes==0.6.0` added just those two packages and changed nothing else. A checkout that hasn't synced still runs: without `onnx` the matter uses the CPU.
- **`RvmMatter` (backend/app/matte.py):**
  - On the first frame of a run at a new size, it picks a session for that size and keeps it.
  - Where CoreML is offered, it makes a fixed-shape copy of the model (`fixed_shape_copy`) and runs it through CoreML with `ModelFormat: MLProgram` (CPU listed after it). For the copy:
    - The states' shapes come from one CPU frame of zeros at that size, as the model gives them back. So any Matte size works, not only 1280×720.
    - `src` and `r1i`…`r4i` get those fixed shapes, and `downsample_ratio` becomes an initializer (`min(1, 480 / long edge)`).
    - The graph is saved after `ORT_ENABLE_BASIC` (`optimized_model_filepath`), then shape-inferred.
    - It is written in a temporary folder beside the model and renamed into place.
  - The new session is tried on one blank frame. If anything fails (CoreML not offered, `onnx` not importable, the rewrite or the CoreML compile raising), the size gets the CPU session on the model as downloaded, as before.
  - A `coreml = False` subclass is CPU-only (the opt-in test's reference). `matter.session(size)` gives the session used.
- **Copies:** `person_model.fixed_copy(model, (w, h))` is `rvm_mobilenetv3_fp32.fixed-1280x720.onnx` beside the model. `PersonModel._delete` removes `<stem>.fixed-*`, which also catches the temporary folder of a rewrite cut short. Other files in `models/` (Kokoro's) are left alone.
- **Measured** (opt-in `test_matte_model.py`, M1 8 GB, load about 4, ±20%), piece 0 at 1280×720, 250 frames:
  - CoreML: 13.8 frames/s, 18.2 s a piece, 0.066 s a frame in the matter. The model alone is 0.035 s a frame in a micro-benchmark; the default compute units are as good as CPUAndGPU, and better than the Neural Engine or CPUOnly at 0.046.
  - CPU: 6.3 frames/s, 39.7 s, 0.139 s.
  - About 2.2× for a piece, short of the ticket's 2.5–3×. The rest of each frame is outside the model: the frame's float conversion, with ffmpeg alongside. That and the serial loop are where more is to gain (ADR's "Left for later").
  - The first run at a size writes the copy and loads CoreML in about 1.7 s.
  - A render with the Matte to make: 23 s, down from 51 s.
- **Matte agreement:** mean 0.02 of 255 from the CPU's, max 60 (a few edge pixels), kept area within 0.01% on every frame. The test asserts mean ≤ 1 and kept area ≤ 1%.
- **Version kept** at `rvm-mnv3-2`. The two Mattes agree far within 1/255, so CPU and CoreML pieces can sit side by side; the fallback is per machine and per size anyway. Bumping would only re-make every Matte already made.
- **ADR 0015:** the Decision's Matte bullet now says CoreML MLProgram on the copy, the CPU as the fallback. The cost figures are replaced, with 09's NeuralNetwork finding kept as the reason for the copy. The spec's Matter seam bullet is updated too.
- **Tests:**
  - `test_background_removal.py` uses a stand-in model with RVM's interface (built with `onnx.helper`; its states' shapes follow the frame size). One test checks a copy per size, run through CoreML, giving the right alpha, and reused by a later matter. Another, parametrized, checks the CPU and the same alpha with no copy left behind when CoreML isn't offered, `onnx` isn't importable, the rewrite raises, or the matter is CPU-only.
  - `test_person_model_download.py`: remove deletes the copies and a leftover rewrite folder, and leaves other models.
  - `test_matte_model.py` (opt-in) now compares `RvmMatter` against the CPU-only matter and prints both speeds. The NeuralNetwork and dynamic-shape MLProgram rows are dropped; their figures stay in the ADR.

