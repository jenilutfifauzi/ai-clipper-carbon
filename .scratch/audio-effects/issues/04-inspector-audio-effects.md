# 04: The Inspector's Audio Effects section

**Parent spec:** `../spec.md` ("Inspector UI", "Editor actions").

**What to build:** on a desktop, the Inspector of a picked Segment (one with sound), Music Clip or video Overlay has an **Audio effects** section under its volume and fades.

**The stack:** one row per effect, with:
- its name;
- its intensity slider;
- a "More" popover for its other settings;
- an on/off switch;
- move up and move down;
- remove.

**Add effect:** opens a library popover with the catalogue's Voice, Tone and Space groups and a search. One click appends the effect to the bottom of the stack with its defaults. The Clean effects are not listed; they become switches in 06.

**Behaviour:**
- Every change is one step of undo. A slider drag is one step.
- With several sounding items picked, Add effect appends to each, skipping items with no sound.
- The stack rows show only when the stacks are equal. Otherwise the section says "Mixed" and offers "Remove all effects".
- While any picked item's Effected copy is being made, the section shows "Preparing effects…". That hint is wired once 03 is in.

**Blocked by:** 01.

**Status:** done

- [x] The section shows for a Segment, a Music Clip and a video Overlay. It doesn't show for a Freeze frame or an image Overlay. (Seen in the app for all but the image Overlay: the Media Library had no image. That case is covered by vitest, and OverlayFields only gives a video the section.)
- [x] Vitest: add to a mixed Pick; move, toggle and remove by index; a setting change; the Mixed case and Remove all effects.
- [x] The library groups and searches the catalogue, and is read from the server.
- [x] Undo and redo step through each change.
- [x] Walkthrough: add Telephone and Echo to a Segment, reorder them, switch one off, render, and hear it. (Done in the app on a copy of a Job; the render was measured, not listened to: under 200 Hz it is 17 dB below the source, and 1–2 kHz is level.)
