# 08: Fade Ramp

**Parent spec:** `spec.md` in this feature folder (user stories 35–41; Implementation Decisions "Seam D (the actions module) gains three edits", "Gestures").

**What to build:** every Music Clip draws its fade in and fade out as slopes at its ends. On a picked Music Clip, each slope has a handle at its top:
- the owner drags it to set that fade's length;
- a seconds label shows while dragging;
- the Waveform reshapes live;
- one drag is one step of undo.

Trimming a Music Clip shorter than its fades shortens them. Locked Tracks show the ramps, but the handles don't drag.

- **Seam D:**
  - set a Music Clip's fade in or fade out: each is clamped to 0–10 s, and the two together never exceed the Clip's length;
  - trimming a Music Clip clamps its fades by the same rule.
- **The gesture:** handles with hit areas of at least 24×24px, on picked Music Clips only. They work like the Volume Line's drag (ticket 07): one gesture group, one item.
- **Segments get no fades** (`audio-mixing`).

**Blocked by:** 07 (Volume Line).

**Status:** ready-for-agent

- [ ] Seam D (vitest):
  - a fade dragged past 10 s clamps to 10;
  - a fade in that would cross the fade out is cut to the remaining length;
  - trimming a Music Clip below the sum of its fades shortens them.
- [ ] In the browser:
  - drag both handles of a picked Music Clip, then undo each with one Cmd+Z;
  - the ramps and Waveform match the inspector's fades;
  - a locked Music Track's handles don't drag.
- [ ] `npm run typecheck`, `npm test` and `npm run build` pass.
