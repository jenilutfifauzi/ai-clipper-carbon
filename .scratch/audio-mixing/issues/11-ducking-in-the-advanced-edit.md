# 11: Ducking in the Advanced Edit

**Parent spec:** `spec.md` in this feature folder (user stories 39–41, 48, 58; Solution "Ducking"; Implementation Decisions "Timeline", "Inspector"); GLOSSARY "Ducking", "Volume Line".

**What to build:** on the desktop, the owner switches a Music Clip's "Duck under speech" on or off, sets its depth, and sees where and how far the music is ducked on the Timeline. Music Clips the owner adds duck at −12 dB. (The phone comes in 14.)

- **Inspector.** On a Music Clip of a song or a video's sound: "Duck under speech" and its depth (−1 to −30 dB). Hidden for a Music Clip of the Source.
- **New Music Clips** made by the editor (from the assets, a drop) have `duck` −12. Pastes keep what was copied.
- **Timeline.**
  - Under a ducked Music Clip's Volume Line, the ducked stretches (ramps included) are shaded from the plan.
  - Its Waveform is drawn at the full gain, duck included.
  - The Volume Line itself stays at the volume that is dragged.

**Blocked by:** 10.

**Status:** done

- [x] Adding a song from the assets gives a Music Clip with Duck under speech on at −12 dB.
- [x] Switching it off and on, and changing the depth, are each one undo step, and the preview's sound follows.
- [x] A ducked Music Clip shows shaded stretches where the plan ducks it, and its Waveform dips there.
- [x] A Music Clip of the Source shows no duck control.
- [x] `npm run typecheck && npm run build` pass.

## Comments

**2026-10-19: done.** Built test first in `frontend/src/pages/job/advanced/ducking.test.ts` (9): the new clip's default, `setDuck`, and the Timeline maths.

**What was built:**
- **New Music Clips** (`Music.tsx`' `newMusicClip`, which the asset panel's add and a drop on the Music Track both use) carry `duck: DEFAULT_DUCK` (−12), said explicitly, so the server's default isn't relied on. `DEFAULT_DUCK`, `DUCK_MIN` (−30) and `DUCK_MAX` (−1) are in `edits.ts`.
- **Action** (`actions.ts`). `setDuck(scene, id, duck)`: off with null, else a whole number of dB within −30..−1; null (no change) for a Music Clip of the Source or one that isn't there.
- **Inspector** (`Music.tsx`' `DuckFields`, under the fades in "Sound"). The shared `Switch` "Duck under speech", on at −12, and while on a "Depth" `Slider` (−30 to −1 dB). Both are hidden for a Music Clip of the Source. Each turn of the switch is one undo step (no history group); the depth is one group (`music:<id>:duck`), so a slide or a run of arrow keys is one step. `Inspector` wires `onDuck` through `setDuck`.
- **Timeline** (`timelineView.ts`, `Tracks.tsx`).
  - `Heard` gains an optional `duck` (`Duck`: depth, speech in seconds into the item, the plan's `ducking`). `gainAt` multiplies loudness.ts' `duckAt`, so the Waveform is drawn at the full gain, duck included.
  - `musicDuck(clip, event, ducking)`: the draft's depth (so a change shows at once) and the plan's `speech` for that clip (Clip seconds, made seconds into it). None when it is switched off, of the Source, or not planned yet.
  - `duckedStretches(heard)`: each span with its lead and release, joined where they meet and cut to the clip, as the dry run's `ducked`.
  - `underVolumeLine(heard, stretch)`: the line's points over a stretch, flat at the volume, or along its Keyframes through its fades. The duck is never included.
  - `DuckedShade` shades those stretches from the bottom up to the Volume Line, in the line's colour at low alpha. The Volume Line itself is passed the unducked `heard`, so it stays at the volume dragged. A Muted clip shows neither.
- **Preview:** no change. `PreviewMusic` already follows the plan's duck (10), and the draft is replanned on each change.

**Decided differently / worth knowing:**
- **Pastes, duplicates and splits** needed no change. The API returns every field, so a loaded Music Clip carries `duck` (null when stored unducked), and copies keep it.
- **Switching on again** gives −12, not the last depth: off is `duck: null` and keeps no depth.
- **Checked in a browser** (ego-browser, desktop; a copy of a review Job in a scratch data dir, the backend on its own port, the built frontend):
  - A song added from the Audio tab saved with `duck: -12`. The inspector showed "Duck under speech" on, at −12 dB. The Music lane was shaded under its Volume Line, and its Waveform was visibly lower than with the duck off.
  - Switching off removed the shading. Undo brought it back, Redo took it away again (one step each).
  - Six arrow presses on Depth saved −18, and one Undo went back to −12.
  - Not checked by hand: a Music Clip of the Source showing no control (a plain `!episode` condition), and listening to the preview's dip (that rests on 10's `PreviewMusic`).
