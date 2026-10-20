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

**Status:** ready-for-agent

- [ ] The section shows for a Segment, a Music Clip and a video Overlay. It doesn't show for a Freeze frame or an image Overlay.
- [ ] Vitest: add to a mixed Pick; move, toggle and remove by index; a setting change; the Mixed case and Remove all effects.
- [ ] The library groups and searches the catalogue, and is read from the server.
- [ ] Undo and redo step through each change.
- [ ] Walkthrough: add Telephone and Echo to a Segment, reorder them, switch one off, render, and hear it.
