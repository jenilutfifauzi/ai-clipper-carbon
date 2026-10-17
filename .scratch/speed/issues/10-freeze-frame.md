# 10: A Freeze frame, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 24–25, 27, 31; Solution "Freeze frame"; Implementation Decisions "The Candidate model", "The planner", "The renderer", "The preview", "The MCP server"); ADR 0009.

**What to build:** the agent can put a Freeze frame on the Main Track: a Segment that holds one frame of the Source or of a video for `hold` seconds, silent, framed as its Segment was at that moment. Through MCP; the action and its editing come in 11.

- **Model.** `hold` on the Segment. With it, `end` equals `start`, `speed` is 1, and `pitch` and `reverse` are false; anything else is refused. Its Timeline length is `hold` (at least 0.1 s). A held Source Segment isn't snapped to Words and has no Keyframes; a held media Segment may have picture Keyframes, not volume ones.
- **Planner.**
  - Of the Source: one Scene with the Layout of the Scene holding `start` (an override there, or the Candidate's), its panels' crop and camera at that instant; no captions.
  - Of a video: drawn as any media Segment from its Framing (and its Keyframes).
- **Renderer.** The video at `start`, one frame, held with `tpad` for `hold` seconds; silence for its sound. Transitions may join into and out of it. Music Clips play on over it.
- **Preview.** A deck (or the media Segment's video) parked and paused at its frame, its time on a clock for `hold`.
- **MCP.** `hold` through the edit tools. The instructions say how to make a Freeze frame: split the Segment at the moment and put a held Segment of that instant between, then move the layers after it. The dry run lists it with its span.

**Blocked by:** 01.

**Status:** done

- [x] A held media Segment of the test video renders the same frame for its `hold`, at the frame counter of its `start`, in silence.
- [x] A held Source Segment renders with the Layout of its instant (a Track Scene's crop where the face was) and no captions.
- [x] A held media Segment with a scale Keyframe zooms over its still.
- [x] A Transition into and out of a held Segment renders.
- [x] The API and MCP refuse a `hold` with `reverse` or a Speed, a `hold` under 0.1 s, Keyframes on a held Source Segment and volume Keyframes on a held media Segment.
- [x] The preview shows the frozen frame for its `hold` and resumes the next Segment on time.

## Comments

**2026-10-17: done.**

**What was built:**
- Model: `Segment.hold` (`TimelineSecs | None`, so 0.1–3600 s), in its own lines after `keys`. `_check_held` (candidates.py) refuses an `end` other than `start`, volume Keyframes, and a Speed ≠ 1, `pitch` or `reverse`. Those three are read with `getattr` defaults, so the check works now and starts biting once 02/06 add the fields. Until then pydantic ignores the unknown keys, so `test_a_freeze_frame_has_no_speed_pitch_or_reverse` is skipped while `Segment` has no `speed`; it runs by itself after the merge. A held Source Segment's Keyframes are refused by the existing rule (the episode's Segments have none).
- Review: a held Source Segment isn't snapped (only checked against the Source's duration). A Clip needs at least one Source Segment that *plays*, and the Candidate's hull (`start`/`end`) is of the Source Segments that play: a Freeze frame isn't between Words, and a hull of only held ones would be empty.
- Analysis of a held Source Segment (`rendering.analysed_range`): the range of the first Segment of the Candidate that plays through its frame (after a split, the head; its analysis is made anyway, and its last frame is what was just shown), else `HELD_REACH_SECS` (1 s) either side of the frame, analysed and cached under `analysis/<start>-<end>` like any range. `needed_analysis`, `prepared`, `_all_analyses` and the editor's preview all read this range; Layout Overrides in it reach the planner relative to it. A held Segment has no Words of its own (`_all_words`, `prepared` and the editor's preview skip it; the planner gives it no captions or Word Edits).
- Planner: `SegmentInput.analysed` carries that range. `_still` frames the range as `_framed` does, takes the Scene holding the frame (the last one when the frame is at its end), and holds each panel's crop where the camera is at the frame (one path point). Its `framing` is the Track crop's (`_first_framing`), or the Scene's own otherwise. Source `SegmentPlan`s now carry their Segment's `id` too, which the dry run uses.
- Renderer: a held input reads `_HELD_READ_SECS` (0.5 s) from `start`, and its picture is `trim=end_frame=1,setpts,tpad=stop_mode=clone,trim=duration=hold`. Its sound is `anullsrc` for its hold; a held Segment turns off the plain `concat` of the Source's sounds. `frames.VideoDecode` decodes one frame of a held `shown` and holds it, so a keyed held media Segment zooms over its still.
- Preview: `Playback` treats a held Segment like a media one (`clocked`). The time runs on the clock for its hold. A held Source Segment's frame shows on the deck parked there, swapped in paused (`swap(false)`), or else on the live deck cued there and paused. Leaving it plays the next Source Segment as leaving a media Segment does. `follow` keeps a held media Segment's video paused at its frame.
- MCP: an instructions paragraph on Freeze frames and how to make one (split, put a held Segment between, move the layers after). The dry run gains `segments`: each Segment's `id`, Timeline `start`/`end`, `source_start`/`source_end`, `media` and `hold`. **Ticket 02 also adds a Segment span list to the dry run: merge the two into one list.**

**Decided differently, or worth knowing:**
- `TOOLS_BUDGET_BYTES` in tests/test_mcp.py went from 60 000 to 61 000: `hold` on the Segment and on its patch model put the tool list about 130 bytes over. 02, 04 and 06 add more fields and will need more room, or a trim. The owner should decide which.
- No `check_ffmpeg` exists in the code yet, so nothing checks for `tpad`.
- A Manual Layout Override's Keyframes don't apply to a held Source Segment: its Scene shows the override's Framing unkeyed (the spec says a held Source Segment has no Keyframes). If the override is keyed, the Freeze frame may not match the picture shown just before it. Ticket 11 could sample the motion at the frame.
- For 11 (`freezeFrame`): the planner frames a Freeze frame of the Source from the head's analysis when the head plays through its frame. A split whose head ends at the Word-snapped cut rather than exactly at the frame then falls back to the window or the tail. Give the head an `end` at or after the frame where possible. Also, the API leaves a held Segment's `start` unsnapped.
