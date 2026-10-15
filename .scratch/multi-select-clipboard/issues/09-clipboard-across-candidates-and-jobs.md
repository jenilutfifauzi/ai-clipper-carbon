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

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] pasting into another Candidate of the same Job adds the range's Word Edits and Layout Overrides;
  - [ ] the target's own Word Edits on the same Word, and its own Layout Overrides in the range, are kept;
  - [ ] pasting into the same Candidate adds none;
  - [ ] pasting into another Job skips Source Segments and their Transitions with a notice, and keeps the rest.
- [ ] In the browser:
  - [ ] a Segment with a corrected caption Word, copied from Candidate A and pasted into Candidate B, shows the correction in B's preview;
  - [ ] a Text Layer copied from one Job pastes into another.
- [ ] Typecheck, test, build.
