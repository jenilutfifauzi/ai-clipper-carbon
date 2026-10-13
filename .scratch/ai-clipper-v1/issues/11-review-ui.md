# 11: Review UI

**Parent spec:** `spec.md` in this feature folder (Milestone M3; user stories 22–24, 30–40; Review operations and HTTP API).

**What to build:** On a Job in `review`:
- I see the ranked Candidates with their scores and reasoning.
- I preview any Candidate instantly from the Source video.
- In the Transcript Picker I click words to set a Candidate's start or end, which snap to word boundaries. I select a transcript range to add a manual Candidate.
- I edit the hook text, choose a layout override (Auto, Track, Split, or Blur), copy the platform descriptions, and select Candidates for rendering.

Every edit is saved immediately and survives a page reload.

**Blocked by:** 10 (Home & live progress UI).

**Status:** done

- [x] The API updates a Candidate's start and end (re-snapped to Words), hook text, layout override, and selected flag.
- [x] The API adds a manual Candidate from a transcript range. It is snapped, marked "manual", has no AI score, and appears in the list.
- [x] Media is served with HTTP range support. The preview starts at the Candidate's start and stops at its end.
- [x] The Transcript Picker shows the words around the Candidate with the current bounds highlighted. Clicking a word sets start or end.
- [ ] Copy buttons work for the title and the TikTok, Instagram, and Shorts descriptions.
- [x] After a reload, every edit is still there.
- [x] Seam A tests cover:
  - an update re-snaps to Words;
  - a manual Candidate is added and listed;
  - a range request returns partial content.
- [x] Browser check: adjust bounds, add a manual clip, edit the hook, set an override, and select Candidates.

## Comments

**2026-10-13 (from ticket 05).** `make eval` and `make reanalyze` re-run selection on an existing Job and replace its Candidates. Once review edits exist, re-running selection must not silently throw away the owner's edits or manual Candidates. Either keep edited and manual Candidates, or make the eval analyze into a separate run that leaves the Job's review state alone.

**2026-10-14: implemented, not committed (awaiting owner review).** `make test`: 170 passed (21 new in `test_review.py`, one expected-shape update in `test_selection.py`). `npm run build` and `npm run typecheck` pass. Browser check done on Job `1d5d363bec2e` (below). The copy box is left open: the buttons render and are wired, but the browser session was taken over before the click was checked.

Built:
- `backend/app/review.py`: `update`, `add_manual`, `keep_reviewed`, `ranked`, `Episode.bounds` (validation), `CandidateChange`, `InvalidEdit`, `CandidateNotFound`, `MAX_CLIP_SECS`.
- `backend/app/selection.py`: `snap()`, the public snapping entry for the owner's ranges. It reuses `_Cutter.edges` (lead-in, tail, never into a neighbouring Word, within the Source), so there is no second copy of the cutting rules.
- `backend/app/candidates.py`: `Origin` (`ai`|`manual`), `Layout` (`auto`|`track`|`split`|`blur`), the new fields `origin`, `layout`, `selected`, `edited` (all defaulted, so old `candidates.json` files still load), the `reviewed` property and `manual_candidate()`. `predicted_score`, `hook_strength` and `window_id` can be null (manual).
- `backend/app/jobs.py`: `JobStore.change_candidates(job_id, change, expect=)`. `api.py`: the routes below and `media`. `pipeline.py`: re-analysis keeps reviewed work. `cli.py`/`Makefile`: reanalyze help text, and "manual" in the printout.
- Frontend: `pages/job/Review.tsx`, `CandidateList.tsx` (rewritten), `CandidateEditor.tsx`, `PreviewPlayer.tsx`, `TranscriptPicker.tsx`, `HookEditor.tsx`; `components/Switch.tsx`, `Segmented.tsx`, `CopyButton.tsx`; `api.ts` (types and calls, `mediaUrl`); `format.ts` (`formatPrecise`); `App.tsx` (the Job page is `max-w-6xl`).

**API.**
- `PATCH /api/jobs/{id}/candidates/{cid}`, body `{start?, end?, hook_text?, layout?, selected?}` (unknown fields 422). It returns the saved Candidate.
  - `start`/`end` are snapped by `selection.snap`: the range covers every Word that ends after `start` and starts before `end`, then gets the usual lead-in/tail. So a Word's start plus another Word's end means exactly those Words, and an edge sent back unchanged stays put. Nearest-Word snapping wasn't used here: a short neighbouring Word could steal an unchanged edge. The label rule, sentence completion and duration fitting (all for LLM times) aren't applied either, since the owner picked the Words.
  - `hook_text` has its whitespace collapsed, as Selection does (max 200 characters).
  - Changing bounds, hook or layout sets `edited: true`. `selected` alone doesn't.
