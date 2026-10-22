# 09: Measure the real model

**Parent spec:** `../spec.md` ("Testing Decisions", "Further Notes"); ADR 0015.

**What to build:** an opt-in test (`MATTE_MODEL=1`, as `RENDER_COST`) that runs the real RVM on a short clip with a person and checks that the Matte keeps a plausible area. It prints, for the ADR:
- the Matte's throughput (frames per second at a 1280 px long edge, CoreML and CPU);
- the extra time a render with Background removal takes against a plain one.

The figures are recorded in ADR 0015's Consequences with the machine, the ffmpeg version and the date.

**Blocked by:** 02

**Status:** done

- [x] The test is skipped unless `MATTE_MODEL=1` and the model is present.
- [x] ADR 0015 records the measured figures.

## Comments

**Built:**
- `backend/tests/test_matte_model.py`. It is skipped unless `MATTE_MODEL=1`, the model is present (`DATA_DIR/models/rvm_mobilenetv3_fp32.onnx`, or `MATTE_MODEL_PATH`) and `MATTE_CLIP` names a clip with a person, 10 s or more. The repo holds no such clip, and none is committed. Run it as `MATTE_MODEL=1 MATTE_MODEL_PATH=… MATTE_CLIP=… .venv/bin/python -m pytest tests/test_matte_model.py -s`, which takes about 5 minutes.
  - **First test:** `Mattes.make(ffmpeg, matter, Subject.PERSON, 0)` with `RvmMatter`. It checks the piece has one frame per frame, that the kept area (above half) stays between 5% and 80% on every frame, and that the area varies over time (by more than 2%). It prints the throughput, and does the same for CoreML in the NeuralNetwork format (02's choice) and in MLProgram, with each one's mean difference from the CPU's Matte.
  - **Second test:** through the API with the real matter (`Ports(person_model=…, matter=RvmMatter)`, the model symlinked into the test's DATA_DIR). It times a plain render, a render with the Matte still to make (from the save to done) and a render with the Matte ready.
- Measured on 12 s cut from a podcast Job's Source (1920×1080, 25 fps, cuts between wide and close shots). The machine is an M1 with 8 GB, ffmpeg 9.0.2 and onnxruntime 1.31.0, loaded by other sessions (load average 7 to 15, so ±30%). The figures are in ADR 0015's Consequences.
  - CPU: 4.5 frames a second at 1280×720 (0.19 s a frame in the model). A 10 s piece takes about 55 s.
  - CoreML NeuralNetwork: 2.7 frames a second, and wrong.
  - CoreML MLProgram: 3.4 frames a second, right.
  - Render of a 6.45 s Clip: plain 1.9 s; Matte ready 4.6 s (+0.4 s a Clip second); Matte to make 51 s.

**Changed:** `RvmMatter` runs on the CPU alone, and its `version` became `rvm-mnv3-2`.
- CoreML's default conversion (NeuralNetwork) of the dynamic-shape model gives a wrong Matte. It is blobby and keeps chairs, the table and the wall: a mean difference of 29 of 255 from the CPU's, with the kept area 35% against 24%. It stays wrong with `MLComputeUnits=CPUOnly`, so the conversion is at fault.
- MLProgram matches the CPU but is slower.
- 02's "similar on CoreML and CPU" speed hid this.
- The version bump means pieces made through CoreML are never read. The preview reads the version from the runner, so nothing else needed changing.
- `tests/test_background_removal.py` passes (it uses the fake matter).

**For a follow-up:** CoreML MLProgram on a fixed-shape model is about 2.5 to 3× faster than the CPU (0.045 to 0.05 s a frame against 0.14 to 0.17 s), with the CPU's Matte (within 1 of 255).
- The rewrite gives the inputs `src` [1,3,720,1280] and `r1i`…`r4i` [1,16,135,240], [1,20,68,120], [1,40,34,60], [1,64,17,30] as fixed shapes, makes `downsample_ratio` 0.375 an initializer, and saves the model after onnxruntime's `ORT_ENABLE_BASIC` optimisation (`optimized_model_filepath`). Without that last step it is only about 1.5× faster.
- It needs the `onnx` package as a dependency and a rewritten model cached for each Matte size. The first run of a size takes about 2 s to load.
- Not done here because of the new dependency.
- A smaller `downsample_ratio` (0.25) is about 2× faster on the CPU, at a coarser inner picture. Not taken.
- Also, the piece loop is serial: decode, model, then encode, about 0.03 s a frame outside the model. Overlapping them would gain about 15%.
