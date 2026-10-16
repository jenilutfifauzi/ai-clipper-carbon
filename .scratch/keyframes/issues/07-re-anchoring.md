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

**Status:** ready-for-agent

- [ ] Seam D:
  - [ ] trimming 1 s off the start moves every Keyframe 1 s earlier and adds one at 0 with the value there;
  - [ ] trimming the end adds one at the end, with the Ease of the first one removed;
  - [ ] a split's two pieces give the same values at the same Timeline times as the whole;
  - [ ] lengthening changes nothing;
  - [ ] an Overlay across a deleted Segment keeps its motion at the moments that remain (ripple);
  - [ ] a locked Track's items still re-anchor when they ripple;
  - [ ] a pasted item has its Keyframes.
- [ ] Seam C: a remote change to one Overlay's Keyframes and a local change to another Overlay both survive; on one Overlay, the owner's wins.
- [ ] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.
