# 03: A sped Segment of the Source

**Parent spec:** `spec.md` in this feature folder (user stories 1, 7–8, 13–14; Solution "Captions of a Segment at Speed", "Word snapping"; Implementation Decisions "The planner", "The preview"); ADR 0009, ADR 0002.

**What to build:** a Segment of the episode at a Speed plays with its captions in time with its speech, its Word Edits on their Words, and its Layout and face tracking framed as at 1×. Through MCP; the editor UI comes in 05.

- **Planner.** Words of the Segment placed on the Timeline through the mapping's inverse, so caption lines and highlights follow. Word Edits and Layout Overrides matched by Source time as today. Scenes and the camera path of its analysis scaled by 1 ÷ Speed.
- **Snapping.** Unchanged: its ends snap to Words on the Source, and the longest-clip limit applies to its range as today and to the Clip on the Timeline.
- **The editor's preview words** (for Word Edits) get Timeline times through the mapping, so the clip editor's caption editing finds them.
- **A one-Segment Clip at a Speed is stored as its Segments,** not folded back into `start`/`end`.
- **Renderer.** The Source Segment's read, Scenes and sound through the same chain as 02, with the Clip's own volume.
- **Preview.** The decks play a Source Segment at its Speed × the preview rate with `preservesPitch`; the parked deck is set to the next Segment's rate on a swap; the Transition ghost plays the outgoing Segment at its rate.

**Blocked by:** 02.

**Status:** done

- [x] A 2× Source Segment's Words land at half their offsets from the Segment's Timeline start; at 0.5× at twice.
- [x] A Word Edit on a Word of a 0.5× Segment is applied in the plan and the dry run.
- [x] A Layout Override at a Source time inside a 2× Segment applies to the Scene holding it, at its scaled Timeline span.
- [x] Rendered at 1.5×, the burned captions match the speech (checked against the plan's caption events) and the Clip's length is the range ÷ 1.5.
- [x] A one-Segment Clip saved at 2× reloads with its Speed.
- [x] In the preview, two Source Segments at 1× and 2× join seamlessly on the decks, the second at twice the rate, with the captions in time.

## Comments

**2026-10-17: done.**

**What was built:**
- Planner: a Source Segment is framed over its range as at 1× (`_framed` over its span, its Scenes, faces and Layout Overrides in seconds into the range as they come), then `_retimed` divides its Scenes' times and its crops' change points by its Speed (the last Scene ending at its Timeline length). So the camera path is the 1× one, scaled, not a new run of the spring on Timeline time; and the renderer's `sendcmd` times, being into the Scene on the Timeline, follow with no renderer change. `_manual_showings` now works on the range's seconds (`time.start + scene.start`, which is also right for 07's mirrored Scenes), and `_ManualShowing` carries the Segment's Speed: `_keyed_manual` divides a Manual override's Keyframes (and `keys_from`'s offset into the shot) by it, so its motion stays on the same frames.
- Words and Word Edits already went through `offset_of` in `_segment_words` and `editor.py`'s preview words since 01; tests now pin them at 2× and 0.5×.
- `review.update` folds one Segment into `start`/`end` only when it plays as a plain range (`segment_time(it) == SegmentTime(start, end)`), so a sped one (and later a reversed one) is kept as its `segments`. A held one can't be alone (a Clip needs a Segment that plays).
- Renderer: nothing new. 02's `setpts`/`speed_filters` chain and the Clip's own volume already applied to any Segment; the 1.5× caption render and a 2× face-tracking render check it.
- Preview: each deck remembers the Segment it shows (`Deck.shows`, set by `cue`, by `park` for the Segment it waits for, and by `swap`), and `paced` sets `playbackRate` = `previewSpeed(speed)` × rate and `preservesPitch` = not `pitch` from it. A parked deck already at its target keeps its seek and only takes the new Segment's rate (a replan). `PlayedSegment` has `pitch`; `playedFrom` copies it when given. The Transition ghost is a `Playback` too, so it plays the outgoing Segment at its rate; its follower copies `preservesPitch` as it copies the rate.
- MCP: the Speed paragraph speaks of any Segment: `start`/`end` stay Source time, an episode Segment's ends stay on Words with its captions retimed, Word Edits and Layout Overrides stay keyed by Source time; the 0.1 s minimum and the Keyframe sentence are a video's. Within the tool budget.
- Clip editor: a one-Segment sped Clip is `cut` (it has `segments`), so it gives way to the Advanced Edit; the note reads "This clip plays at its own Speed" and the summary shows its range instead of "1 Segments".
- Tests: `backend/tests/test_sped_source_segments.py` (planner Words at 2×/0.5×, a Word Edit at 0.5×, Scenes and camera path scaled, a Layout Override in a 2× Segment, a keyed Manual Scene at 2×; the API storing and reloading a one-Segment 2× Clip and its preview words; MCP dry run at 0.5× with a Word Edit; real renders: captions at 1.5× burned on their Words and the Clip's length, the crop following a moving face at 2×); `playback.test.ts` "speed" (two Source Segments 1× → 2× swapped seamlessly with the parked deck at 2×, the rate on seek and with `pitch`, past 4× at 4×, a one-deck ghost).

**For later tickets:**
- **05 (Advanced Edit):** `keying.ts`'s `manualScene` adds Keyframe times to `keys_from` as Timeline seconds, but in a sped Segment the planner now reads a Manual override's Keyframes as seconds on the Source's timeline (divided by the Speed). Keyframing a Manual Scene inside a sped Segment in the editor needs the same scaling (or the keys' span shown on the Source's scale). Unsped Segments are unchanged.
- The decks play outside 0.25–4× at the nearest of those, the time read through the mapping, as 02's media Segments do: the playhead runs at the clamped pace until 09's copies.
- 07 (Reverse): `_retimed` only scales; mirroring goes there. `_manual_showings` already reads the range's seconds, so it needs no change for mirrored Scenes as long as it runs before them.
