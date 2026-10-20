# 05: When recording fails

**Parent spec:** `spec.md` in this feature folder (Solution "When something fails"; Implementation Decisions "the take flow"); ADR 0018.

**What to build:** a Take is never lost silently, and a broken microphone is explained.
- **No microphone.** When the microphone is refused, missing or busy, the owner is told which it is and how to fix it (for example, allow the microphone in the browser's site settings). Nothing is added.
- **A failed upload or normalization.** The Take stays in the tab, and a notice offers "Try again" (uploads it again and lands it where it was recorded) and "Save WAV" (downloads the Take). While a Take is waiting, closing the tab warns first.

**Blocked by:** 02 (Record a Take).

**Status:** done

- [x] Refused (`NotAllowedError`), missing (`NotFoundError`) and busy (`NotReadableError`) inputs each show their own message and add nothing (vitest).
- [x] A failed upload keeps the Take and offers Try again and Save WAV; Try again lands it at its recorded landing; Save WAV downloads a WAV of it (vitest, fake upload).
- [x] `beforeunload` asks while a failed Take is waiting, and not after it has landed or been dismissed (vitest).
