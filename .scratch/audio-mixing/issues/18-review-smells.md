# 18: Tidy the smells the feature review found

**Parent spec:** `spec.md` in this feature folder. Source: the `/code-review` of `feat/audio-mixing` against main (2026-10-19), Standards axis. These are judgement calls, not breaches.

**What to build:** no change in behaviour. The audio-mixing code reads as one piece instead of fourteen tickets merged together.

- **Keyframe values × `source_volume`** is written four times in TS (`timelineView.ts` twice, `loudness.ts` twice) and three times in `renderer.py`. Use one helper per side.
- **Two types named `Heard`:**
  - in `timelineView.ts`: an item's sound, in seconds from the item's start;
  - in `loudness.ts`: an event, in Clip seconds.

  They hold different things. Give them different names.
- **Rounding helpers:** `toThousandth` (`actions.ts`), `round` (`edits.ts`), and `toMillionth` defined twice (`keyActions.ts`, `segmentTime.ts`). Share them.
- **"Does this item have sound?"** is decided separately in `itemSound`, `pickedSounds`, `canDetach` and the volume setter. Make it one predicate.
- **`scene` + `sounded`** travel together through `toggleMute`, `muter`, `pickedSounds`, `canDetach`, `detach` and `detacher`. Consider one type for them.
- **`muter` and `detacher`** mostly forward to the actions. Inline them, or keep them only if they earn their place.

**Blocked by:** 17.

**Status:** needs-triage

- [ ] Each point above is fixed, or noted here as kept with the reason.
- [ ] No behaviour changes: the full backend suite, vitest, typecheck and build pass unchanged.
