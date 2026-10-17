# 07: A reversed Segment of the Source

**Parent spec:** `spec.md` in this feature folder (user stories 17, 20–21, 23; Solution "Reverse"; Implementation Decisions "The planner", "The preview"); ADR 0009, ADR 0006.

**What to build:** a Segment of the episode can be reversed. It shows no captions, its Scenes and face tracking are the forward ones mirrored, Layout Overrides still apply, and the preview plays its Split and Blur panels backwards from the copy. Through MCP; the switch comes in 08.

- **Planner.** A reversed Source Segment gets no Words. Its Scenes are its range's analysis with times turned (`t → length − t`), scaled by its Speed, and its camera path run backwards. A Layout Override applies to the Scene holding its Source time. No new analysis is run.
- **Renderer.** Its Scenes and panels are drawn from the full-size copy of the Source's range, at its Speed, with the Clip's own volume.
- **Preview.** A Segment played from a copy gets its own master and follower, parked at its start like a media Segment's video, so every panel of its Scenes draws from the copy. The decks resume at the next forward Source Segment.
- **Word Edits** inside a reversed Segment are kept and still apply wherever their time is shown forwards.

**Blocked by:** 03, 06.

**Status:** done

- [x] The plan of a reversed Source Segment has no caption events in its span, and the captions on either side are unchanged.
- [x] A Scene cut at 2 s into a 10 s range sits at 8 s into the reversed Segment on the Timeline (4 s at 2×).
- [x] A Layout Override at a Source time inside it applies to the mirrored Scene.
- [x] A Split Scene renders both panels reversed and in step.
- [x] In the preview, a reversed Source Segment between two forward ones plays backwards with both panels, and the joins on either side are seamless.

## Comments

**2026-10-17: done.**