- `POST /api/jobs/{id}/candidates`, body `{start, end}` → 201 with the new Candidate: `origin: "manual"`, null scores, empty copy, `layout: "auto"`, not selected. It goes after the AI's (the order is AI by predicted score, then manual in the order added). It may overlap others.
- **Validation (422, plain-string `detail`):** the range must fit `0 ≤ start < end ≤ Source duration`, must cover at least one Word, and must last at most `max(180 s, Job max_secs)` (`MAX_CLIP_SECS`; Shorts and Reels cap at 3 min). Plus FiniteFloat, the layout enum, and the hook length. **The Job's min/max range is warned about in the UI, not blocked.** 404 for an unknown Job or Candidate. 409 unless the Job is in `review` (`api.EDITABLE`).
- Every change goes through `change_candidates`, under the store's lock. It saves `candidates.json`, moves `job.updated_at` and notifies `watch()` listeners like any Job change. (The SSE payload is progress only, so nothing new is sent to a client.)
- `GET /media/{job_id}/{path}`: Starlette's `FileResponse` (200 with `Accept-Ranges`, 206 with `Content-Range` for `Range`). It serves only files that resolve inside the Job's directory and have the suffixes `.mp4 .m4a .jpg .png`. Anything else is 404, including `..%2F`, absolute paths, `job.json` and a bad Job id. It is registered before the SPA catch-all.

**Protecting review work on re-analysis** (`make reanalyze`, `make eval` reusing a Job, any re-run of analyzing). At the end of the stage, `keep_reviewed(previous, fresh, transcript)` runs under the store lock:
- every previous Candidate that is manual, edited or selected is kept unchanged (same id);
- untouched AI Candidates are replaced by the new run's;
- a new Candidate that shares a Word with a kept one is left out (sharing only silence is fine).
The pipeline logs "kept N reviewed ones". The eval is unaffected: it reads `selection.json`, which still holds the run's own Candidates. Edits are refused (409) while analyzing runs. An edit landing in the instant before a CLI run flips the status is still merged, because the merge re-reads `candidates.json` at the end.

**UI.**
- The list has score, title, range and length, emotion, hook strength, an edited mark, a hand icon for manual clips, and a select checkbox. The editor has:
  - the preview (`/media/…/source.mp4`, `preload=metadata`). "Play clip" plays from the start and stops at the end, checked every frame with rAF; "Play ending" plays the last 3 s. Playback started inside the clip stops at its end; outside it, it plays freely;
  - the Transcript Picker, with a "Clicking a word sets: Start | End | New clip" segmented control and a hint per mode. In New clip mode you click the first and last Word; dragging across Words works in any mode. A dashed bar shows the range and its length, with Add/Cancel;
  - the hook editor (saves 700 ms after typing stops and on blur; counter `n/40` with a warning past 40);
  - the layout segmented control with a hint per layout;
  - a "Render this clip" switch;
  - Why this clip (reason, retention, emotion, hook strength, Window score);
  - copy buttons for the title and for TikTok/Instagram/Shorts (description + blank line + hashtags), falling back to `execCommand` outside a secure context (phone over LAN).
- Saving is optimistic except for bounds, which wait for the snapped answer. Only the last in-flight answer per Candidate is applied. A failed save shows the server's message and reloads the stored Candidates. "Saving…/All changes saved" is announced in an aria-live region. The open Candidate is kept in `?candidate=`.
- **Performance:** the picker renders only the Words from start − 30 s to end + 30 s ("Earlier"/"Later" add 60 s), as lines per Segment (broken at 12 s). Words are found by binary search over a memoised `starts` array, and the picker scrolls inside itself. Words use a roving tabindex: arrows/Home/End move, Enter/Space picks.

**Browser check** (ego-browser, `make dev`, Job `1d5d363bec2e`, no LLM calls):
- In Start mode I clicked "kan": start 1559.58 = the Word's start, since its neighbour touches it, so no lead-in.
- In End mode I clicked "pertanyaannya": end 1586.64 = the Word's end.
- I dragged across 10 Words (bar "New clip 26:28.9 – 26:32.3"), then switched to New clip mode and clicked the first and last Words. That added a 53 s manual clip, which opened as #6.
- I gave it a 48-character hook (the warning showed), set Split and selected it. I also selected #1 and #3 in the list, and set Track on #2.
- After a reload, all of this was still there (3 selected, layouts, hook, `?candidate=` kept).
- "Play ending" paused at exactly the end (1641.84). Keyboard: ArrowRight ×2 then Enter set the start on "airnya".
- Screenshots are in the session scratchpad (`review-*.png`).
- The owner took over the browser at the end, so the dev servers were left running and the test edits were left on that Job. A backup of its pre-check `candidates.json`/`job.json` is in the scratchpad (`jobs-backup/`).

**For ticket 12.**
- "Render selected" can read `candidate.selected` (`[c for c in store.load_candidates(id) if c.selected]`). `candidate.layout` is the override for the Render Planner (`Layout.AUTO` = per scene), and `hook_text` is the burned hook.
- Add `rendering` to `api.EDITABLE` so review continues while rendering (story 39). Note that `change_candidates` and a render worker's writes both go through the store lock.
- To detect "edited since rendered", compare a Clip's recorded (start, end, hook_text, layout) with the Candidate's. `edited` only means "changed from the AI's proposal".
- The media route already allows `.jpg` posters and nested paths (e.g. `clips/<id>.mp4`). The editor has room for a "Render selected" button next to the list's "N selected".

Open issues:
- No delete for a manual Candidate (not in the spec). An unwanted one can be left unselected.
- A Job whose Selection found no Candidates shows "Nothing to review yet": the picker needs a Candidate to centre on, so a manual clip can't be added there yet.
- Overlapping manual clips are allowed. Edits aren't checked against other Candidates.
- Phone-width layout and glass styling are ticket 18. The review stacks on narrow screens.


**2026-10-14: verified by the owner's session.** 170 tests pass and the frontend builds. Copy buttons have not been click-checked in the browser yet; ticket 18's browser pass covers them. Committed.
