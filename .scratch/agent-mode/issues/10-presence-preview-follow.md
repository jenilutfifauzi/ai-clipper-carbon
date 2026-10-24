# 10: Agent Presence in the Preview, Follow agent, reduced motion

**Parent spec:** `spec.md` (Solution "Agent Presence").

**What to build:** layers the agent changes are outlined on the stage, the Timeline follows the agent, and reduced motion is respected.

- **Preview outlines.** `StageEdit.tsx` (or the stage overlay layer it draws handles in) draws an outline around each flashing Text Layer, Shape and Overlay. It uses the same bounds it uses for selection handles and the same flash timing. It doesn't select them.
- **Follow agent.**
  - A toggle in the Agent tab header, on by default and remembered in localStorage (try/catch, versioned key).
  - When the presence `target` changes and Follow is on:
    - scroll the Timeline so the target is in view, using the timeline view's own scroll API (`timelineView.ts`)
    - seek the playhead to the target's start when the playhead is outside the visible range
  - A manual scroll or zoom on the Timeline turns Follow off for the current turn (passive listeners).
- **Reduced motion.**
  - Under `@media (prefers-reduced-motion: reduce)`, pulse and flash become a static outline for their duration.
  - The cursor moves with no transition.
  - Following scrolls without smooth behaviour.

**Blocked by:** 09

**Status:** done

- [x] A pure `followStep(view, target, playhead)` returns the scroll and seek to apply (or none) and is tested for in-view, out-of-view, and Follow-off.
- [x] The stage outline list for flashing ids is a pure function, tested.
- [x] Only the new test files are run.
