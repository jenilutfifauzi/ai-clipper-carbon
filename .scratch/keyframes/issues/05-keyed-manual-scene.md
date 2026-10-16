# 05: Keyed Manual Scenes

**Parent spec:** `spec.md` (user stories 6–7; Implementation Decisions "The Candidate model", "Planner", "Renderer", "Editor actions", "MCP").

**What to build:** a Manual Layout Override's Framing can move: the owner can pan from one speaker to the other in one shot by hand. Its Keyframes are in seconds from its Scene's start on the Source's timeline, so a piece of the Source shown twice moves alike both times, and Segment cuts never move them. The Candidate's own Manual Framing stays still.

- **Model.** `keys` on the Layout Override, for a Manual one only, with the picture properties. `at` need only be ≥ 0.
- **Planner.** The override's Keyframes are mapped from the Source's timeline into Timeline time through every Segment that shows its Scene. A piece shown twice gets two sets. Keyframes outside the visible part stay in the track. The Background follows 04's rule.
- **Renderer.** The Source picture of a keyed Manual Scene comes from the frame process, with its own decode of the Source range.
- **Editor.** A Keyframe on a Manual Scene is set at the playhead's Source time minus its Scene's start. Its diamonds are in its Transform section (with 06). It is never re-anchored by trims.
- **MCP.** The dry run lists a Manual Scene's Keyframes past its Scene's end as ignored.

**Blocked by:** 04

**Status:** done

- [x] Seam B:
  - [x] a Manual Layout Override's Keyframes come out in Timeline time in each Segment that shows its Scene;
  - [x] a piece shown twice gets two sets;
  - [x] a Segment that starts mid-Scene shows the motion from that point.
- [x] Seam A, real ffmpeg: a Manual Scene keyed in `x` has the Source picture at the sampled position at two times.
- [x] Seam A, HTTP and MCP:
  - [x] Keyframes on a non-Manual override, and on the Candidate's Framing, are refused;
  - [x] the dry run lists Keyframes past the Scene's end as ignored.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done, but for the check by hand.** Built test first in `backend/tests/test_keyed_scenes.py` (Seam B on the planner, Seam A through the API, MCP and the real ffmpeg) and the frontend's `advanced/keyedScenes.test.ts` (Seam D: Keyframe edits on a Manual Scene, its Grips, the picked Scene, and trims and splits leaving its Keyframes alone).

