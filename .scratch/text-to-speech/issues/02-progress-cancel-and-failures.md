# 02: Progress, cancel and failures

**Parent spec:** `spec.md` in this feature folder (User Stories 27–37; Implementation Decisions "The Narration runner" (reading, progress, cancel), "HTTP API", "Frontend"); ADR 0019.

**What to build:** a long Narration shows how far it has got, can be cancelled, survives a passing cloud blip, and never loses the owner's work.

- **Progress.** The events stream reports sentences done out of sentences, plus a stage: "Loading the voice", "Reading", "Levelling", "Saving". The tab shows it in place of Generate, with Cancel.
- **Cancel.** `DELETE /api/narrations/{id}` stops before the next sentence and discards everything, item and files.
- **Retry.** A cloud 429 or 5xx on one sentence is retried once after `Retry-After`, or a short fixed wait. Any other failure, or the retry failing, fails the Narration with the engine's message and leaves nothing.
- **The owner's work is kept.** After a failure or cancel, the script and settings stay in the tab. Busy (409) says another Narration is being made.
- **The start is fixed when Generate is pressed.** Editing goes on meanwhile, and moving the playhead doesn't move the landing. If the Music Track is locked when it is done, the tab says the Narration is in the Media tab instead. If the editor tab was closed, the item is still added, unlaid.
- **Generate is off** at the Clip's end and with an empty script.

**Blocked by:** 01.

**Status:** done

- [x] Seam A: the events stream reports progress per sentence and the stages, then `done`.
- [x] Seam A: cancel mid-way leaves no item and no stray file.
- [x] Seam A: a transient failure on one sentence is retried once and succeeds; a second failure, or a non-transient one, fails with the engine's message and leaves no item.
- [x] Seam A: a Narration whose stream nobody reads still adds its item.
- [x] Gemini adapter: 429 with `Retry-After` and 5xx map to the transient error.
- [x] Vitest: progress and Cancel replace Generate while running; failure, busy and cancel keep the script.
- [x] Vitest: the start is fixed at Generate; moving the playhead meanwhile doesn't change it.
- [x] Vitest: a locked Music Track shows the "in the Media tab" message and lays nothing.
- [x] Vitest: Generate is off at the Clip's end and with an empty script.
