# 10: The /impeccable critique's five fixes

**Parent spec:** `spec.md`. The critique is `.impeccable/critique/2026-10-29T09-24-20Z__frontend-src-pages-job-advanced-agent.md` (25/40).

**Status:** done

**Blocked by:** 09

**Owner's choice:** all five issues, starting with the editor's language and errors. Stop always shows its square, kept small.

## What to build (`frontend/src/pages/job/advanced/agent/`)

1. **Tools speak the editor's language** (clarify)
   - `toolTitle(part)` gives each row a title:
     - while it runs, the verb from `status.ts`, without its "…";
     - when done, the past tense ("Read the transcript", "Edited the Candidate");
     - when failed, "Couldn't …".
   - `toolSummary(summary)` turns the backend's summary into the editor's terms:
     - `start=…, end=…` becomes `0:00–0:40`;
     - `sets a_b, c` becomes `a b, c`;
     - `sets nothing` becomes nothing;
     - any other `k=v` pairs become their values joined by ` · `.
   - The summary is sans `text-xs`. Mono stays only inside the opened Input/Output.
   - `grouped()` leaves out the provider's own meta tools (`ToolSearch`, `TodoWrite`).

2. **Errors are readable and can be recovered from** (harden)
   - `cleanError(raw)` drops code fences and an "Error executing tool X:" prefix.
   - A turn's error and a send error show as a `bg-danger-surface` note with "Try again", which sends the prompt again.

3. **Hierarchy** (distill, typeset)
   - The Agent's text has no bubble: `px-1 text-sm leading-relaxed`. The owner's message keeps its `raised` bubble.
   - Tool rows have no border and no fill, only `hover:bg-fill`. The "N steps" row is no longer dashed.
   - A finished turn ends with a quiet footer, always visible:
     - Copy;
     - Undo and Redo when it saved Revisions (`ghost xs`; the same ADR 0028 revert and restore);
     - `rev N` in `text-muted`.

4. **Stop and the running state** (clarify, animate)
   - The Stop square is always shown, 9px, over a small orb behind it at 20px, opacity 70%.
   - Esc (outside a dialog) or ⌘. / Ctrl+. stops the turn. Its title reads "Stop (Esc)".
   - `agentStatus` reads "Starting…" before anything has arrived.

5. **Vertical room** (layout)
   - The message box starts at one line (`rows={1}`).
   - The choices pop up is at most 45% of the panel tall, and its list scrolls.
   - While the pop up is open, the card in the transcript folds to its title and "Answer below".
   - The pop up's list holds the focus with `aria-activedescendant`.
   - The composer's focus border is `border-text/50`.

## Seams under test
1. `toolTitle` and `toolSummary`.
2. `cleanError`.
3. `grouped()` leaves out meta tools.
4. Markup:
   - the Agent's text has no bubble;
   - a finished turn's footer has Copy, Undo, Redo and the revision;
   - a failed turn offers "Try again";
   - Stop's square is not hidden;
   - the message box has `rows="1"`;
   - the card folds while its pop up is open;
   - `agentStatus` reads "Starting…".

## Acceptance
- [x] The tests at the seams pass (`critique.test.tsx`). Updating the older tests caught a real bug: a card folded when `popup` and its `call` were both missing. Only `npx vitest run src/pages/job/advanced/agent` and `npx tsc --noEmit` are run.
- [x] Checked in the browser, dark and light, on a live Claude Code turn ("Starting…", Stop's square over the orb). "Jump to latest" became a small round button, so it no longer covers the footer.
