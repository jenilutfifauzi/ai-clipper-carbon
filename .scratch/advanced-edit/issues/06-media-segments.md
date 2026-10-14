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

**Status:** done

- [x] Seam B: no captions over a media Segment; durations add up.
- [x] Seam A: an intro Segment renders with the right duration, fill and blur both 1080x1920, and with sound or silence.
- [x] Typecheck and build; browser walkthrough with a portrait and a landscape upload.

## Comments

**2026-10-14: done.**

**Checks:**
- `tests/test_media_segments.py`:
  - Seam B: Fill and Fit-over-blur Scenes from the video's size; no captions over a video's Segment.
  - Seam A: validation (an image, an unknown item, past the video's end, no piece of the episode); delete refused in use.
  - Seam A: a render with a filled red intro, an episode piece and a silent fitted outro. Checked by frame colour, by sharpness in the middle against the blur, and by sound in the intro and silence in the outro.
- `npm run build`.
- Browser:
  - A 4 s video added after the first piece (filmstrip on the track, captions skipping it).
  - Played from the episode through the video and back. The Source video waits while the video's own player follows the clock, and the next piece resumes at its Source time.

**Changes from the plan:**
- A Clip needs at least one Segment of the episode, and its `start`/`end` are their hull.
- With videos among the Segments, each Segment's sound gets its volume before the join, and the Clip's own volume isn't applied again in the mix.
- Images aren't Segments; they go on the Overlay track (07).
- Through a video's Segment, the preview's Playback runs on a clock of its own.

**Note:** in the automated browser's hidden tab, `requestAnimationFrame` is throttled, so hand-overs there land late. They are on time in a visible tab.
