# 03: Trimming, inserting, duplicating and pasting Segments ripple the layers

**Parent spec:** `spec.md` in this feature folder (user stories 32–34, 40–41, 43, 45–46; Implementation Decisions "Actions that ripple").

**What to build:** with the Magnetic timeline on, every edit that makes the Main Track shorter or longer at one point moves the layers with it, as one undo step.

- **Trim a Segment's edge.**
  - Shorter is a removal at the trimmed edge. Longer is an insertion there.
  - Each is measured from the played Main Track before and after.
  - Computed from the drag's origin, so the layers move live while dragging, and one undo takes back the whole drag.
- **Insert a Segment** (a drop, "add to clip"): an insertion of its played length at its played start.
- **Duplicate picked Segments:** an insertion of the block's played length after the last picked Segment.
- **Paste with Segments:**
  - The existing layers after the join move back by the pasted Segments' played length.
  - Then the pasted layers are placed by the paste rules, and are not moved again.
  - The multi-select spec's rule "layer items after an inserted Segment don't move" now holds only while the switch is off.
- **No ripple:** reordering Segments, and adding or changing a Transition.
- With the switch off, every one of these behaves as today.

**Blocked by:** 01, 02.

**Status:** done

- [x] Seam D, magnetic on:
  - [x] trimming an edge shorter moves the later layers up, and longer moves them back;
  - [x] a trim drag's steps from one origin give the same layers as one step;
  - [x] an insert and a duplicate of Segments move the later layers back, and leave layers across the point as they are;
  - [x] a paste with Segments moves the existing later layers back and leaves the pasted layers at their paste offsets;
  - [x] a reorder moves no layer.
- [x] Seam D: magnetic off, each of these leaves the layers as they are.
- [x] In the browser, dragging a Segment's edge moves a later Text Layer live, and one undo puts both back.
- [x] `npm run typecheck`, `npm test`, `npm run build`.

## Comments

**2026-10-15: done.** Built as specified. In the browser, dragging Segment 1's end 2 s in moved a later Text Layer live (20.1 → 19.3 → 18.2 s), and one undo put both back. The review found duplicate placing layer copies before their moved originals; fixed in 02d6d0e.
