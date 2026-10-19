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

**Status:** done

- [x] Planner: a Word Edit with `media` changes the text in every Segment showing that item's time, and not a Source Word at the same number.
- [x] Planner: a removed media Word leaves its Cue, and an emptied Cue leaves no event.
- [x] HTTP: the API keeps two edits at the same `at` with different `media`. A Revision merge takes another editor's media Word Edit.
- [x] vitest: retyping a media Cue's Word writes `{at, media, text}`. The Clipboard carries media Word Edits into another Job's Candidate.
- [x] The MCP accepts `word_edits[].media` in `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`.

## Comments

**2026-10-19, agent:** Built.
- **Model**: `WordEdit.media: MediaId | None` (candidates.py; `MediaId` moved above it). `review._merged` de-duplicates by `(media, round(at, 3))`, ordered by time.
- **Planner**: `match_edits(words, edits, timelines=None)` is now generic over anything with `at` and `media` (`TimelineKeyed` Protocol, `Keyed` TypeVar), so Cue Edits (07) can reuse it as is. With `timelines` (each Word's `media`, None for the Source) an edit only matches Words of its own timeline; without it, it behaves as before. `_captions` passes `[key.media for key in keys]`.
- **Rendering**: `shown_edits(edits, segment)` gives each Segment, Source or media, the Word Edits of its own timeline within WORD_EDIT_REACH_SECS of its range, in seconds into it; so a media edit applies in every Segment showing that time of that item. A Candidate without Segments takes Source edits only.
- **Preview Plan**: `PreviewWord.media`; media Segments' Words are now listed (keyed `at` on the item's timeline) with their edits, matched on their own timeline.
- **MCP**: `ITEMS["word_edits"]` keyed by `("at", "media")` (`_same_key`, a missing field is None); `remove_candidate_items` takes `{at, media}` keys (`TimelineKey`) beside numbers (a number is a Source Word Edit's `at`); dry-run Words show `media`; INSTRUCTIONS give the corrected `at` wording (any time within the Word, the editor uses its middle). TOOLS_BUDGET_BYTES raised 69_000 → 70_000 (now about 69_830).
- **Frontend**: `WordEdit.media?` and `PreviewWord.media?` (api.ts); `wordEdits.ts` `sameKey(a, b)` (rounded `at` and `media`, also reusable for Cue Edits) and `withWordEdit` writes `media` for a media Word (Source edits stay `{at, text, break_before}`), so InlineText retyping and CaptionTextEditor's remove / "New line here" work on media Cues. `merge.ts` keys `word_edits` by `["at", "media"]`. Clipboard `copy` takes each Segment's Word Edits of its own timeline; `paste` adds media Word Edits of the pasted video Segments' ranges into any Candidate of any Job where the target has none at that `(media, at)` key (exact key: there are no Media Words at paste time to find "the same Word" as for Source ones).
- Tests: `tests/test_media_words.py` (planner via candidate_plan: every Segment showing the time, Source edit at the same number untouched, removed Word / emptied Cue; HTTP: two edits at one `at` of two timelines kept, preview lists media Words with their edits, bad `media` refused), `tests/test_mcp.py` (`word_edits[].media` in all three tools), `editor/wordEdits.test.ts`, `editor/merge.test.ts`, `advanced/actions.test.ts` (Clipboard into another Job). The Revision merge is the editor's (merge.ts), so "a Revision merge takes another editor's media Word Edit" is checked in vitest, not over HTTP; the agent's `merge_candidate_items` over existing edits is checked in the MCP test.
- Browser walkthrough on a copy of one Job and the Media Library (scratch DATA_DIR, existing Media Words of the 150 s video): placed the video as the first Segment, the preview showed "HALO UDAH"; double-clicking and retyping "HALO SUDAH" saved `{at: 4.59, text: "sudah", media: <video id>}` and the preview showed it. The chips (remove, New line here) were not driven in the browser: the Advanced Edit has no picked-Cue inspector yet (07/09); they're covered by the vitest of `withWordEdit`.

**2026-10-19, agent (merge):** Merged feat/captions-advanced (07 Cue Edits, 05 Captions switch) and unified the keying of Word Edits and Cue Edits:
- **Planner**: one `match_edits(words, edits, timelines)` over `TimelineKeyed` (07's `_Keyed` dropped); `_captions` passes the Words' timelines to both the Word Edits and the Cue Edits. One `edit_shown(edit, media, start, end)` (planner.py) decides whether an edit of a timeline reaches a Segment: used by `rendering.shown_edits` (Word Edits) and `_segment_cue_edits` (Cue Edits).
- **MCP**: `ITEMS` keys both `word_edits` and `cue_edits` by `("at", "media")` (`_same_key`; 07's `ON_MEDIA`/`_matches`/`_keyed` dropped). Removal takes `at` or `{at, media}` (`TimelineKey`) for both; 07's `"media:at"` string form is gone (instructions, docstrings and test_mcp updated). `_merge` sorts timed items by timeline then time. TOOLS_BUDGET_BYTES 72_000 → 72_500 (about 72_130 with both).
- **Frontend**: `merge.ts` keys both by `["at", "media"]`, `at` to the millisecond (07's `media@at` function key dropped; a Cue Edit Collision's item is now `"103.1@"`). `pick.ts` `sameCue` is `sameKey` (editor/wordEdits.ts). The Clipboard's paste brings Word Edits and Cue Edits by one rule (`brought`): an item's into any Candidate unless one at that key, the Source's into another Candidate of the Job unless one on that Word.
