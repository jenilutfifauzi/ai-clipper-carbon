# 07: A live status line while the Agent works, Claude Code style

**Parent spec:** `spec.md` (Solution 1, revised).

**Status:** done

**Blocked by:** 06

**Why:** while a turn runs, the chat shows three bouncing dots. The owner wants Claude Code's status line instead: a moving glyph, a label that says what the Agent is doing ("Thinking…", "Working…"), a shimmer, and a timer.

Open-pencil's agent mode (`<main>/docs/referensi/open-pencil-master`) has no such line. What it does contribute:
- the reasoning block's "Thought for Ns";
- the spinner on a running tool, already here;
- the fade-in of streamed text.

The colours stay neutral (ticket 06).

## What to build (`frontend/src/pages/job/advanced/agent/`)

**`status.ts`** (pure functions)

`agentStatus(turn)` is null once the turn has stopped. Otherwise it reads the last part:

| Last part | Label |
|---|---|
| none | "Working…" |
| a thought | "Thinking…" |
| text | "Writing…" |
| a tool still running | that tool's verb (table below) |
| a tool that has finished | "Working…" |

The tool's verb is matched on the name without its `mcp__…__` prefix:

| Tool | Verb |
|---|---|
| `get_candidate` | "Reading the Candidate…" |
| `edit_candidate`, `merge_candidate_items`, `remove_candidate_items` | "Editing the Candidate…" |
| `get_transcript`, `get_media_words` | "Reading the transcript…" |
| `list_assets`, `list_presets` | "Looking through the library…" |
| `apply_template` | "Applying a Template…" |
| `generate_speech` | "Generating speech…" |
| `save_frame` | "Saving a frame…" |
| `list_candidate_revisions`, `restore_candidate_revision` | "Checking the Revisions…" |
| `show_ui` | "Laying it out…" |
| anything else | "Running <tool label>…" |

`thoughtLabel(seconds)` reads "Thought for Ns", where N is the rounded seconds and at least 1. For history, which has no measured time, it reads "Thought".

**`StatusLine.tsx`**
- Markup: `role="status"`, `aria-live="polite"`, `data-agent-status`.
- The glyph cycles `· ✢ ✳ ✶ ✻ ✽` every 120ms. Under reduced motion it is a still `✻`.
- The label shimmers (`motion-safe:shimmer`, a 2s linear gradient sweep).
- The timer reads `(12s)` or `(1m 05s)`, uses tabular numbers, and is hidden for the first second.
- The glyph and the timer are `aria-hidden`.

**`TurnView.tsx`**
- `TypingDots` is replaced by `StatusLine`, which shows for the whole run.

**`ReasoningBlock.tsx`**
- It times its own streaming. Once finished, its header reads `thoughtLabel`.

**`ChatMarkdown.tsx`**
- While streaming, new blocks fade in over 200ms (`motion-safe`).

**`src/index.css`**
- The `shimmer` utility, plus `@keyframes shimmer` and `fade-in`.

## Seams under test
1. `agentStatus`: each state's label, and null once the turn has stopped.
2. `thoughtLabel`: `0.3` gives "Thought for 1s", `4.4` gives "Thought for 4s", `null` gives "Thought".
3. TurnView's markup:
   - a running turn whose `edit_candidate` call is still running shows a `role="status"` reading "Editing the Candidate…";
   - there is no `animate-bounce`, and every animation class is `motion-safe:`;
   - a finished turn has no `data-agent-status`.

## Acceptance
- [x] The tests at the three seams pass (`status.test.tsx`). Only `npx vitest run src/pages/job/advanced/agent` and `npx tsc --noEmit` are run.
- [x] Checked in the browser on a live turn: the label changes with the turn's state, and the shimmer, glyph and timer move. After the turn the line is gone, and a thought reads "Thought for Ns". Both dark and light. (With Claude Code over ACP, the text comes in one piece and its tools finish fast, so a run mostly reads "Working…". The live line was caught in dark; in light the turn ended before the screenshot, and the rest of the chat was checked there.)
