# 03: Intro, outro and the Main Slot

**Parent spec:** `../spec.md` (Model: intro and outro, hook; Capture; Apply steps 2 and 3; Anchor's four boundaries). See also GLOSSARY (Main Slot, Anchor) and ADR 0023.

**What to build:** a Template carries a branded intro and outro. Applying it wraps each Candidate's own Segments with them, and everything on the Timeline follows.

- **Capture:**
  - The media Segments before the first Source Segment are the intro, and those after the last are the outro.
  - Media Segments in between are left out, with a notice.
  - A Candidate with no Source Segment is refused (422 over HTTP).
  - Capture keeps:
    - the Transitions at and inside the intro's and outro's joins;
    - the Word Edits and Cue Edits keyed on those media items;
    - the hook's distance from the Main Slot's start, and its length.
- **Anchors** now use four boundaries: the Clip's start, the Main Slot's start, the Main Slot's end and the Clip's end. A layer wholly inside the intro or the outro hangs from that part's boundaries. Boundaries are measured with the Transitions' overlaps.
- **Apply:**
  1. Removes the Template's previous intro and outro Segments, their Transitions and their media Word Edits and Cue Edits. These are all marked.
  2. Puts in the new intro before the Candidate's first Segment and the outro after its last, with the Template's Transitions at those joins. The Join Transition doesn't apply there, and the joins inside the Main Slot are untouched.
  3. Makes the Segment explicit for a Candidate with one implicit Segment, first.
  4. Moves hand-made layers and the hook by however much the Main Slot's start moved, whatever the Magnetic switch says.
  5. Puts the hook at the Template's distance from the Main Slot's start, with the Template's length.
- **"No Template"** removes the intro and outro, and pulls hand-made layers and the hook back.
- **The Template's summary** gives its intro and outro lengths, for `list_presets` and the cards in 06.

**Blocked by:** 02.

**Status:** ready-for-agent

- [ ] Pure tests:
  - The intro and outro are split off on capture, a middle media Segment gets a notice, and a Candidate without Source is refused.
  - A 3 s intro moves the hook and a hand-made Text Layer by 3 s.
  - A music bed from the intro's start to the outro's end covers the whole Clip on a 20 s and a 75 s Candidate.
  - Reapplying with a 5 s intro replaces the 3 s one and moves hand-made layers by 2 s more.
  - The Transitions and the media Word Edits travel.
  - An implicit single-Segment Candidate becomes explicit.
- [ ] HTTP: saving a Candidate with no Source Segment gives 422. `list_presets` shows the intro and outro lengths.
