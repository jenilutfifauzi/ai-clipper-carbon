# 01: Shared gain vectors

**Parent spec:** `spec.md` in this feature folder (Implementation Decisions "Speech and Ducking": the gain function; Testing Decisions "The gain function over a new shared fixture"); ADR 0016.

**What to build:** a prefactor. The planner's gain at a time (`gain_at`) and the preview's (`loudness.ts`) are pinned to each other by one shared fixture, instead of by the same worked examples written twice. Nothing changes for the owner: Clips plan, render and preview exactly as before. Ducking (10) and Segment fades (04) can then extend one function in both languages behind a guard that fails if they disagree.

- **The fixture** sits beside `ease_vectors.json` and `segment_times.json`. It holds cases of volume (constant or keyed with Eases), fades (including fades scaled down when longer than the sound) and a sound's span, with the expected gain at chosen times.
- **One pytest and one vitest** read it, so the two functions are checked against the same numbers.
- **The fixture format can grow:** later tickets add a duck (depth and speech spans with the ramp constants) to a case without rewriting the existing cases.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] A shared gain-vectors fixture covers: a constant volume; a keyed volume with Linear and eased spans; a fade in and out; fades longer than the sound, scaled down; a time before, at and after each edge.
- [x] The backend's gain function and the preview's both pass every case of it.
- [x] Each existing gain test that the fixture now covers is removed or reduced to a pointer, so no example is kept twice.
- [x] The full backend suite, `npm run typecheck`, and the frontend tests pass.

## Comments

**2026-10-18: done.**

**What was built:**
- `backend/tests/fixtures/gain_vectors.json` holds six sounds:
  - a constant volume;
  - a fade in and out;
  - keyed, Linear then eased in-out;
  - keyed and faded;
  - fades twice as long as the sound, halved;
  - fades longer than the sound, shortened by the same share.

  Each is a `sound` (`start` and `end` in Clip seconds, `volume`, optional `keys` whose `ease` is `[x1, y1, x2, y2]` and Linear when absent, optional `fade_in`/`fade_out` as set) and `at` pairs of [Clip seconds, gain]. The times fall before, at and after the sound's edges and each fade's. The eased values are worked from `ease_vectors.json`'s numbers. A duck (10) can go into a `sound` as an optional field, with its ramp constants at the top, without touching the existing cases.
- `backend/tests/test_gain.py` fits each case's fades through `audio_events` (a Music Clip over its span) and checks `gain_at`. `frontend/src/pages/job/editor/loudness.test.ts` fits them through `fadesWithin` and checks `loudness`. So the fixture also pins the Timeline's copy of the fade fitting to the planner's.
- **The fixture caught one drift:** `loudness` wasn't silent before a sound's start or after its end, as `gain_at` is. It now is. `loudnessCurve` takes its last value at the sound's end (that sample may fall up to 10 ms past it), so the curve a gain node follows is the same as before. Nothing is heard differently: an element outside its span is paused by `follow`.
- Removed as duplicates, each left as a pointer: `gain_at`'s worked examples in `test_keyed_volume.py`; the fade-fitting examples in `test_music.py` (the cut at the Clip's end stays); `actions.test.ts`'s `fadesWithin` test. `loudness.test.ts` keeps only its curve test, plus the curve's last value. The docstrings of `gain_at`, `audio_events`, `fadesWithin` and `loudness` point at the fixture.

**Decided differently / left for later:**
- **No planner code changed** (only docstrings). The fitting stays inside `audio_events`, and the Python test reaches it through a Music Clip rather than a new `fades_within`. Segment fades (04) may want to pull it out, to share with `SegmentPlan`.
