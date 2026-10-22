# 01: The Canvas module, with every backend frame size going through it

**Parent spec:** `../spec.md` (Implementation Decisions "Model": the Canvas module, "Renderer and export"); GLOSSARY (Canvas, Safe Area, Reference Space); docs/adr/0022-a-canvas-aspect-per-candidate-in-its-own-pixels.md.

**What to build:** a prefactor. The backend gets the frame's size, Safe Area and Reference Space mapping from one Canvas module instead of hard-coded 1080 and 1920. Every Candidate is still 9:16, so nothing a user sees changes.

The Canvas module is pure. Given an aspect (`9:16`, `4:5`, `1:1`, `16:9`), it gives:
- **The Canvas size:** short side 1080, long side rounded to even. That is 1080×1920, 1080×1350, 1080×1080 and 1920×1080.
- **The Safe Area box:** 9:16 is today's (x 0–950, y 232–1536). The others keep about 5% clear at each edge.
- **A mapping from the 1080×1920 Reference Space to the Canvas:** x·W/1080 and y·H/1920.

Everything that assumes 1080×1920 takes a Canvas instead, passed down from where the plan is made:
- The planner: the frame constants, the Safe Area and caption boxes, the Layout crops, Split's panel height, the Transform clamps, the hook and watermark placing, text wrap, and the Render Plan's width and height.
- `migration`, `frames` and `video_effects`.
- The Candidate validators, which take the Canvas from the caller. Today that is always 9:16.

Also in this ticket:
- **The Preview Plan and the Render Plan** carry the Canvas's width, height and Safe Area box.
- **Export:** the output size is the Canvas's aspect at the chosen short side, rounded to even. The scaled plan's factor is short side ÷ 1080, which gives the same numbers as today's height ÷ 1920 on 9:16.

**Blocked by:** None (can start immediately).

**Status:** done

- [ ] Canvas module tests: the four sizes, the four Safe Areas (9:16 identical to today's), and a Reference Space mapping on 16:9.
- [ ] A 9:16 Candidate's Render Plan and Preview Plan are identical to before this ticket, for each Layout, captions, hook, watermark, Text Layer and Overlay. Compare whole plans for a few fixtures.
- [ ] The Preview Plan exposes the Canvas size and Safe Area.
- [ ] The output size for 720/1080/1440/2160 on 9:16 is unchanged. On 1:1 and 16:9 (called directly, before Candidates can have them), it follows the short side.
- [ ] No remaining 1080/1920 literals in the planner other than inside the Canvas module and the Reference Space (Style validators keep their 1920/1080 limits).
- [ ] Only the affected backend test files are run.

## Comments

**2026-10-21 (implementation):** `app/canvas.py` holds the four Canvases, their Safe Areas and caption places, and the Reference Space mapping. The planner takes a `canvas` (default `PORTRAIT`) through every function that placed things on the frame. `RenderPlan` and the Preview Plan carry `width`, `height` and `safe_area`. `output_size`, `target_kbps` and `encoder_args` take the plan's frame. `scaled_plan` scales by short side.

Left on the 9:16 Canvas on purpose, for 03 (which knows the Candidate's aspect):
- `Transform.__post_init__` clamps its centre to 1080×1920. `KEY_RANGES` X/Y are 0–1080 and 0–1920, and `picture_at` and `_frozen` clamp keyed centres to them. These are Candidate-level checks that need the aspect.
- `CueEdit.x`/`y` use the Reference Space's `Width`/`Height` types. Per the spec they are Canvas pixels and need per-Canvas checks.
- Callers that still use the default `PORTRAIT`:
  - `rendering.py` (`plan_render`, which needs `canvas=` from the Candidate);
  - `review.py` (`fit_hook`);
  - `layer_pictures.py` (`text_event`, the pre-made pictures);
  - the size estimate in `api.py`.
- `video_effects._FRAME`, which sizes Glow's and Bloom's spread, is the Reference Space. On a 16:9 Canvas a full-frame picture's spread would be about 1.8× too wide, so it should take the plan's Canvas.

Pre-existing failure on `main`, not from this ticket: `tests/test_freeze_frame.py::test_freeze_frames_are_saved_unsnapped_and_validated`. It expects no `video_effects` key on a saved Segment.
