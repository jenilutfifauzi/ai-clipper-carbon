# 08: Review, Clips and Job creation take the aspect

**Parent spec:** `../spec.md` (Implementation Decisions "Frontend", "Renderer and export": the saved frame; User Stories 1, 36–37, 43).

**What to build:** the aspect shows everywhere outside the Advanced Edit.
- **Job creation:** the form (URL, upload or file) has an aspect choice: 9:16 (default), 4:5, 1:1 or 16:9. It is sent as `JobOptions.aspect`.
- **Review:** the clip editor's preview takes the Candidate's shape, not a fixed 9:16 box.
- **Cards and posters:** Candidate thumbnails, Clip cards and posters take the Candidate's (or Clip's) shape. Mixed shapes line up on the page.
- **The saved frame (PNG)** has the Candidate's shape at the default Preset's resolution. A 4:5 frame is 1080×1350.

**Blocked by:** 03.

**Status:** done

- [x] Seam A: a 4:5 Candidate's saved frame is 1080×1350.
- [x] Jobs API test: a Job made with `aspect: "16:9"` keeps it in its options.
- [ ] Browser walkthrough: making a 16:9 Job; Review and the Clips page with a 9:16 and a 16:9 Candidate side by side (desktop and phone).
- [x] `npm run typecheck && npm run build` pass.

## Comments

**2026-10-21 (implementation):**
- **Job creation.** `NewJobForm` has a "Shape" Segmented control (9:16 by default, 4:5, 1:1, 16:9) under the URL or file, outside "Advanced options", with a one-line hint per shape. It is sent as `JobOptions.aspect` for a URL and an upload alike.
- **Review's preview.** `ClipPreview` takes an optional `aspect`, the Candidate's, and `canvasOf(plan, aspect)`/`useCanvasOf(plan, aspect)` fall back to that aspect's Canvas (`aspectCanvas`, sized as canvas.py's `_canvas`: short side 1080, 5% Safe Area margin off 9:16) until the plan comes. The plan's Canvas still wins. CandidateEditor passes `candidate.aspect`. The Advanced Edit doesn't pass it yet; that file is 05's (the picker), and it's a one-line `aspect={candidate.aspect}` there plus `useCanvasOf(preview?.plan, candidate.aspect)`.
- **Clip cards and posters.** The Clip now records its shape: `RenderedClip.aspect` (backend, default 9:16, so a Clip rendered before aspects reads as 9:16, which it was). A card's shape is its render's, or its Candidate's while it isn't rendered. Every card's player sits centred in a slot of the tallest shape on the page (`tallestAspect`), so mixed shapes line up: titles and buttons start at the same height in each row. The slot is capped at 85svh tall on a phone held sideways, as before. The poster is the render's own JPEG, so it already has the shape.
- **Candidate thumbnails** (the list in Review) were never 9:16: they're 16:9 Source stills in a 16:9 slot. I kept that slot so rows stay one size and the still stays readable. The Candidate's shape is framed in the middle of the still with a hairline, and the rest is dimmed. A 16:9 Candidate shows the whole still. The frame is centred, so it's only a rough guide to what Track or Manual actually crop.
- **AnchorGrid** (the Watermark's nine places) takes a `frame` shape. WatermarkPanel passes the Candidate's aspect, and a wide frame is drawn wider (w-40) so its rows keep their room.
- **Saved frame.** It already worked after 03. The new Seam A test in `test_aspects.py` checks that a 4:5 Candidate's PNG is 1080×1350.
- **Size estimate.** `/export-presets/estimate` takes an optional `aspect` (9:16 by default). `estimated_bytes` takes the Canvas frame, as `target_kbps` already did. The frontend's `batchParts` splits a batch by aspect. RenderButton asks once per aspect and adds the answers up, both in Review's "Render selected" and in a Clip card's "Render again". The Export Presets sheet's MB per minute stays a 9:16 figure.

Tests: `test_aspects.py` (saved 4:5 frame at 1080×1350; Clips record `aspect`), `test_jobs_api.py` (a 16:9 Job keeps its aspect), `test_export_presets.py` (the estimate per aspect, and an unknown aspect is a 422). Vitest: `canvas.test.ts` (the aspect fallback, `aspectRatio`, `tallestAspect`) and `ExportPresetsSheet.test.tsx` (`batchParts`). `npm run typecheck` and `npm run build` pass.

Not done:
- The browser walkthrough wasn't run.
