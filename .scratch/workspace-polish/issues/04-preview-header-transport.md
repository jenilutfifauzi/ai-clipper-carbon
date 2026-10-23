# 04: Preview header and the deck Transport

**Parent spec:** `../spec.md`; docs/adr/0025-workspace-polish-flat-panels-and-one-media-tab.md.

**What to build:**

- The player section becomes a `panel` with a header: "Preview" left, the output size and fps (e.g. `1080 × 1920 · 30 fps`, from the Canvas Aspect / export preset) centred, the AspectPicker right.
- A deck variant of `Transport` (`editor/ClipPreview.tsx`), Advanced Edit only: timecode box (`t / duration`) left; Go to start, Step back, Play/Pause, Step forward, Go to end centred; Compare, Hold Original, Take, Rate, Loop, Fullscreen right. No position slider (desktop and phone). The clip editor's Transport is unchanged.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Tests for the feature pass (`npx vitest run` on the touched test files only), `npx tsc --noEmit` clean.
