# 09: Filters and Adjust on a phone

**Parent spec:** `../spec.md` ("Advanced Edit UI", Phone).

**What to build:** the phone's Advanced Edit toolbar gains two buttons, Filters and Adjust. Both act on the Pick, or on the Candidate with nothing picked. Neither has hover audition nor Compare render.

**Filters** opens a bottom sheet with:
- a horizontal strip of Look cards by category, each on the frame at the playhead;
- an intensity slider;
- "Add as layer", which makes an Adjustment Layer at the playhead with the chosen Look.

**Adjust** opens a bottom sheet with the dials, grouped as on the desktop, each with a reset.

**Blocked by:** 05, 07.

**Status:** done

- [x] **Undo:** a tapped card applies its Look to the Pick or the Candidate as one undo step.
- [x] **Add as layer:** it makes an Adjustment Layer at the playhead.
- [x] **Adjust sheet:** its dials edit the same Grade as the desktop Inspector.
- [x] **Checked on an iPhone-sized viewport:** the sheets fit, and no horizontal page scroll appears.

**Notes (done):**
- Toolbar: Filters and Adjust buttons for a Pick with Grades (Segments, Overlays, Adjustment Layers); with nothing picked, the asset tab's Filters opens the phone Filters sheet and Adjust sits beside it. Not shown in picking mode (Edit opens the Inspector's Color section there).
- Filters sheet (`LookPanel.tsx`: `PhoneFilters` → `FiltersPanel` → `LookStrip`, reusing `LookButton`): one sideways-scrolling strip with the Looks by category, intensity (off without a Look), "Add as layer" with the last card tapped, else the target's Look, through the desktop's `addAdjustment` (refused on a locked Adjust Track, 3 s or to the Clip's end). No Import on the phone.
- Adjust sheet (`ColorFields.tsx`: `AdjustPanel` over `AdjustDials`, the dials split out of `ColorFields`): desktop groups, a 44 px reset per dial, and Reset all.
- `colorChanges` (ColorFields.tsx) now drives the desktop Inspector's Color section and both phone sheets, so the same Grade and undo groups; `gradesOf` (actions.ts) names what they change.
- Checked at 390×844 with touch emulation (Looks served by a mock; writes refused, so nothing saved): no horizontal page scroll, strip scrolls within itself, no control under 44 px in either sheet. Tests: `advanced/phoneColor.test.tsx`.
