# 04: Live clip preview

**Parent spec:** `spec.md` in this feature folder (user stories 1–3; ADR 0001).

**What to build:**
- `frontend/src/pages/job/editor/ClipPreview.tsx` plays the Source proxy over the Candidate's range in a 9:16 frame, framed from the plan's panels:
  - **Track:** the crop follows its path.
  - **Split:** two synced videos.
  - **Blur:** a blurred, scaled background under the fitted shot.
  - **Passthrough:** the Source shown as it is.
- **Overlay.** The caption events and the hook event are drawn at their planned boxes, sizes and times, in the bundled fonts, with the active Word highlighted.
- **Placement.** It replaces the Source preview in `CandidateEditor`. The Source player stays available as a tab.
- **Status notes.** A note says when the preview uses Transcript Words or a single Scene, with a "Prepare" button.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] Play, pause and seek within the clip, with "Play clip" and "Play ending" kept.
- [ ] Text scales with the frame (it is drawn in 1080×1920 coordinates).
- [ ] The plan is fetched again 250 ms after a change, and the overlay updates without restarting playback.
- [ ] Browser check against a rendered Clip: the same line breaks, positions and timing.

## Comments
