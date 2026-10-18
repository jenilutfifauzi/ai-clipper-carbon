# 09: Cue actions: Split, Merge, Delete, and the Cue inspector

**Parent spec:** `../spec.md` (Domain and model: `CueEdit.join`; Planning Cues: `join`, `joinable`; Advanced Edit: Actions on a picked Cue, Inspector, Phone); user stories 31–35.

**What to build:** the owner reshapes and cleans up single captions.

**Model:**
- Cue Edits gain `join`. It is refused together with any other field.
- A `join` cancels a pause, sentence-end or longest-Cue break before its Word. The characters, Words and lines per Cue still part them.

**Actions on a picked Cue:**
- **Split** (Cmd/Ctrl+B with a Cue picked) adds a Cue Edit at the first Word that starts after the playhead. It is disabled when there is none.
- **Merge with next** removes the next Cue's starting Cue Edit and its first Word's `break_before`. It adds a `join` Cue Edit where a pause, sentence end or longest-Cue limit would still part them. It is disabled when the next Cue isn't `joinable`.
- **Delete** writes an empty-text Word Edit for each of the Cue's Words, as one undo step. The sound is untouched.

**Inspector of a picked Cue:**
- its Words as chips (the clip editor's caption text editor, shared): retype, remove, "New line here";
- its shown start and end as fields, writing the deltas;
- Split, Merge and Delete buttons.

On a phone, these come in the bottom sheet.

**Blocked by:** 03, 07.

**Status:** ready-for-agent

- [ ] Planner: `join` keeps two Cues parted by a pause together, but not past `max_chars` × `max_lines`. `joinable` agrees.
- [ ] HTTP: a `join` Cue Edit with a shift is refused.
- [ ] vitest: Split at a playhead inside a Cue adds a Cue Edit at the right Word. Merge clears the next Cue's start, and adds `join` only when needed. Delete empties every Word in one undo step. All are refused on a locked Track.
- [ ] vitest: chips retype and remove Words, and the start and end fields write the deltas.
- [ ] The MCP accepts `join` in `cue_edits`.
- [ ] Browser walkthrough at desktop and phone widths.
