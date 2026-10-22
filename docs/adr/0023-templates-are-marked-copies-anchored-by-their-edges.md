# 0023: Templates are marked copies, anchored by their edges

Status: accepted
Date: 2026-10-22

Builds on 0002 (Segments, Timeline time), 0003 (Revisions), 0004 (layers ripple with the Main Track) and 0020 (Media Words and Cue Edits).

## Context

The `templates` feature (roadmap #21, `.scratch/advanced-edit-v2/roadmap.md`) saves one Candidate's Advanced Edit and puts it on many others: a branded intro and outro, a lower-third, a music bed and a look, the same on every Candidate of a Job whatever its length.

Concat's project templates are a whole project document with media slots. Instantiating one copies it into a new project and fills each slot in place. The template's timing is kept as it is: nothing ripples, stretches or trims to the filling media's length, and text is never a slot.

ai-clipper differs in two ways. Its Candidates already exist, with edits of their own, before a Template meets them. And Selection makes many Candidates of different lengths per Job. Concat's fixed timing would put an outro's call to action in the wrong place on all but one of them.

Each choice had genuine alternatives:
- **Copy or link:** a Candidate could name its Template and have the planner merge the two at render, or receive a copy of its items.
- **Existing edits:** applying could add on top, replace every layer, or replace only what a Template put there.
- **Other lengths:** keep the Template's times (Concat), scale them by the ratio of lengths, or anchor each item.
- **Where it runs:** in the editor, like the Clipboard and the ripple (frontend only today), or on the server.

## Decision

- **Applying a Template copies it into the Candidate, never links it.** The planner and the Candidate's model know nothing of Templates beyond a mark. Changing, overwriting or deleting a Template leaves the Candidates it was applied to as they are, as with Text Presets and the Join Transition.
- **What a Template put there is marked as a Template item.** Applying a Template again, the same or another (or none), replaces every Template item, the intro and outro, and the style, even where they were changed by hand since, and says how many such were replaced. Items made by hand are kept. One application is one Revision and one step of undo.
- **The Candidate's own Segments are the Main Slot.** A Template never holds Source Segments or hook text. Its intro and outro are media Segments, with the Transitions at their joins and their Word Edits and Cue Edits. The joins inside the Main Slot stay the Candidate's. The Main Slot's treatment is the Grade, Video Effects and Audio Effects of the first Source Segment when the Template is saved. It is given to every Source Segment, and their cuts, Speed, volume and fades are kept.
- **Each edge of a layer is anchored to the nearest boundary:** the Clip's start, the Main Slot's start, the Main Slot's end, or the Clip's end. Start and End items keep their length; a Span stretches with the Main Slot. Keyframes keep their distance from the item's nearer edge, so a fade-out stays at the end. The hook is anchored Start, so it follows the intro. A Music Clip stretched past its song stops at the song's end. An item that no longer fits is trimmed or dropped, and the owner is told, as with the Clipboard.
- **Text comes from the Candidate through Template Fields.** `{title}`, `{hook}` and `{kicker}` in a Template's Text Layers are replaced on applying. A Template may set a Kicker.
- **The server applies Templates**, to many Candidates of a Job in one locked change (`JobStore.change_candidates`), so that one stale Revision can't fail a batch halfway. The same code serves the Review's checklist dialog, the Advanced Edit, the MCP's `apply_template`, and the default Template given to the Candidates of a new Job.
- **A Template names its Media Library items, Looks and Faces by id**, and deleting one it uses is refused, as for Candidates. It does not copy their files as Concat does. A deleted Style Preset falls back to Default, and a deleted Logo leaves no Watermark, as on Candidates.

## Consequences

- Candidate items (Text Layers, Shapes, Music Clips, Overlays, Adjustment Layers, Segments, Transitions, Word Edits, Cue Edits) gain an optional mark naming the Template that put them there. The render ignores it.
- The edge anchoring is a pure function of a Template and a Candidate's Main Slot length, tested like the planner (Seam B). The frontend's `ripple.ts` stays for edits in the editor. The two must agree on what "trimmed or dropped" means.
- With no live link, a corrected Template reaches existing Candidates only when it is applied again, which also discards hand changes to its items.
- Media used only by a Template can't be deleted until the Template is, so the 409 that names the users must name Templates too.
