# 06: Word Edits on Media Words

**Parent spec:** `../spec.md` (Domain and model: `WordEdit.media`; Planning Cues: Word Edits per Segment's timeline; Advanced Edit: Clipboard); user stories 12, 13, 40 (Word Edits).

**What to build:** the owner corrects a misheard word in a media Segment's captions as in the Source's.

- A Word Edit gains `media`. With it, `at` is a time on that item's timeline.
- Matching, merging and de-duplicating key by `(media, at)`, on the matching timeline only. A Source Word Edit never touches Media Words, and the other way round.
- The edit applies in every Segment of the Candidate that shows that time of that item.
- Double-click retyping on the preview, removing a Word and "New line here" work on a media Segment's Cues, writing Word Edits with `media`. The key is the Word's middle on the item's timeline.
- Copying a media Segment carries the Word Edits of its range. Pasting adds those the target Candidate hasn't got at that key, into any Candidate of any Job.
- Revision merge treats media Word Edits item by item, as Source ones.

**Blocked by:** 04.

**Status:** ready-for-agent

- [ ] Planner: a Word Edit with `media` changes the text in every Segment showing that item's time, and not a Source Word at the same number.
- [ ] Planner: a removed media Word leaves its Cue, and an emptied Cue leaves no event.
- [ ] HTTP: the API keeps two edits at the same `at` with different `media`. A Revision merge takes another editor's media Word Edit.
- [ ] vitest: retyping a media Cue's Word writes `{at, media, text}`. The Clipboard carries media Word Edits into another Job's Candidate.
- [ ] The MCP accepts `word_edits[].media` in `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`.
