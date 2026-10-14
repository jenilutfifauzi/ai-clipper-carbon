# 06: Uploaded video Segments (intro, outro, full-screen B-roll)

**Parent spec:** `spec.md` in this feature folder (user story 12).

**What to build:**
- **Model:** a media `Segment` holding a video item, `in`/`out`, `fit` (`fill | blur`, default `blur`) and `volume`. A non-video or unknown item is refused.
- **Planner:** its `SegmentPlan` has no Scenes and no captions (Word Edits never reach it).
- **Renderer:** its own input, trimmed, then:
  - `fill`: scaled and centre-cropped to 1080x1920.
  - `blur`: fitted over a blurred, filled copy (as the Blur Layout).
  - Its sound gets `volume`, or silence if the file has none, so that `concat` keeps the audio stream.
- **Preview:** plays the proxy in its own video element during its span.
- **Workspace:**
  - Drag a video from the Media tab onto the Main Track, between or at either end of Segments.
  - The inspector sets fit and volume.
- **Media Library:** deleting a video in use as a Segment is refused.

**Blocked by:** 03, 05.

**Status:** ready-for-agent

- [ ] Seam B: no captions over a media Segment; durations add up.
- [ ] Seam A: an intro Segment renders with the right duration, fill and blur both 1080x1920, and with sound or silence.
- [ ] Typecheck and build; browser walkthrough with a portrait and a landscape upload.

## Comments
