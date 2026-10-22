# 08: Matte housekeeping

**Parent spec:** `../spec.md` ("Matte store and runner", "Model download", "Model"); ADR 0015.

**What to build:** Mattes don't pile up, and the fields move with items like any other.

- **Sweep:** when a Job is opened, Matte pieces (and reversed copies) that no Candidate nor its Revision History shows are removed, as Retimed copies are. The same applies to a media item's pieces across Jobs.
- **Model removal:** removing the person model is refused (409) while a Matte is being made, and once done it removes every Matte.
- **Moving items:** copy, paste, duplicate, split and the Revision merge carry `background_removal`, a Segment's `background` and an Overlay's `behind`.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Seam A: the sweep removes unused pieces and keeps those a Candidate or its Revision History shows.
- [ ] Removal while busy is refused; removal deletes every Matte.
- [ ] vitest: copy and paste, split and the Revision merge carry the fields.
