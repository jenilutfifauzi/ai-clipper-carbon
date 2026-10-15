# 09: Paste into other Candidates and Jobs

**Parent spec:** `spec.md` in this feature folder (user stories 40–45; Implementation Decisions "Paste rules").

**What to build:** the owner copies an intro or a lower-third once and pastes it into every Candidate of the episode, and branding into other episodes.

- **Leaving and opening Advanced Edits.** The Clipboard survives leaving one Candidate's Advanced Edit and opening another's in the same tab, of the same Job or another.
- **Copying a Source Segment** also keeps the copying Candidate's Word Edits and Layout Overrides whose `at` lies inside its range.
- **Pasting into another Candidate of the same Job.**
  - The carried Word Edits are added, except where the target already has a Word Edit on the same Word (by the Job's Transcript).
  - The carried Layout Overrides are added, except where the target already has one inside that pasted range of the Source.
  - Everything is in the same one change as the paste.
- **Pasting into the same Candidate** carries nothing extra (ADR 0002).
- **Pasting into another Job.** Source Segments, and the Transitions that touch them, are skipped, with a notice. Media Segments, Text Layers, Music Clips and Overlays are pasted.

**Blocked by:** 08.

**Status:** done

- [x] Seam D:
  - [x] pasting into another Candidate of the same Job adds the range's Word Edits and Layout Overrides;
  - [x] the target's own Word Edits on the same Word, and its own Layout Overrides in the range, are kept;
  - [x] pasting into the same Candidate adds none;
  - [x] pasting into another Job skips Source Segments and their Transitions with a notice, and keeps the rest.
- [x] In the browser:
  - [ ] a Segment with a corrected caption Word, copied from Candidate A and pasted into Candidate B, shows the correction in B's preview (covered at Seam D; the test Candidates had no Word Edits, left for the walkthrough, 11);
  - [x] a Segment and its title copied from one Job paste into another Candidate of it, and into another Job (the Segment left out with a notice).
- [x] Typecheck, test, build.

## Comments

**2026-10-15: done.** Each copied Segment keeps how far into the group it starts, so when some are left out (another Job) the layers stay over the ones that are pasted. Pasted items are now kept inside the Clip at both ends: one that would start before it (it was before the first Segment pasted) starts at 0, a song or video going on from as far into it. Checked in the browser through the app's router, so the tab's memory stays: from Candidate #2 into #3 of the same Job, and into a Candidate of another Job; both were undone afterwards.