**What was built:**
- Model: `reverse` on a Segment of the Source is no longer refused (a Freeze frame's still is). A one-Segment reversed Clip is kept as its `segments` (03's rule already held).
- Planner: `_retimed(framed, time, length, source)` mirrors a reversed Source Segment's Scenes before scaling them: `_mirrored_scene` turns `[a, b]` into `[span − b, span − a]`, the last Scene first, and each panel's crop held over `[p_i, p_i+1)` onto `[span − p_i+1, span − p_i)` (the camera path run backwards); a Track Scene's `framing` (what draws its first frame) is taken again from its new first crop. Layout Overrides apply in `_framed` on the range's seconds, before the mirroring, so they land on the mirrored Scene holding their Source time. `_manual_showings` runs before the mirroring as 03 left it and gives a reversed Segment's showings their index among the mirrored Scenes and `reverse`. `_segment_words` skips a reversed Segment (no Words, no Word Edits there); the Word Edits stay in the Candidate and apply in any forward Segment showing their time. `editor.py`'s preview words, `_all_words` and `prepared` skip it too, so no Words are transcribed for it.
- **Decided: a keyed Manual Scene in a reversed Segment plays its motion backwards on the same frames** (`_keys_backwards`: each Keyframe at `(until − k) ÷ speed`, last first, each span's Ease turned by point reflection, so an ease in becomes an ease out). It has no `keys_from`, so the Advanced Edit doesn't key it there (`keying.manualScene` gives null): it is keyed where its Scene plays forwards. Keys past the latest showing's end are left out, with no `ignored` list on the reversed showing.
- **The one-frame offset needs no fix.** A copy's first frame is the Source frame at `end − 1/fps`, the last one inside the range: that is the frame mirror of the half-open `[start, end)`, and it puts the mirrored Scene cuts and crop change points (`t → length − t`) on exactly the right frames (checked by the render test: the first reversed frame is the frame before `end`, the last the frame at `start`). The preview's held frame keeps `source_end − 1/fps` (the plan's `fps` for the Source).
- Renderer: `SegmentPlan.read_from` (None in every plan written; set only by `read_from_copies`). `read_from_copies` now rewrites every reversed Segment: a media one as before, a Source one by `read_from` = its full-size copy (in `files`), `source_start/end` = `copy.read(time)`, `reverse=False`. `_source_inputs` reads `files[segment.media or segment.read_from]`, so a Source Segment keeps the Clip's `source_volume`, the plain-concat path and its Scenes' panels; `_keyed_scenes` gives a keyed Manual Scene's frame process the copy too. `rendering._render` makes missing full-size copies of the Source as a render step (`source_copies(job_dir, source)`: `jobs/<id>/retimed/`, preview from `preview.mp4` or the video, full from the video, frame from the Source's metadata).
- API: `POST /api/jobs/{id}/retimed` (as the media one: 404 without a Source, 422 for a range outside it or forwards at 1×), URL `/media/{job_id}/retimed/{name}` served by the existing Job file route.
- MCP: the dry run's `copy` for a Source Segment looks in the Job's copies. Instructions: the Reverse lines say an episode Segment has no captions and its Scenes and Layout Overrides are the forward ones mirrored (instructions only; the tool list is unchanged).
- Preview: `onOwnVideos(segment)` in `playback.ts`: a video's Segment, or one of the Source played from a preview copy (reversed, or, after merging 09, at a Speed outside 0.25–4×). Such a Segment is clocked, the decks park at the next Segment that plays on them (`parkTarget`), and the skim and the Loop's `wrapTarget` treat it as a media Segment. `PreviewSegments` draws a Source one with `CopiedSourceSegment`: its own master and follower (`PanelView`s of its Scene at the shown time, `slotView`) playing the copy via `follow` (`sourcePlay`, 09's `fromCopy` with the Source's proxy and the plan's frame: from `copy.at`, at its Speed when only reversed, at the preview rate when retimed), parked at its start, at `source_volume × volume`, black behind, "Reversing… n%" / "Retiming… n%" (or "Couldn't reverse this Segment") until the copy is made, its first frame held on the Source's proxy meanwhile. `RetimedAsk` takes `{ job, range }` too (`api.sourceRetimedCopy`). The Transition ghost draws it the same way with its fade. `ClipPreview` has a `jobId` prop (both callers pass it). This also closes 09's open box for Source Segments (see 09's Comments).

**Tests:** `backend/tests/test_reversed_source_segments.py` (no captions in its span and those around unchanged; a Word Edit kept and applied where its time plays forwards; the 2 s cut at 8 s, 4 s at 2×; the camera path run backwards at 1× and 2×; a Layout Override on the mirrored Scene; a keyed Manual Scene's motion backwards with its Eases turned; the Job's copy API; a one-Segment reversed Clip previews no Words; MCP dry run without captions in it and its `copy`; a real render of a Split Scene from a two-counter Source: both panels count down in step, from the frame before its end to its first, with its full-size copy made by the render). 06's test now saves `reverse` on the episode's Segment and refuses it on a Freeze frame. `retimedCopy.test.ts`: a reversed Source Segment between two forward ones plays its copy on its own master and follower, the decks waiting at the next forward Segment and resuming on time; the held frame while the copy is made; 8× from its retimed copy, and 2× back on the decks. 03's playback test of a Source Segment past 4× on its deck now checks it runs on the clock off the decks. The Job's copy API also makes a retimed (8×) copy.

**For later tickets:**
- 08 (Reverse switch): the Advanced Edit's Filmstrip/Waveform, trim and split of a reversed Source Segment are untouched here. Keyframing a Manual Scene is off in a reversed showing (no `keys_from`).
- 09 (sweep): Source copies are in `jobs/<id>/retimed/`, found through `rendering.source_copies`.
- The preview's own videos of a Source Segment played from a copy both follow the clock with `follow` (each moved back within 0.15 s of drift), as a media Segment's two do; the follower isn't slaved to the master as on the decks.
