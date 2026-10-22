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

**Status:** ready-for-agent

- [ ] The opt-in test checks the CoreML Matte against the CPU's (within 1/255 on average, kept area within 1 %) and prints both speeds.
- [ ] Without CoreML (or with the rewrite failing), the CPU path is used and the Matte is unchanged.
- [ ] Removing the person model removes the fixed-shape copies.
- [ ] ADR 0015 records the new figures and the decision.
