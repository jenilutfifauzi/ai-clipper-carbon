# 0022: A Canvas Aspect per Candidate, in its own pixels

Status: accepted
Date: 2026-10-21

Builds on 0003 (Revisions and stale Clips), 0007 (one Transform for every picture) and 0021 (a plan drawn at any size).

Overturns these Out of Scope items:
- "The canvas aspect, which stays 9:16 at 1080×1920" in `.scratch/transform-crop/spec.md`.
- "Canvas aspect ratios other than 9:16" in `.scratch/export-settings/spec.md`.

It also revises 0021's scale factor.

## Context

The `canvas-aspect` feature (roadmap #20, `.scratch/advanced-edit-v2/roadmap.md`) lets a Candidate be framed as 9:16, 4:5, 1:1 or 16:9, so that one episode can also feed Instagram's feed and YouTube.

Until now 1080×1920 was hard-coded in about 110 places:
- In the planner: `OUTPUT_WIDTH`/`OUTPUT_HEIGHT`, the safe area, the caption boxes, Split's 960 px panels, the Layout crops and the Transform clamps.
- In the models' validators and defaults: `candidates.py`, `styles.py` and `migration.py`.
- In `encoding.output_size`, which turns a resolution into a 9:16 size.
- In the preview, the stage guides and the MCP tools' documentation.

Every saved position is in absolute pixels of that frame: Transforms and their Keyframes, Cue Edits, and the Style Presets' caption, hook and Watermark places. A Transform's `scale` is relative to the size fitted in the frame, so it depends on the frame's shape.

Concat keeps an aspect per timeline. It can be changed later and the change is undoable. Positions are fractions of the frame, so nothing is rescaled. Text is sized as a fraction of the frame's height. Pictures are always contain-fitted. Its export resolution is the frame's short side. It has no platform safe areas and no aspect variants.

Each choice had genuine alternatives:
- **Where the aspect lives:** on the Candidate, in an Export Preset, or on the Job.
- **What positions are in:** fractions of the frame; pixels of a frame whose short side is 1080; or pixels of a frame always 1920 tall.
- **Variants:** several aspects with their own Clips inside one Candidate, several aspects chosen at render time, or one aspect per Candidate.

## Decision

- **The Canvas Aspect is a Candidate field, saved with each Revision.**
  - The choices are 9:16, 4:5, 1:1 and 16:9. There is no 4:3 and no custom size.
  - A Candidate saved before this field existed is 9:16, so nothing is migrated.
  - A new Candidate takes `JobOptions.aspect`, which defaults to 9:16 and is chosen when the Job is made. An MCP agent can choose it too.
  - Changing the aspect is an edit like any other: it makes a new Revision and the Clip goes stale (0003).
- **One aspect per Candidate, and one Clip per Candidate, as 0021 says.** To have another aspect, duplicate the Candidate and change the copy's aspect.
- **The Canvas is in output pixels, its short side 1080:** 1080×1920, 1080×1350, 1080×1080 and 1920×1080.
  - The Render Plan carries the Canvas's width and height. The planner, the preview and the MCP tools work in them.
  - Text, Shape and Watermark sizes keep their meaning, because the short side never changes.
- **What a Candidate owns is in its Canvas's pixels. What a Style owns is in the Reference Space.**
  - The Candidate owns its Transforms (of Segments, Framings, Overlays, Text Layers and Shapes), their Keyframes and its Cue Edits.
  - Style Presets and Style Overrides keep their places in the 1080×1920 Reference Space, so one Preset serves every aspect.
  - The planner maps those places onto the Canvas in proportion: x·W/1080 and y·H/1920. The anchor choices (Top, Bottom, the nine Watermark places) stay relative.
  - The stage converts a dragged caption or hook back into the Reference Space.
- **Changing the aspect rescales the Candidate's own positions once, in the backend.**
  - It is one pure function, run when an edit changes `aspect`, so the browser and the MCP tools agree. Positions sent in the same edit are taken as already on the new Canvas.
  - Each centre keeps its place as a fraction of the Canvas.
  - A Framing keeps its scale relative to the cover scale, so a picture that filled the frame still fills it.
  - Overlays, Text Layers and Shapes keep their drawn size in pixels.
  - Keyframes follow the same rules.
  - In the Advanced Edit, the aspect picker first saves any pending draft. It then sends the change, and the editor loads the new Revision. One undo restores the old aspect and positions.
- **The Layouts keep their formulas, generalised to the Canvas.**
  - Track crops the Source at the Canvas's aspect and follows the faces. On 16:9 with a 16:9 Source, that crop is the whole frame and the camera doesn't move.
  - Split stacks its two panels on 9:16 and 4:5 (1080×960 and 1080×675), and sets them side by side on 1:1 and 16:9 (540×1080 and 960×1080). The left face stays on the left or top.
  - Blur fits the Source over its blurred cover. With the same aspect as the Canvas, it shows the Source alone. A portrait Source on a wider Canvas uses Blur, not black bars.
  - There is no new Layout.
- **Captions on Auto follow the Layout's geometry:**
  - at the seam of a stacked Split
  - under Blur's band when there is room: in the lower third, moved down to stay clear of a band that reaches into it
  - otherwise in the lower third, inside the Safe Area
- **A centre off the Canvas is brought onto it,** as one off the 9:16 frame always was (0007). That covers a Transform's centre and a position Keyframe's. A Cue Edit off it is refused.
- **One Safe Area per aspect, with no platform picker.** 9:16 keeps today's (y 232 to 1536, x up to 950). 4:5, 1:1 and 16:9 keep about 5% clear at each edge. Captions, the hook and the Watermark's places are clamped to it, and the stage shows its edges as guides.
- **Export resolution is the Canvas's short side (revises 0021).**
  - 1080p on 16:9 is 1920×1080.
  - The renderer's scale factor is short side over 1080, which is 0021's height over 1920 for 9:16.
  - Export Presets don't know the aspect.
- **The aspect shows everywhere a Clip is drawn.**
  - These follow the Candidate's shape instead of a fixed 9:16 box: the Advanced Edit's stage (with the picker above the player), the clip editor's preview in Review, the Clip cards and posters, and the saved frame.
- **MCP:** `edit_candidate` takes `aspect`, `dry_run`'s Preview Plan carries the Canvas's size, and the tools' documentation stops saying 1080×1920.

## Consequences

- One 9:16 plan changes. On Blur, a Source whose shot reaches into the lower third has its Auto captions moved down below the band. For example, a 16:10 Source's band ends at y 1298, so its captions go from 1296 to 1330. Every 16:9 Source keeps today's captions.

- Every hard-coded 1080 and 1920 goes through the Canvas, the Reference Space or the Safe Area. A forgotten one shows only on another aspect, so the planner and a real render are tested at 1:1 and 16:9 as well as 9:16.
- Validators that capped positions at 1080 and 1920 now check the Canvas, so they need the Candidate's aspect.
- Two coordinate spaces exist for one Candidate: its Canvas for what it owns, and the Reference Space for its Style. The MCP documentation says which is which.
- A Style Preset tuned on 9:16 is only proportionally right on 16:9. To tune it, duplicate the Preset.
- The rescale happens only once, so changing to 16:9 and back may not restore every position exactly. Undo does restore them.
- The bitrate's pixel scaling in `encoding.py` already counts pixels, so 16:9 1080p gets the same budget as 9:16 1080p.
- Templates (roadmap #21) will need to say what happens to a Template's positions on a Candidate of another aspect. The rescale function is the natural answer.
