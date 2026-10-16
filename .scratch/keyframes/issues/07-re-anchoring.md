# 07: Keyframes re-anchor on trim, split and ripple

**Parent spec:** `spec.md` (user stories 33–39; Solution "Trimming, splitting and rippling re-anchor the Keyframes"; Implementation Decisions "Editor actions"); docs/adr/0004-layers-ripple-with-the-main-track.md.

**What to build:** editing the Clip around keyed items keeps their motion on the same moments.
- Moving an item moves its Keyframes.
- **Trimming the start** moves them earlier, and adds a Keyframe at 0 with the value there when some were cut.
- **Trimming the end** adds a Keyframe at the end with the value there when some were cut.
- **Lengthening** changes nothing.
- **A split** gives each piece what the whole played.
- **A layer that follows a ripple** (Magnetic timeline, Ripple delete) is re-anchored the same way.
- **Copy, paste and duplicate** bring the Keyframes.
- **Merging** with another editor's change keeps both, item by item.

- **The pure re-anchor action**, given the old length and the kept window, as Concat's.
- **The trim, split and ripple actions** call it for Overlays and Music Clips, and for media Segments if 04 is in.
- **The Clipboard and duplicate** carry `keys` unchanged.
- **The client merge** treats `keys` as part of its item.

**Blocked by:** 01, 03

**Status:** done

- [x] Seam D:
  - [x] trimming 1 s off the start moves every Keyframe 1 s earlier and adds one at 0 with the value there;
  - [x] trimming the end adds one at the end, with the Ease of the first one removed (an eased one cut to the part kept: see Comments);
  - [x] a split's two pieces give the same values at the same Timeline times as the whole;
  - [x] lengthening changes nothing;
  - [x] an Overlay across a deleted Segment keeps its motion at the moments that remain (ripple);
  - [x] a locked Track's items still re-anchor when they ripple;
  - [x] a pasted item has its Keyframes.
- [x] Seam C: a remote change to one Overlay's Keyframes and a local change to another Overlay both survive; on one Overlay, the owner's wins.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass (but for `test_other_jobs_run_while_a_job_waits_for_quota`: see Comments).

## Comments

**2026-10-16: done.** Built test first in `frontend/src/pages/job/advanced/reanchoring.test.ts` (Seams D and C, 25 tests: the pure function, the Timeline and inspector trims, split, ripple, the clip editor's trim, paste, duplicate and the merge). Nothing in the backend changed: the server doesn't re-anchor (ADR 0004).

- **The pure re-anchor** is in `frontend/src/pages/job/editor/keyframes.ts`, appended after the sampler:
  - `rewindow(keys, from, to)`: one property's list for the item once it plays only from `from` to `to` seconds of itself as it was (Concat's `rewindow`, in seconds, not a fraction, so it needs no old length). A later end that removes none gives back the same list.
  - `rewindowKeys(keys, from, to)`: every property; the same object when none changes.
  - `rekeyed(item, from, to)`: any item with `keys` (an Overlay, a Music Clip, a media Segment once 04 gives it `keys`); an item without them, or whose Keyframes all stay, comes back as it is.
  - `easePart(ease, x0, x1)`: the part of an Ease between two shares of its span, as an Ease of its own (the cubic-bezier between those points, scaled to the unit square).
  - `bezierYAtX` now calls a private `parameterAt` (its two solving loops, moved out unchanged), which `easePart` uses too.
- **Callers.**
  - `split` (`advanced/actions.ts`) re-anchors each part of a Text Layer, Music Clip or Overlay, and of a Segment (a no-op until Segments have `keys`). A keyed Music Clip's halves no longer both carry the whole's `keys`.
  - `ripple` (`advanced/ripple.ts`) re-anchors every layer it cuts, over `[skipped, skipped + secs]`, so `remove` on the Magnetic timeline, Ripple delete, a Segment's trim by `dragSegment` and `clipTrimmed` (the clip editor's trim) all get it. A Segment put in cuts nothing: the layers after it move whole. Locks don't come into it: the ripple doesn't look at them.
  - `paste` (`advanced/clipboard.ts`) re-anchors an item it cuts short to fit in the Clip. The Clipboard and `duplicate` carry `keys` as they are (they copy the item whole).
  - **Trims by hand** go through `retimed(origin, next, edge)` and `retimer()` (`actions.ts`, with the type `TimedEdge`): the Timeline's drags of a Music Clip's or Overlay's edges (`Tracks.tsx`) and the inspector's "Comes on at" / "Stays for" sliders (`TimingFields.tsx`, so Text Layers too, where it does nothing). `retimer` remembers, per gesture group, the item as the gesture began, so each step of a drag is made from it: trimming in and back out within one drag brings the Keyframes back. An item changed since its last step (an undo, another editor: its `keys` aren't the ones the last step made) begins it again.
- **The client merge** needed no change: `keys` is a field of its Overlay or Music Clip, which merge item by item. The Seam C tests pin it.

Choices:
- **An eased span cut short keeps its curve.** The spec's rule (Concat's) gives the new end Keyframe "the Ease of the first one removed", which plays that whole Ease over the shorter span, so an eased piece doesn't play what the whole did (19 px off on the test's slide). The new end Keyframe instead gets `easePart` of that Ease, over the part the span kept, and so does the first kept Keyframe after a cut start. The two pieces of a split then match the whole to within 1e-3 px. A Linear span stays Linear, so a Linear removed Keyframe gives exactly the rule's Ease. A part that can't be an Ease (its y handles past −2..3, or no rise) keeps the rule's Ease. The cost: a split of an Ease in-out leaves two Custom Eases.
- **An added Keyframe within a frame of a kept one is left out** (the kept one stands for the edge), since the backend refuses two closer than a frame. In that frame the kept one's value holds.
- **A layer over a whole deleted Segment loses its last seconds, not its middle.** The ripple shortens it without skipping its video's offset, so its picture goes on without a jump. Its Keyframes follow its picture (the window `[0, secs]`), not the speech after the cut. A layer starting inside the cut loses its head (window `[skipped, …]`) and one ending inside it loses its tail, both as the rule says.
- **An earlier start keeps the Keyframes on the same moments.** Lengthening the start (a song's or video's start dragged back) moves every Keyframe later by as much. A later end changes nothing.
- **Re-anchored times are rounded to a microsecond**, not to the edits' hundredth, so that two Keyframes a frame apart stay a frame apart.

For 04 (media Segments): `rekeyed` takes a Segment as it is. `split` already calls it with the window in seconds from the Segment's `start` in its file (`[shown.source_start - start, cut - start]` and `[cut - start, end - start]`): check that this is the time base 04 gives a Segment's Keyframes. What is left is the Segment trims: `draggedSegments` (`MainTrack.tsx`) and the inspector's range fields, through `retimed` / `retimer`.

Tests: vitest 420 passed (25 of them new), typecheck and build clean; pytest 501 passed, 1 failed. The failure is `tests/test_resilience.py::test_other_jobs_run_while_a_job_waits_for_quota`: the Job meant to be waiting for quota is already in review. It fails again when run alone. This ticket doesn't touch the backend (no diff from main under `backend/`), so the failure comes from main or this machine, not from 07.

Not checked by hand: dragging a keyed item's edges on the Timeline in the browser and watching the preview. The drag's wiring was checked by typecheck and the `retimer` tests only. Ticket 11's walkthrough covers it ("a split and a trim of keyed items").
