# 02: Muted, for the agent, the render and the preview

**Parent spec:** `spec.md` in this feature folder (user stories 18–19, 60; Solution "Muted"; Implementation Decisions "Model", "Planner, other", "Renderer", "Preview", "MCP"); ADR 0016; GLOSSARY "Muted".

**What to build:** the agent can mute a Segment, a Music Clip or a video Overlay. The rendered Clip and the preview are silent there, whatever the item's volume or volume Keyframes say. The item keeps its volume, Keyframes and fades, so unmuting brings back what it had. There is no editor UI yet (03).

- **Model.** `muted` (default false) on Segment, Music Clip and Overlay. A stored Candidate reads as unmuted.
- **Planner.** `SegmentPlan` and `AudioEvent` carry `muted`. An Overlay's `muted` reaches its sound event.
- **Renderer.**
  - A Muted Segment's sound is silence of its Timeline length, as a held one's is. The plain `concat` path requires no Muted Segment.
  - A Muted Music Clip or Overlay is left out of the mix.
  - The loudness passes measure what is left.
- **Preview.** A Muted sound is held at gain 0: the decks' Source sound for a Muted Source Segment, and the event's element for a Music Clip, an Overlay or a media Segment. Keyed curves of a Muted item are not followed.
- **Track mute stays the editor's alone.** The heard draft still mutes Tracks by volume 0 and never writes `muted`.
- **MCP.** `muted` passes through `edit_candidate` and `merge_candidate_items`. The instructions say what Muted keeps. The dry run marks Muted items.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A render with a Muted Source Segment between two heard ones is silent for exactly its Timeline span (generated video with a tone).
- [x] A Muted Music Clip with volume Keyframes is not heard. A Muted video Overlay with volume 1 is not heard.
- [x] Unmuting the same items brings their sound back at their volume and Keyframes.
- [x] A stored Candidate without `muted` renders the same ffmpeg command as before (the unkeyed command fixture).
- [x] The preview's gain for a Muted item is 0 at every time, keyed or not.
- [x] The MCP tools set and clear `muted`. The dry run shows it. The tool descriptions stay within the budget.

## Comments

**2026-10-18: done.**

**What was built:**
- `muted: bool = False` on `Segment`, `MusicClip` and `Overlay` (`candidates.py`), each on its own line after the item's other fields. A stored Candidate reads as unmuted by the default. One Muted Segment covering the Clip's range is kept as its Segment: `review.update` no longer folds it into the plain `start`/`end`, which can't be Muted.
- Planner: `SegmentInput`, `SegmentPlan` and `AudioEvent` carry `muted`; `candidate_plan` passes a Segment's, `audio_events` a Music Clip's and `overlay_sound` an Overlay's. Muted items stay in the plan, keeping their volume, Keyframes and fades. `gain_at` gives 0 for a Muted event, as `loudness` does.
- Renderer: a Muted Segment's sound is `anullsrc` of its Timeline length, as a held one's is, and a Muted Segment is never on the plain `concat` path. `_music_inputs` and `_audio_mix` leave out Muted events (and a song only they play), so both loudness passes measure what is left.
- Preview: `loudness` is 0 for a Muted event, and `followCurve` holds a Muted one at 0 instead of following its curve. `MediaSegment` and `CopiedSourceSegment` pass the Segment's `muted` into their sound's event. The decks' Source sound is set to 0 while the shown Segment is Muted (`PreviewMusic`); `PlayedSegment` and `playedFrom` carry `muted` for that. `api.ts` has `muted?` on `ClipSegment`, `MusicClip`, `Overlay`, `AudioEvent` and `SegmentPlan`.
- Track mute is unchanged: `heardDraft` still mutes by volume 0. `trackState.test.ts` now pins that it leaves `muted` alone.
- MCP: `muted` passes through `edit_candidate` and `merge_candidate_items` as a model field. A short instruction says what Muted keeps. The dry run marks `muted` on `segments`, and `sounds` now lists Muted sounds as well as keyed ones (`keys` only when keyed).

**Decided differently / left for later:**
- **Tool budget.** The three `muted` fields took the tool list to 69 349 bytes, over the 69 000 budget. Rather than raise it, `_patch_model` now drops the field titles from the patch schemas of `merge_candidate_items` (each was its field's name again). The list is now 67 836 bytes, which leaves room for 04, 06, 07 and 10.
- **No refusal of `muted`** on an image Overlay or a Freeze frame. Both are silent anyway, and the editor's M ignores them (03).
- **The dry run's `sounds`** lists the keyed and the Muted ones, not every sound. The spec's full list (span, fades, ducked spans for every sound) belongs to 04 and 10.
- **Tests:**
  - `backend/tests/test_muted.py`: a stored Candidate read unmuted; the plan's Muted Segment, Music Clip and Overlay at gain 0 with their volume and Keyframes kept; the API keeping one Muted Segment; MCP setting, clearing and dry-running it; and a real render of three Source Segments with the middle one Muted, plus a keyed Muted song and a Muted video Overlay at volume 1. The Muted Segment's span is silent, neither tone is heard, and unmuted they all come back at their volume and Keyframes.
  - The unkeyed command fixture (`test_keyframes.py`) is unchanged and passes.
  - `loudness.test.ts` "a Muted sound"; `trackState.test.ts`.
