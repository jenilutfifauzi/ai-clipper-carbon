# 09: A Style Preset's Join Transition for every new join

**Parent spec:** `../spec.md` (Solution "Join Transition in Style Presets", "Model", "Join Transition rule", "Agent (MCP)"); GLOSSARY **Join Transition**, **Style Preset**.

**What to build:** a Style Preset gains a **Join Transition**: none, or a kind, length, strength, colour and sound (a Transition without `after`).
- **Defaults.** Built-in Presets have none. Stored Presets read with none.
- **Where it is set.** A Transitions section where the Preset's caption, hook and Watermark styles are edited and saved. It is read-only for built-ins.

**The rule** is one pure function, written as twins in the backend and in the editor:
- A join is a pair of adjacent Segment ids.
- Given the Main Track before and after a change, every join present after and not before, with no Transition, gets a copy of the Candidate's Preset's Join Transition. Its `after` is the join's first Segment.

**Where the rule runs:**
- **The editor** applies it inside every action that changes the Main Track, in the same undo step: split, Split all, inserting a media Segment, paste, Freeze frame, delete, Ripple delete, reorder.
- **The backend** applies it in the Candidate update when the Segments change and the update doesn't state `transitions`. An update that states `transitions` is taken as is, so the agent can leave a new join cut.

**What the rule never does:**
- Removing a Transition never triggers it, since the join is not new.
- Changing or switching a Candidate's Preset touches no join.

**The agent:**
- `save_preset` takes and returns `join_transition`.
- The tool descriptions explain the rule and the exception.

**Blocked by:** 04, 06.

**Status:** ready-for-agent

- [ ] A shared JSON fixture of cases is read by both the backend and the editor tests, with the same results (prior art: the shared Segment time fixtures). Each case gives the Main Track before and after, the Transitions and a Join Transition, and the expected Transitions after. The cases cover:
  - split, insert, paste, Freeze frame, delete of a middle Segment, reorder;
  - a removed Transition staying removed;
  - a Preset with none.
- [ ] In the editor, splitting a Segment under a Preset with a Join Transition gives the new join a copy, in the same undo step as the split.
- [ ] Via the API or MCP, an update changing Segments without `transitions` fills new joins. One stating `transitions` keeps exactly what it states.
- [ ] Changing a Candidate's Preset leaves its Transitions unchanged.
- [ ] The Preset editor saves and shows the Join Transition. Built-ins show none, read-only.
- [ ] `save_preset` round-trips `join_transition`. A Preset stored without it reads with none.
