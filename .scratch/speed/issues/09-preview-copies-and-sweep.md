# 09: The preview beyond 0.25–4×, and the sweep of unused copies

**Parent spec:** `spec.md` in this feature folder (user story 14; Solution "The preview"; Implementation Decisions "Retimed copies"); ADR 0009.

**What to build:** the preview plays any Speed with its sound, as the render will, and Retimed copies nobody uses any more are removed.

- **Preview copies.** A Segment or a video Overlay at a Speed outside 0.25–4× plays a preview-size Retimed copy of its range, retimed at its Speed (and reversed if it is), with its sound made by the render's chain. It is played at the preview rate. The copy is named by its Speed and pitch too. While it is being made, the held first frame and progress show, as in 06.
- **The sweep.** When a Job is opened, Retimed copies of its Source, and of media items only its Candidates use, that no Candidate nor any state in their Revision History uses are removed. Copies still being made are left.

**Blocked by:** 03, 04, 06.

**Status:** ready-for-agent

- [ ] A Segment at 8× plays in the preview with its sound (pitch kept), in an eighth of its range, and leaves at its Timeline end.
- [ ] A Segment at 0.125× plays in the preview with its sound, at eight times its range.
- [ ] Changing a Segment from 8× to 2× plays it on the decks again with no copy.
- [ ] The sweep keeps a copy used only by an older Revision in the Revision History and removes one used by none.
- [ ] The sweep never removes a copy that is being written.
