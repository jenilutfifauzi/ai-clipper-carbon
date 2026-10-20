# 03: Countdown and the editing lock

**Parent spec:** `spec.md` in this feature folder (Solution "Recording a Take", "Locked while recording"; Implementation Decisions "the take flow"); ADR 0018.

**What to build:** recording that is safe to start and hard to spoil.
- **Countdown.** Pressing the mic button or Shift+R starts a three-second countdown with the playhead still, and Esc cancels it, leaving nothing behind. The microphone opens at the start of the countdown, so the meter already moves. The picture rolls when it ends.
- **The lock.** From the countdown until the Take stops, hand edits are locked: the Timeline, the inspector and the editing shortcuts. Edits from another tab or from MCP still arrive (edit-sync), and the Take lands where it was recorded in Timeline time.
- **Leaving the page.** Leaving or closing the tab asks first, and cancels the Take.
- **At the Clip's end.** The mic button is off while the playhead is at the Clip's end, with a hint to move it into the Clip.

**Blocked by:** 02 (Record a Take).

**Status:** done

- [x] The countdown runs three seconds with the playhead still, then rolls (vitest, fake timers).
- [x] Esc during the countdown cancels it: the microphone closes and nothing is uploaded or added (vitest).
- [x] During the countdown and the recording, hand-edit actions and editing shortcuts are refused, and a remote edit still applies (vitest).
- [x] `beforeunload` asks while a Take is counting down or recording, and not otherwise (vitest).
- [x] The button is off, with its hint, while the playhead is at the Clip's end (vitest).
