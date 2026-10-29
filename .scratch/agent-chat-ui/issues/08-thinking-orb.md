# 08: The thinking orb, in the status line and the Stop button

**Parent spec:** `spec.md` (Solution 1, revised).

**Status:** ready-for-agent

**Blocked by:** 07

**Why:** the owner likes open-design's spinning "globe", the `ThinkingOrb` in `<main>/docs/referensi/open-design-main/apps/web/src/components/composer/ThinkingOrb.tsx`. It is a dotted sphere on a canvas that turns, wobbles in tilt, and now and then twists bands of its dots in quarter turns like a Rubik's cube, then twists them back. Open-design vendors it from `thinking-orbs@0.3.1` (© Jakub Antalik, MIT), reduced to the `solving` state at 20px.

## Decisions (with the owner)
- It goes **in both places**:
  - it replaces the turning glyph in the status line (ticket 07);
  - it fills the round Stop button while a turn runs. Hovering or focusing the button swaps the orb for the Stop square, as open-design does.
- **It is drawn in ai-clipper's orange** (`--accent`), not open-design's green. Each dot's depth sets its opacity, so nearer dots are brighter.
- **It stays a canvas**, ported as it is: `requestAnimationFrame`, paused while the tab is hidden or the orb is off screen, and one still frame under reduced motion.
- The MIT licence is recorded in `THIRD_PARTY_NOTICES.md`.

## What to build (`frontend/src/pages/job/advanced/agent/`)
- **`orb.ts`, pure.** It holds the package's geometry, with the 20px preset resolved:
  - 4 latitude rings and 12 longitude dots;
  - dot radii × 1.9;
  - 14 moves of 0.42s, then a 1.2s rest;
  - speed 1.95.

  `orbFrame(size, t)` returns the dots `{x, y, z, r, ink}`, sorted far to near.
- **`ThinkingOrb.tsx`.** A canvas of `size` px (20 by default), with its backing store at `dpr` (capped at 2). It paints each dot in `--accent`, its opacity following its depth. It is `aria-hidden`.
- **`StatusLine.tsx`.** The orb at 14px replaces the glyph frames.
- **`Composer.tsx`.** While a turn runs, Stop holds the orb and the Square in one grid cell. The orb shows, and on hover or focus-visible the Square shows instead. Its label stays "Stop".

## Seams under test
1. `orbFrame`:
   - it is deterministic for a given `t`;
   - every dot lies inside the canvas;
   - the dots are sorted far to near;
   - the nearest dot is larger and brighter (lower ink) than the farthest.
2. Composer's markup while running: the Stop button (`aria-label="Stop"`) holds an `aria-hidden` canvas and the Square.
3. StatusLine's markup: an `aria-hidden` canvas, and none of the old glyph frames.

## Acceptance
- [ ] The tests at the three seams pass. Only `npx vitest run src/pages/job/advanced/agent` and `npx tsc --noEmit` are run.
- [ ] Checked in the browser on a live turn: the orb turns and twists, in orange, in both the status line and Stop, and hovering Stop shows the square.
