# 18: Glass polish, themes, responsive, README

**Parent spec:** `spec.md` in this feature folder (Milestone M6; user stories 68–70; Design system).

**What to build:** The full Apple-style glass design system across every page. That means:
- glass surfaces with orange background blobs;
- spring transitions that respect reduced motion;
- a light/dark toggle;
- layouts that work at phone width.

Plus a README covering setup, daily use, the Reference Set and eval workflow, and troubleshooting.

**Blocked by:** 11 (Review UI), 16 (Hook overlay), 17 (Upload master file).

**Status:** ready-for-agent

- [ ] Token values match the spec for both dark (default) and light themes. The theme choice is remembered per viewer.
- [ ] These components are styled to the glass system: glass panel, buttons (orange primary, glass secondary), segmented control, slider, toggle, score ring, stage progress, disk meter, Candidate row, Transcript Picker, and Clip card.
- [ ] No horizontal scroll at 375 px width. Review and Clip cards are usable on a phone.
- [ ] `prefers-reduced-motion` disables the spring and blob motion.
- [ ] Browser screenshots in dark, light, and phone width are attached to the ticket's comments.
- [ ] The README covers:
  - prerequisites and setup;
  - running the app;
  - the Reference Set and `eval` workflow;
  - updating yt-dlp when YouTube breaks;
  - memory tips for 8 GB machines.
