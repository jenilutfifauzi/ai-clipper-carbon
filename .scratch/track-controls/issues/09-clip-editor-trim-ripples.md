# 09: The clip editor's trim ripples the layers

**Parent spec:** `spec.md` in this feature folder (user stories 47–48; Implementation Decisions "The clip editor's trim").

**What to build:** with the Magnetic timeline on, trimming an uncut Clip's start or end in the clip editor moves the Text Layers, Music Clips, Overlays and the hook as the Advanced Edit would.

- **The ripple, in Timeline time**, by the ripple rule of ticket 01 (a function of the actions module, called from the clip editor):
  - start from s to a later s′: a removal of [0, s′ − s);
  - start from s to an earlier s′: an insertion of s − s′ at 0;
  - end from e to an earlier e′: a removal of [e′ − s, e − s);
  - end to a later e′: an insertion at the old end, which moves nothing.
- **The save.** The trim's save carries the rippled Text Layers, Music Clips, Overlays and `hook_start`/`hook_secs` with the new range, in one save and one Revision. Layers deleted by the ripple are told in the editor's notice.
- **The Magnetic switch** shows on the clip editor's Timeline, with the same preference as the Advanced Edit's.
- With the switch off, the trim behaves as today.

**Blocked by:** 01.

**Status:** done

- [x] Seam D: start later, start earlier, end earlier and end later each give the expected layer times and hook.
- [ ] In the browser, trimming an uncut Clip's start 2 s later moves a Text Layer at 5 s to 3 s, in one Revision.
- [ ] Switching it off in the clip editor switches it off in the Advanced Edit.
- [x] `npm run typecheck`, `npm test`, `npm run build`.

## Comments

**2026-10-15: done.** Built as specified (a new range chosen from the transcript doesn't ripple, since it may be a different moment). The review found a hook in an end trimmed off moved past the new end; fixed in 02d6d0e. Not yet driven in the browser; left for the walkthrough (10).
