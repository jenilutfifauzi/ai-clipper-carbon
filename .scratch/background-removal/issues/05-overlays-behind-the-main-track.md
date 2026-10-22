# 05: Overlays Behind the Main Track

**Parent spec:** `../spec.md` ("Model", "Planner", "Renderer", "Preview", "Editor"); ADR 0015, 0004.

**What to build:** the owner switches an Overlay (B-roll) to "Behind the Main Track". It moves to a new Behind Track under the Video Track and plays behind the speaker: it shows where a cut-out Segment's Matte takes the picture away, and where a media Segment doesn't cover the frame, and nowhere else. It keeps its own Timeline time.

**The model:** Overlay gains `behind` (default false). The Render Plan lists Behind Overlays apart, with the OverlayEvent shape.

**Drawing order:** each Segment's Background, then the Behind Overlays at that Timeline time, then its picture, all before the joins. So a Transition crossfades whole frames, and the Candidate's Grade and every Adjustment Layer cover the Behind Overlays. Outside their spans they cost a pass-through.

**The Behind Track:** it behaves as the Overlay Track does: lanes worked out from overlaps, hide, mute and lock (editor only), the Magnetic timeline, Ripple delete, Split all, drag and drop, Edit Points, and the Pick.

**Blocked by:** 02

**Status:** done

- [x] Seam B: Behind Overlays are listed apart; a Candidate without `behind` plans exactly as before.
- [x] Seam A (fake matter): a Behind Overlay shows outside the kept area of a cut-out Segment, and not over a Segment that isn't cut out and covers the frame; under a Transition timing holds; the Candidate's Grade covers it.
- [x] The Inspector's "Behind the Main Track" switch moves an Overlay between the Tracks, as one step of undo.
- [x] vitest: the Behind Track's lanes, ripple and Split all.
- [x] The preview draws the order above, with hide and mute on the Behind Track.
- [x] MCP sets `behind`; the dry run shows it.

## Comments

