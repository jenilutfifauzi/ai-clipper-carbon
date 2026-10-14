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

**Status:** done

- [x] Play, pause and seek within the clip, with "Play clip" and "Play ending" kept.
- [x] Text scales with the frame (it is drawn in 1080×1920 coordinates).
- [x] The plan is fetched again 250 ms after a change, and the overlay updates without restarting playback.
- [x] Browser check against a rendered Clip: the same line breaks, positions and timing.

## Comments

**2026-10-14: done.** `npm run typecheck` and `npm run build` pass. Checked in a browser against a test server on a copy-on-write clone of Job `1d5d363bec2e` (scratchpad `DATA_DIR`), so that the owner's data was untouched.

Built (`frontend/src/pages/job/editor/`):
- **`playback.ts`:** the `Playback` class.
  - It owns the master `<video>` and the time in seconds into the Clip, and stops at the Clip's end, checked every frame.
  - `usePlayback(playback, select)` re-renders only when the selected primitive changes (`useSyncExternalStore`).
  - The timeline (ticket 08) will drive the same object.
- **`usePreviewPlan.ts`:** asks `POST .../preview-plan` with the draft, 250 ms after it settles, and keeps the last plan while the next is on its way.
- **`ClipPreview.tsx`:**
  - **Video:** two always-mounted `<video>` slots, one per panel. The follower is muted and kept within 0.12 s of the master. Each slot is cropped with percentages from the plan's panel area, crop and path point, and Blur's background gets `blur(40px × scale) brightness(0.9)`.
  - **Overlay:** captions and hook are one SVG in the 1080×1920 viewBox. Baselines are placed as libass places them, from the font's Windows ascent and cap height, at `cssFontSize` (em ÷ units).
  - **Caption look:** the outline is an SVG stroke at 2 × outline with `paint-order: stroke`, the shadow an offset copy, and the box highlight a rect measured with canvas `measureText`.
  - **Hook:** fades out over 200 ms.
  - **Transport:** play/pause, a scrubber, "Play clip" and "Play ending".
- **`CandidateEditor`:**
  - A Clip/Source switch; the old `PreviewPlayer` is the Source view.
  - Fonts load once.
  - `HookEditor.onDraft` previews the hook while it is typed.
  - Preview notes with "Prepare clip" (through `JobPage.prepare`, which reconnects the job events). The plan is fetched again when the Job's status changes.

**Browser check:**
- **Track** (2f6cdf1b at 1.5 s) and **Split** (3444ea04 at 1.5 s): the preview and the rendered Clip's frame agree on crop, caption line, caption position (lower third, and the seam at exactly 50%), highlighted Word, and hook box and lines.
- **Typing a hook while playing:** the overlay changed to the new text and playback went on.
- **3cc01d0e** (analysed, no clip Words) showed the transcript note. "Prepare clip" queued it, the button said "Preparing…", Whisper wrote `words/1588860-1641840.json`, and the note went away.

Not checked: the light theme. The preview's frame is video, and the notes use existing tokens.
