# 17: Fix what the feature review found

**Parent spec:** `spec.md` in this feature folder. Source: the `/code-review` of `feat/audio-mixing` against main (2026-10-19); ADR 0001, ADR 0016, GLOSSARY "Detach", "Track".

**What to build:** the audio-mixing code keeps one source of truth for each rule (ADR 0001), and two bugs the review found are fixed. Built test first.

- **The ducked stretches are computed twice and have drifted.** The Timeline's `duckedStretches` (`timelineView.ts`) joins overlapping stretches and rounds to 1e-6; the dry run's `_ducked` (`mcp_server.py`) doesn't join and rounds to 0.01. The planner computes them once and puts them in the plan; the dry run and the Timeline read them, and the frontend copy goes.
- **`gain_vectors.json` doesn't cover three things both sides compute:** `source_volume` (a Music Clip of the Source and a keyed Source Segment), a Transition's crossfade, and the Timeline's `tail`. Add cases; the pytest and vitest readers check them.
- **The frontend has a second gain function.** `gainAt` (`timelineView.ts`) repeats volume or Keyframes × fades × duck beside `loudness()` (`loudness.ts`). One is the single source, so only one is pinned by the fixture.
- **Bug: Track mute leaks into a Detached sound.** Muting the Video Track silences Music Clips of the Source on the Music Track, because `heardDraft` zeroes `source_volume`. The Video Track mutes Segments only; the Music Track mutes every Music Clip, the Source's included. Track mute never writes `muted` and never changes the duck.
- **Possible bug: Detach of a reversed Segment.** `detach` sets `offset` to its range's start, and a Music Clip in Reverse reads `offset` as `overlay_time` says. A real render proves the Detached sound reads exactly the same range; fixed if not.
- **Detach with a stale plan.** `AdvancedEdit.tsx` passes the planned Main Track only while the plan's Segment count equals the edits'. Otherwise it falls back to `playedFrom(edits.segments)`, without Transition overlaps, so a Detach misses the overlap.
- **Glossary copy.** UI copy says "the episode's sound"; GLOSSARY and ADR 0016 say "the Source's sound". Align it, unless the UI says "episode" elsewhere for owners.
- **Spec gap.** The spec says `AudioEvent` carries `detached_from` (for the editor). Add it if cheap and useful; otherwise say why not.

**Blocked by:** 01–14.

**Status:** done

- [x] The planner computes the ducked stretches once; the dry run and the Timeline read them from the plan, and the frontend copy is deleted.
- [x] `gain_vectors.json` has `source_volume`, crossfade and `tail` cases, checked by pytest and vitest.
- [x] The frontend has one gain function, pinned by the fixture.
- [x] Muting the Video Track leaves a Music Clip of the Source heard; muting the Music Track silences it. Neither writes `muted` or changes the duck. (Fixed by 15; finished here for the Main Track the preview plays from the edits.)
- [x] A real render shows a reversed Segment's Detached sound reads the same range.
- [x] Detach with a stale plan covers a Transition's overlap, or isn't offered.
- [x] The UI copy for the Source's sound is settled, as aligned or kept with the reason.
- [x] `AudioEvent.detached_from` is added, or noted why not.
- [x] The feature's backend tests, `npm run typecheck`, vitest and `npm run build` pass; the MCP tool list stays within 69 000 bytes.

## Comments

**2026-10-19: done.** Built test first.

**What was built:**
- **Ducked stretches, once (1).** `ducking.ducked_stretches(spans, start, end, tuning)`: each span with its lead and release, cut to the sound, joined where they meet, rounded to 1e-6. The planner puts them on each ducked `AudioEvent` as `ducked` (beside `speech`); `item_sound` clears them with the duck. The dry run's `ducked` is the plan's, rounded to 0.01 as every time it shows. The Timeline's `duckedStretches` is deleted: `musicDuck` carries the plan's stretches (`Duck.stretches`, seconds into the clip) and `DuckedShade` draws them.
- **The fixture's new cases (2).** `gain_vectors.json` gains four, and its `about` says how to read `source`, `source_volume`, `tail` and `crossfade`:
  - a Music Clip of the Source, keyed and faded, under `source_volume`;
  - a Source Segment, keyed and faded, under `source_volume`;
  - a Segment faded out to its end under the Transition into the next (`tail`);
  - the same, taken away by the Transition's crossfade.

  Python: `gain_at` takes `source_volume` and `crossfade` (a `TransitionEvent`, as acrossfade's straight lines). The Clip's own volume goes through one new `own_volume(event, source_volume)`, which the renderer now uses too (its three spots), so the fixture pins the render's rule. `test_gain.py` plans the Segment cases with a following Segment and a Transition, and takes the crossfade from the plan. The frontend reads each case through `loudness` (`segmentSound`, `eventSound`), and through the Timeline (`segmentHeard`, `sourceHeard`, `underSourceVolume` and `gainAt`). Muted and crossfade cases are skipped on the Timeline, which draws neither.
- **One gain function in the frontend (3).** `timelineView`'s `gainAt` is now an adapter: the item as a sound from 0 to `secs + tail`, through `loudness`. Only `loudness` is pinned by the fixture.
- **Track mute (4).** Ticket 15 fixed `heardDraft` first: it silences each Segment (volume 0, volume Keyframes dropped) and keeps `source_volume`, so a Detached sound of the Source stays heard. That was kept. But the preview's Source decks follow `playback.segments`, which come from the edits (not the heard draft) for a lone Segment or a plan not yet caught up. Since `source_volume` no longer silences them, they were heard under a muted Video Track. New `heardTrack` (`trackState.ts`) silences those too; `AdvancedEdit` sets the playback's Segments through it. Test in `trackState.test.ts`.
- **Detach of a reversed Segment (5): no bug.** A Music Clip in Reverse reads `secs × speed` from `offset` and plays it backwards (`overlay_time`), so `offset` is its range's start, as `detach` sets it. `test_detach.py` renders a reversed Source Segment, then its Detached sound: the sweep's pitch is the same at three moments (within 1 dB). With the offset 0.4 s off, the test fails.
- **Detach with a stale plan (6).** `playedFrom(segments, transitions)` now overlaps the next Segment by each Transition's `transitionOverlap`, as the planner does. `AdvancedEdit`'s fallback Main Track passes `edits.transitions`. Test in `detach.test.ts`: the drafted track equals the planned one, and a Detach from it covers the overlap.
- **`detached_from` on `AudioEvent` (8).** Added. It costs one field, and the dry run lists it on a Detached sound, so the agent can find what to Reattach without reading the edits. The editor reads it from the draft's Music Clip, as before.

**Kept, with the reason:**
- **"The episode's sound" (7).** The UI says "episode" to the owner everywhere for the Source: "Episode" on the new Job form, "Add from the episode", "The episode's sound, in every Segment" by the Clip's own volume slider, the Clipboard's notices. So `Music.tsx` and `itemSound.ts` are consistent with the UI, and the copy is kept. "Source" stays the code's and the docs' word.
- **The MCP instructions** don't mention `detached_from` in the dry run: the tool list stays as it was, within 69 000 bytes.

**Tests:** backend `test_gain.py` (21, 4 new cases), `test_ducking.py` (+1, and the plan's `ducked`), `test_detach.py` (+1 render, dry run lists `detached_from`). Frontend `loudness.test.ts` (each case also on the Timeline), `ducking.test.ts`, `trackState.test.ts` (+1), `detach.test.ts` (+1).
