# 01: Shared gain vectors

**Parent spec:** `spec.md` in this feature folder (Implementation Decisions "Speech and Ducking": the gain function; Testing Decisions "The gain function over a new shared fixture"); ADR 0016.

**What to build:** a prefactor. The planner's gain at a time (`gain_at`) and the preview's (`loudness.ts`) are pinned to each other by one shared fixture, instead of by the same worked examples written twice. Nothing changes for the owner: Clips plan, render and preview exactly as before. Ducking (10) and Segment fades (04) can then extend one function in both languages behind a guard that fails if they disagree.

- **The fixture** sits beside `ease_vectors.json` and `segment_times.json`. It holds cases of volume (constant or keyed with Eases), fades (including fades scaled down when longer than the sound) and a sound's span, with the expected gain at chosen times.
- **One pytest and one vitest** read it, so the two functions are checked against the same numbers.
- **The fixture format can grow:** later tickets add a duck (depth and speech spans with the ramp constants) to a case without rewriting the existing cases.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] A shared gain-vectors fixture covers: a constant volume; a keyed volume with Linear and eased spans; a fade in and out; fades longer than the sound, scaled down; a time before, at and after each edge.
- [ ] The backend's gain function and the preview's both pass every case of it.
- [ ] Each existing gain test that the fixture now covers is removed or reduced to a pointer, so no example is kept twice.
- [ ] The full backend suite, `npm run typecheck`, and the frontend tests pass.
