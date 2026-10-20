# 09: Filters and Adjust on a phone

**Parent spec:** `../spec.md` ("Advanced Edit UI", Phone).

**What to build:** the phone's Advanced Edit toolbar gains two buttons, Filters and Adjust. Both act on the Pick, or on the Candidate with nothing picked. Neither has hover audition nor Compare render.

**Filters** opens a bottom sheet with:
- a horizontal strip of Look cards by category, each on the frame at the playhead;
- an intensity slider;
- "Add as layer", which makes an Adjustment Layer at the playhead with the chosen Look.

**Adjust** opens a bottom sheet with the dials, grouped as on the desktop, each with a reset.

**Blocked by:** 05, 07.

**Status:** ready-for-agent

- [ ] **Undo:** a tapped card applies its Look to the Pick or the Candidate as one undo step.
- [ ] **Add as layer:** it makes an Adjustment Layer at the playhead.
- [ ] **Adjust sheet:** its dials edit the same Grade as the desktop Inspector.
- [ ] **Checked on an iPhone-sized viewport:** the sheets fit, and no horizontal page scroll appears.
