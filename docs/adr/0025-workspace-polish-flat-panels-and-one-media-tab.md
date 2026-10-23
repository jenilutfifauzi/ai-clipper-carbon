# 0025: Flat panels, a deck Transport and one Media tab

Status: accepted
Date: 2026-10-23

## Context

The Advanced Edit's Workspace (ADR 0024) does everything it should but reads as crowded next to Concat: glass panels with blur, a top bar holding every action plus undo and redo, a player Transport built around a position slider, Inspector fields stacked label-over-control, and a timeline toolbar with no grouping. Nine asset tabs crowd the Asset Panel, two of them (Media and Audio) the same Media Library split by kind.

## Decision

- **Top-level panels are flat**: a new `panel` utility (solid surface, hairline border, no blur). `glass` stays for things that float (menus, popovers, sheets).
- **The top bar holds the Candidate and the document actions only**; undo and redo move to the timeline toolbar, next to the edits they undo.
- **The Advanced Edit's player has a deck Transport**: timecode, go to start/end, frame steps and play, with no position slider, on a desktop and a phone. The Timeline is where you scrub. The clip editor keeps its slider Transport.
- **The Inspector lays fields out inline** (label left, control right) in collapsible Groups whose folds the browser remembers in the Workspace's blob. Only the Advanced Edit's Inspector does; the shared components switch through a context.
- **Media and Audio are one Media tab** with categories (All, Video, Audio, Images).
- Accent and theme tokens are unchanged; no UI dependency is added.

## Considered options

- Copying Concat's violet accent and menu bar (File/Edit/View): rejected; it changes the product's identity and the actions are already one click away.
- Keeping the slider on a phone, where the Timeline is short: rejected for one Transport everywhere.