**Built:**
- Model: `Overlay.behind: bool = False` (backend/app/candidates.py; `behind?: boolean` in api.ts). Copy, paste, duplicate, Split and the Revision merge carry it (they spread the item; matteHousekeeping.test.ts pins it); MCP's `merge_candidate_items` keeps the rest of the item.
- Planner (Seam B): `RenderPlan.behind: list[OverlayEvent]`, the same `overlay_events` of the Overlays with `behind`; `overlays` keeps the others. Their sound is heard as any Overlay's (`overlay_sound` takes them all). `scaled_plan`, `played_files` (files and Reverse copies) and `read_from_copies` handle `behind` as `overlays`. MCP dry run: `behind` (compacted, the Overlay view factored into `_overlay_view`); instructions line. `TOOLS_BUDGET_BYTES` still holds (no raise needed).
- Renderer (backend/app/renderer.py):
  - `_behind_slots(plan)`: the stretches the Behind Overlays are laid in: a cut-out Source Segment whole (`("segment", i)`), and each Scene of one picture that doesn't cover the frame (`_covers`, factored out of `_framed_scene`; a keyed one always) of a Segment that isn't cut out, or of a Clip of one range (`("scene", j)`). None at all without Behind Overlays, so every stored Candidate's command is unchanged (the command fixtures pass).
  - `_behind_parts(plan)`: each Behind Overlay cut to each stretch it overlaps, in the stretch's own time (its frames run from 0 at the stretch's start): start/end shifted, a video's `offset` from `event.time.part`, motion shifted (`_later`). A part cut before the Overlay's end runs one frame past the stretch: otherwise its input's EOF at the stretch's last frame lets the overlay pass the Background through on that frame (it showed as a dip at a Transition's last frame).
  - `_behind_inputs`: one input per part (`_overlay_input`, factored out of `_overlay_inputs`); a keyed or animated part reads a frame process `("behind", k)` (`_keyed_overlay` / `_overlay_feed` factored out; sampled from the whole Overlay at Timeline time, so animations and Keyframes don't restart at a cut).
  - `_behind` lays a stretch's parts with `_overlay` (names `layerb<k>`; `fps=` first when a part has a frame process), so Blend Modes and `_spanned` work as for the others. Laid in `_cut_out` between `[{name}b]` and `[{name}c]`, and in `_framed_scene` / `_keyed_scene` between the Background `[{name}l]` and the picture. `_segmented(..., behind)`, `_scenes(..., behind={place: lay})`, `_scene(..., behind)`. All before the joins: the Candidate's Grade and Adjustment Layers cover them; an uncut media Segment's own Grade covers them with its Framing Background (as the whole frame it already grades).
  - `_at_frame` drops Behind Overlays not on the frame.
- Preview: `BehindOverlays` (PreviewOverlays.tsx; `PreviewOverlays` takes `events`) and `coversFrame`. Drawn in `CutGroup` over `CutBackdrop` under `DecksGraded` (visible with the cut); inside `DecksGraded` between the decks' first slots and the others when the shown Scene is a Manual one its picture doesn't cover (hidden with the cut); in `MediaSegment` between its Background and its picture unless the picture covers the frame (`plan` prop added); and in the Transition ghost both ways. GradeFilters/EffectFilters include their Grades and effects.
- Timeline: `TrackKind` `behind` ("Behind", hides and mutes, locks), drawn under the Video Track by `overlayRows("behind", false)` (Tracks.tsx: one function for both Overlay Tracks; lanes downward from the Video Track), drop target `DropTrack` "behind" (`newOverlay(..., behind)`). `trackOf` / `trackOfRef` / `overlaysOn` (pick.ts) put a behind Overlay on the Behind Track for lock (`unlockedPick` now takes `edits`), Split all (`under`), paste (clipboard), Edit Points (`edgesOf`), Keyframes (keying.ts `editableItem`). Ripple delete closes gaps per Track (Overlay vs Behind). Magnetic timeline ripples them as any Overlay. `shownPlan` hides `behind`; `heardDraft` mutes each Track's own.
- Inspector: `BehindSwitch` "Behind the Main Track" in `OverlayFields` (after the decoration, before Remove background); `setBehind` (actions.ts) is one change, keeps time and Pick, Over drops the field, refused onto a locked Track with a notice. The phone's sheet renders the same Inspector.
- GLOSSARY: Track's hide/mute lists name Behind.
- Tests: `backend/tests/test_behind_overlays.py` (Seam B: listed apart, same event, sound; a stored Candidate plans as before. Seam A, fake matter: shows outside the kept area over the Background and not over a covering uncut Segment; a keyed/animated one through its frame process in two cut-out Segments, fading in; the Candidate's Grade greys it; shows around a Manual Layout's half-size picture (one-range Clip); a video Behind Overlay across two cut-out Segments and a fade renders frame for frame as the same Overlay over the Main Track in the corner. MCP: merge sets it, dry run lists it apart). `frontend/src/pages/job/advanced/behindTrack.test.ts` (lanes, drop, Magnetic ripple, Ripple delete per Track, Split all and lock, hide/mute, unlockedPick, paste onto locked, Edit Points, `setBehind`, switch markup, `coversFrame`, `BehindOverlays`), matteHousekeeping.test.ts Overlay case.

**Walkthrough** (ego-browser, desktop 1440x1200, scratch copy of a real Job, real RVM model, backend from this worktree on :8011): a cut-out Segment (teal Background) with a video Behind Overlay: the Behind Track sits under Video with eye/speaker/lock; the B-roll draws over the teal and under the cut-out speaker; hiding the Behind Track removes it; the Inspector switch moves it to the Overlay Track and one Undo brings it back; across a fade into an uncut Segment the ghost crossfades. Not checked on the phone layout or a real iPhone.

**Notes / for 06:**
- Behind Overlays aren't picked or moved on the stage (`stagePictures` lists `plan.overlays` only); the Inspector's Transform works. A follow-up could add them under the Segment's picture.
- The switch is for one Overlay; a mixed Pick has no shared Behind switch.
- A media Segment cut out (06): `_behind_slots` treats only Source Segments with `background_removal` as cut-out stretches (`segment.media is None`); when 06 plans a media Segment's removal, widen that test so its Behind Overlays go in `_cut_out` rather than its Scene, and in the preview `MediaSegment` should put `BehindOverlays` under the cut canvas.