- **Time base.** Scenes are found per Segment (`_analysis` of each Segment's range), so a Segment always starts a Scene of its own and "its Scene's start" had to be pinned down: it is where **the earliest of the Segments that show the override's time** starts that Scene, and its end the latest end any of them shows. So the same piece shown twice moves alike, and a Segment that shows the shot from part way in (a Segment of `kita`..`ya` after one of `halo`..`ya`) shows the motion from there. Written down in ADR 0008's `at` bullet, `LayoutOverride`'s field comment, and the MCP instructions. Limit: a Layout Override applies only in a Segment whose range holds its `at` (as before), and when only one Segment shows the Scene, trimming its start moves the Scene's start and the motion with it on the Source (the editor doesn't re-anchor it, as the spec says).
- **Model.** `LayoutOverride.keys` (`backend/app/candidates.py`), checked in a new `__post_init__`: Keyframes on any other Layout are refused ("The track Layout Override at 4.5 s has no Keyframes: only a Manual one's framing can be keyed"); picture properties only; `checked_keys(..., length=math.inf)`, so `at` need only be ≥ 0. The Candidate's own Framing has no field for them: `no_framing_keys` (`api.py`), a BeforeValidator on `CandidateUpdate.framing` and on `merge_candidate_items`' `framing`, refuses a `keys` there ("The Candidate's own framing has no Keyframes: key a Scene's Manual Layout Override instead") rather than dropping it silently.
- **Planner.** `_framed`'s override lookup is `_held` now. `plan_render` collects every Manual Scene framed by a Manual override (`_showings`, a `_Showing` each: its place, the override, its Scene's start and end and the override's time on the Source) and `_keyed_manual` keys them: showings of one override (`_Showing.of_same`: its time within 2 ms, as each Segment rounds it, and the same Framing and Keyframes) share the Scene's start and end; each Scene goes through 04's `keyed_scene` with `start` = its Timeline start less how far into the shot it starts, so Keyframes outside what it shows stay in the track and its Background follows 04's rule. Both the cut (`main_track`) and the one-range plan do this. `ScenePlan` gained `keys_from` (that start in Timeline time, for every Manual Scene of an override, keyed or not: the editor sets Keyframes from it) and `ignored` (Keyframes past the Scene's end, in Timeline time, which are left out of the motion).
- **Renderer.** `_keyed_scenes(plan)` returns each keyed Scene's Media Library id (None: the Source) and where it starts in its file, for Segments of both kinds and for a one-range plan; `_keyed_items(plan, files, source)` gives the Source for a Manual one; `_feeds` decodes it with 02's `VideoDecode` from there. A one-range plan's `_scenes` gets the feeds' input numbers too (`keyed=drawn`). The keyed Scene is drawn by 04's `_keyed_scene`, over its Background, unchanged.
- **MCP.** The dry run's scenes add `ignored` (`_keys_view`, Timeline time). The Keyframes paragraph of the instructions names Manual overrides, their time base and `ignored`. The `keys` field on Layout Overrides grew the tool list; it is back to 59.8 kB of 60 kB by moving the `keys` explanations of `Segment` and `LayoutOverride` out of their docstrings (which are the schema's descriptions) into field comments.
- **Editor.**
  - `keying.ts`: `KeyedRef` has a `scene` kind, its `id` the Scene's place among the plan's Scenes (`sceneRef(index)`), so a Scene shown twice is two refs. `KeyScene` takes an optional `plan`; `keyedItem(edits, ref, track?, plan?)`; `manualScene(overrides, plan, index)` gives the item from `keys_from` (`start`), with `first` (how far into the shot the Scene starts) and `secs` (to its end), the override and its Framing; null for the Candidate's own Framing or a plan not yet of the override. `KeyedItem.first?`, honoured by `keyTime`, `heldTransform`, `writeItemKey`, `clearItemKeys` and the pane. `withKeyed` writes the override's `keys` and its Transform's constant. `keyableOf`/`keyRows` give the picture properties; `pickedKeyed(pick, scene?)` and `manualSceneAt(edits, plan, id, time)` make a picked Source Segment its Manual Scene under the playhead, through `usePickedKeyed(scene, playback)` (`KeyCluster.tsx`) in `AdvancedEdit` (K, [ ], the ruler's diamonds) and `KeyframesPane`. `withSceneTransform` (any editor's edits) and `writeSceneTransform` (the stage, a locked Video Track refusing it).
  - `SceneFields.tsx`: a Scene's own Manual Framing shows its Transform at the playhead with its ‹ ◆ › (`keyed` on `TransformFields`), writes through `withSceneTransform` (history groups `@<at>` as 06's), and Reset drops its Keyframes. The clip's Framing has no clusters.
  - Stage (`AdvancedEdit`): `keyedScene(index)` holds a keyed Manual Scene where it is at the playhead and its Grips (and Crop mode's commit) write Keyframes there.
  - Trims, splits, ripples and pastes never touch `layout_overrides`' Keyframes: none of 07's re-anchoring reaches them (checked by `split` and `dragSegment` in the test).
- **Preview.** `PanelView` (`ClipPreview.tsx`) moves a keyed Manual picture as `PicturePanel` does: sampled at the time shown on each frame of the clock, its box and opacity written directly (`SlotVideo` takes `boxRef`/`layerRef`). `scenesAt`/`hasKeyedPictures` already sample any keyed Scene, so its Grips go by its bounds at the playhead.

Not checked by hand: the preview's moving Manual picture in the browser, the clusters in a Scene's Transform section, the stage's Grips on a keyed Manual Scene, and K/[ ]/the ruler/the pane on one. Stood in for by: the two renders measure the red Source's centre at two times against `value_at` (one range, and a Segment showing the shot from part way in); `keyedScenes.test.ts` checks the Keyframe times, Grips and the picked Scene; typecheck and build cover the wiring. Ticket 11's walkthrough covers it.
