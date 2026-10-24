# 0028: Agent Revisions are tagged by turn and undone by restore

Status: accepted
Date: 2026-10-24

Builds on 0003 (Revisions and the client merge).

## Context

An Agent saves the Candidate through the scoped MCP server (ADR 0027), as many times as its Agent Turn needs. Each save is a Revision, pushed live to every open editor (ADR 0003).

Today:
- **`useEditHistory.elsewhere()` replays an outside Revision under the undo steps.** Ctrl+Z skips it, so the only way back from an agent's change is the Revision History.
- **The Revision History labels each entry with its editor** (`X-Edit-Source`, `X-Edit-Tab`), one entry per stretch of saving from one editor.
- **An Agent Turn may save many times.** The owner thinks of the turn ("add a title and tighten the pauses") as one thing to keep or take back.

## Decision

- **Agent saves are tagged.** Saves made during a turn carry `X-Edit-Source: agent` and `X-Edit-Tab: agent:<turn id>`, so each Revision in the Revision History says which turn made it, and a new turn starts a new stretch.
- **A turn is undone through Revision restore.** A finished turn records its first and last Revision.
  - **Revert** restores the Revision before the turn.
  - **Restore** brings back the turn's last Revision.
  - Both are ordinary Revision restores: they save the chosen state again as the next Revision, so nothing is lost, and other editors merge it like any change (ADR 0003).
- **In the tab that started the turn, each agent Revision is adopted as an undo step.** `useEditHistory` gains `adopt(value, group)`: it takes an outside value as an undo step without saving it again. The Advanced Edit adopts a Revision whose tab is `agent:<turn>` for a turn this tab started, and Ctrl+Z takes it back like the owner's own edit.
- **Other tabs see it as an outside Revision.** They use `elsewhere()` as before, so their undo only takes back their own steps.

## Considered options

- **Every agent Revision as an outside Revision everywhere.** Nothing changes, but the owner who asked for the edit can't undo it with Ctrl+Z.
- **The whole turn as one undo step.** It matches how the owner thinks of a turn, but the steps arrive one by one while the turn runs; folding them afterwards rewrites the undo history under the owner's hands. Revert covers the turn as a whole.
- **A separate undo log per turn in the backend.** It would duplicate the Revision History, which already keeps every state and restores it safely.
- **Undo by asking the Agent for the inverse edits.** It costs a turn, and the model may not undo exactly.

## Consequences

- **The Revision History reads by turn,** each turn's stretch named for it.
- **Revert and Restore never lose a state.** They are restores, so the owner can go back and forth.
- **Revert is coarse.** Like any restore, it also takes back whatever was saved after the turn; Ctrl+Z is the fine-grained way.
- **Undo steps are per tab.** An agent Revision is undoable only in the tab whose chat started its turn.
