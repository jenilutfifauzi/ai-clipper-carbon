# 07: Audio effects on a phone

**Parent spec:** `../spec.md` ("Inspector UI").

**What to build:** on a phone, a picked sounding item's toolbar has an **Audio effects** button. It opens a bottom sheet with the same controls as the desktop section:
- the three Clean switches with their sliders;
- the stack rows, with intensity, More, on/off, move and remove;
- Add effect, with the grouped, searchable library;
- "Preparing effects…".

Touch targets and sliders follow the phone sheets already in the Advanced Edit. The sheet keeps the preview visible, as the other sheets do.

**Blocked by:** 04, 06.

**Status:** ready-for-agent

- [ ] The button shows for a Segment with sound, a Music Clip and a video Overlay, and not for a Freeze frame or an image.
- [ ] All the desktop actions work from the sheet, each one step of undo.
- [ ] Walkthrough on a phone viewport: switch on Enhance voice, add Radio, reorder, and remove.
