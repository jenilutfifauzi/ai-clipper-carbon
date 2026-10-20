# 07: Audio effects on a phone

**Parent spec:** `../spec.md` ("Inspector UI").

**What to build:** on a phone, a picked sounding item's toolbar has an **Audio effects** button. It opens a bottom sheet with the same controls as the desktop section:
- the three Clean switches with their sliders;
- the stack rows, with intensity, More, on/off, move and remove;
- Add effect, with the grouped, searchable library;
- "Preparing effects…".

Touch targets and sliders follow the phone sheets already in the Advanced Edit. The sheet keeps the preview visible, as the other sheets do.

**Blocked by:** 04, 06.

**Status:** done

- [x] The button shows for a Segment with sound, a Music Clip and a video Overlay, and not for a Freeze frame or an image. (The phone's Edit sheet no longer repeats the section: it is this sheet's.)
- [x] All the desktop actions work from the sheet, each one step of undo.
- [x] Walkthrough on a phone viewport: switch on Enhance voice, add Radio, reorder, and remove. (Done in the app at 390×844 on a copy of a Job, driven by script: each tap one Undo step, More and the library popovers open over the preview, every control 44 px. Not tried on a real phone; a Music Clip and a video Overlay were checked in tests only.)
