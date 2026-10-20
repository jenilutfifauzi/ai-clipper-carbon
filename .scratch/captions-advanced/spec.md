# Captions in the Advanced Edit: Media Words, Cues and Cue Edits, SRT and VTT

Status: ready-for-agent
Created: 2026-10-18

## Problem Statement

Captions are what a short clip of a podcast is watched with, but the Advanced Edit treats them as something it can only look at.

**Only the Source talks.**
- A video from the Media Library placed on the Main Track (a talking intro, an interview cut-in, a reaction) never gets captions. A media Segment has no Words.
- To caption one, the owner has to type Text Layers by hand and time each to the voice.
- `.scratch/advanced-edit/spec.md` lists "Transcribing uploaded videos for captions" as Out of Scope. ADR 0020 overturns that, for media Segments.

**The look lives elsewhere.**
- The Caption Style is edited only in the clip editor. The Advanced Edit's inspector says "Their look is changed in the clip editor".
- The Advanced Edit doesn't prepare a Clip's Words. Until the clip editor or a render has done so, its captions come from the episode Transcript.

**One caption can't be fixed on its own.**
- The Captions Track is read-only.
- A caption that comes up a beat late, or covers a face, can only be fixed by changing every caption's place or the line limits for the whole Clip.
- Every caption is one line. There is no way to show a whole sentence in two lines.

**No caption files.** Platforms take SRT or VTT as subtitles, for search and for viewers who turn burned-in text off. Nothing writes either.

**Concat** makes captions with Whisper from any clip's voice:
- one text title per phrase, at the top, centre or bottom, in three sizes;
- each title free to retime and move;
- but with no word timing, no shared style, no link to its clip, and no SRT.

## Solution

The captions stay planned from Words, with a per-Word highlight, from the Caption Style and the Word Edits (ADR 0020). The Advanced Edit gains:

- **Media Words.**
  - A video from the Media Library is transcribed, whole and once, in its own language if one is set, else the Job's.
  - This happens in the background as soon as the Advanced Edit opens or the video is placed as a Segment.
  - Every media Segment then has captions, unless its Captions switch is off. They follow the Source's rules for Speed, Reverse, Freeze frames and joins.
  - Corrections to them are Word Edits of the Candidate, keyed on the item's timeline.
- **Cues.**
  - The captions are shown in Cues of one to three lines.
  - Phrase (one short line, as today) and Sentence (up to two lines, to a sentence's end) set the line limits in one click.
- **Cue Edits.**
  - A Cue picked on the Captions Track or the preview can be retimed by its edges or moved in time by its body.
  - It can also be moved and scaled on the preview on its own, split at the playhead, merged with the next, emptied, or retyped.
  - Each change is kept as a Cue Edit keyed by the Cue's first Word, so the Cue survives later changes to the line limits.
- **The Caption Style in the Advanced Edit.** With the captions picked, the inspector shows the Preset bar and the whole Caption Style panel the clip editor has.
- **SRT and VTT.**
  - Every render writes both beside the MP4, one cue per Cue, in the words' own case.
  - The editor and the agent can download them for any Candidate.

## User Stories

1. As the owner, I want a talking intro from the Media Library to get captions like the episode, so that every voice in the Clip is captioned.
2. As the owner, I want a media video transcribed without pressing anything, so that its captions are there by the time I look.
3. As the owner, I want a media video transcribed once, however often I trim, split or reuse it, so that editing never waits for Whisper again.
4. As the owner, I want a media video reused in another Job or Candidate to have its Words already, so that a branded intro is transcribed once.
5. As the owner, I want a media video transcribed in my Job's language, so that an Indonesian intro in an Indonesian Job is heard right.
6. As the owner, I want to set a media video's own language, so that an English clip inside an Indonesian Job is heard in English.
7. As the owner, I want to see on the Main Track that a media Segment is still being transcribed, so that I know why it has no captions yet.
8. As the owner, I want to retry a transcription that failed, so that one failure doesn't leave a Segment uncaptioned for good.
9. As the owner, I want to turn captions off for one media Segment, so that B-roll over music doesn't get Whisper's hallucinated words.
10. As the owner, I want a sped-up media Segment's captions to keep pace with its voice, so that they stay in sync.
11. As the owner, I want a reversed media Segment or a Freeze frame to show no captions, as the Source's don't, so that nothing backwards or frozen is captioned.
12. As the owner, I want to correct a misheard word in a media Segment's captions, so that the captions say what was said.
13. As the owner, I want that correction to apply wherever the same moment of the video is shown in my Candidate, so that a repeated piece stays consistent.
14. As the owner, I want a render to wait for a missing transcription instead of rendering without captions, so that a Clip never goes out half-captioned.
15. As the owner, I want the Advanced Edit to prepare the Clip's own Words when it opens, so that its captions are the Clip's, not the Transcript's.
16. As the owner, I want to change the captions' font, size, colours, highlight, position and line limits from the Advanced Edit, so that I don't leave it for the clip editor.
17. As the owner, I want to apply or save a Style Preset from the Advanced Edit, so that a look I like is one click on the next Candidate.
18. As the owner, I want each change to the Caption Style to be one step of undo, so that I can try looks freely.
19. As the owner, I want captions in two lines, so that a whole sentence is on screen at once.
20. As the owner, I want a Phrase button and a Sentence button, so that I can switch between punchy one-liners and full sentences without tuning numbers.
21. As the owner, I want the two lines of a Cue to be about the same length, so that a Cue doesn't end in one lonely word.
22. As the owner, I want my existing Candidates to look exactly as they did, so that nothing I already approved changes.
23. As the owner, I want to click a Cue on the Captions Track to pick it, so that I can work on that one caption.
24. As the owner, I want to drag a Cue's edges to show it earlier or keep it longer, so that I can fix a caption that comes up late or vanishes early.
25. As the owner, I want to drag a Cue's body to move it, with its word highlight, in time, so that I can fix a caption that is out of sync.
26. As the owner, I want a retimed Cue never to overlap its neighbours or cross into another Segment, so that captions never pile up.
27. As the owner, I want to drag one picked Cue on the preview to its own place, so that a caption that covers a face can move out of the way alone.
28. As the owner, I want to scale one picked Cue with its corner Grips, so that one key line can be bigger.
29. As the owner, I want a Cue's own size to follow the Caption Style's size when I change it, so that it stays bigger by the same amount.
30. As the owner, I want to pick the whole captions (the Track's label) and drag them, as today, so that moving all captions is still one drag.
31. As the owner, I want to split a Cue at the playhead, so that a long caption becomes two.
32. As the owner, I want to merge a Cue with the next one, so that a sentence cut by a pause reads as one caption.
33. As the owner, I want Merge to be unavailable when the two wouldn't fit the line limits, so that a merged Cue never overflows.
34. As the owner, I want Delete on a picked Cue to remove its words from the captions (not the sound), so that a filler line disappears in one step.
35. As the owner, I want to retype a picked Cue's words in the inspector, so that I can correct it without double-clicking each word on the preview.
36. As the owner, I want a "New line here" on a word to start a new line within the Cue, so that I control where a two-line caption breaks.
37. As the owner, I want Reset timing and Reset position on a picked Cue, so that I can undo my changes to it without undoing everything after.
38. As the owner, I want a Cue's edits to stay with it when I change the line limits, so that my fixes aren't scattered by a style change.
39. As the owner, I want a Cue's edits to come back if I trim a Segment and then extend it again, so that trimming doesn't lose work.
40. As the owner, I want pasted Segments to bring their Word Edits and Cue Edits, so that a copied moment keeps its fixed captions.
41. As the owner, I want every render to write an .srt and a .vtt beside the MP4, so that I can upload subtitles with the video.
42. As the owner, I want those files in the words' own case and punctuation, with my corrections, so that platform subtitles read naturally even when the burned-in captions are uppercase.
43. As the owner, I want one subtitle cue per Cue, with its lines, so that the subtitles match what is burned in.
44. As the owner, I want to download a Candidate's SRT or VTT from the editor without rendering, so that I can check or reuse it.
45. As the owner, I want a Job with captions off to get no captions and no caption files, as today, so that the switch means what it says.
46. As the owner, I want the clip editor's preview and Timeline to show Cues as the Advanced Edit planned them, so that both editors agree.
47. As the owner, I want the clip editor's Caption Style panel to have the same lines and Phrase/Sentence controls, so that the two panels match.
48. As the owner, I want another editor's Cue Edits merged into mine item by item, so that two tabs or the agent don't overwrite each other.
49. As the agent, I want to set Word Edits on media Words, Cue Edits and a media Segment's Captions switch through `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`, so that I can fix captions as the owner does.
50. As the agent, I want a dry run to list the Cues with their keys and each Segment's Words status, so that I can target a Cue and know when Media Words are ready.
51. As the agent, I want to set a media item's language and get its Media Words, so that I can caption a foreign-language clip.
52. As the agent, I want to get a Candidate's captions as SRT or VTT, and find the caption files of rendered Clips, so that I can hand subtitles to a publishing step.

## Implementation Decisions

### Domain and model

- **`MediaItem.language: str | None`.** It has the pattern of `JobOptions.language`; empty means the Job's language. It is set through the Media Library API and edited from the media Segment's inspector and the Media Library's item menu. Changing it doesn't delete the Media Words of the old language.
- **Media Words storage.**
  - They are kept beside the item in a folder of its own, one file per language and model (the model id made a safe file name).
  - Each file holds `language`, `model` and `words` in seconds of the item, in the per-Clip Words format.
  - Deleting the item deletes them with its other derived files.
  - No migration is needed: an item with none is transcribed when first needed.
- **`Segment.captions: bool | None`** applies to media Segments only. None (every saved Candidate) means on. It is refused on a Source Segment.
- **`WordEdit.media: MediaId | None`.** With it, `at` is a time on that item's timeline; without it, on the Source's.
  - Edits match the Word whose span holds `at`, else the nearest within the existing reach, on the matching timeline only.
  - Merging and de-duplicating key by `(media, round(at, 3))`.
- **`Candidate.cue_edits: list[CueEdit]`,** at most 500. A `CueEdit` holds:
  - `at: float` and `media: MediaId | None`: the key, matched to a Word as a Word Edit's is. That Word starts a Cue.
  - `shift: float`: seconds on that timeline. It moves the whole Cue and its Words' highlight; a body drag sets it.
  - `start_delta: float` and `end_delta: float`: seconds on that timeline. They move only that edge of what is shown (negative is earlier); edge drags set them.
  - `x`, `y` (output px, as the Caption Style's custom position) and `scale` (over the Caption Style's size, bounded): its own place and size. Any can be None.
  - `join: bool`: instead of a start, keep this Word's Cue with the one before (see Planning). It is refused together with any other field set.
  - Shifts are bounded (±10 s). Times are on the item's timeline, so they scale with Speed.
- **`CaptionStyle.max_lines: int`,** 1–3, default 1.
  - `max_chars` and `max_words` become per line.
  - `max_secs` and `pause_secs` become per Cue.
  - With 1, every stored Style Preset and Style Override plans exactly as before.
- **Phrase and Sentence** are frontend presets of line limits, not a stored field. The panel marks the one the current values match.
  - Phrase: 1 line, 16 characters, no word limit, 1.4 s, 0.5 s pause (today's defaults).
  - Sentence: 2 lines, 24 characters, no word limit, 5 s, 0.7 s pause.
- **Word Edit `break_before`** now starts a new line, and a new Cue when the current Cue has `max_lines` lines. With `max_lines` 1 this is today's behaviour, so no stored data changes meaning.
- **Revisions.**
  - `cue_edits` is a new Revision part ("Cue Edits"), merged item by item by `(media, at)` as Word Edits are.
  - `segments[].captions` goes with the Segment.
  - `MediaItem.language` is not part of a Candidate.

### Media Words (transcription)

- **A Media Words service** (beside the Media Library's derived files) answers, for an item and a language, ready (with Words), pending, failed (with the error), or none.
  - It queues a job on the existing Whisper worker: the whole normalized item, `word_timestamps`, the existing VAD and `restore`.
  - One item and language is transcribed at most once at a time. Failures are remembered until a retry.
  - "Transcribe again" re-runs one language and replaces its file.
- **The language is the item's, else the Job's** `JobOptions.language`, resolved per Job.
- **`prepare` now covers media Segments.**
  - The existing per-Candidate prepare call also queues Media Words for each captioned media Segment, besides the Clip Words of its Source Segments.
  - The Advanced Edit calls it when it opens and after a media Segment is added, pasted or has its Captions switch turned on.
  - A Job with captions off queues nothing.
- **Renders wait.**
  - The render step makes sure the Media Words of every captioned media Segment exist before planning, transcribing any that are missing.
  - A failed transcription fails that Clip's render with a message naming the item, so the owner can retry or turn that Segment's captions off.
- **The Preview Plan reports each Segment's Words status:** `clip`, `transcript` (Source fallback), `media`, `pending`, `failed`, `off` (switch), or `none` (Freeze frame, Reverse, or a Job with captions off). The Advanced Edit refreshes the Preview Plan while any Segment is `pending`.

### Planning Cues

- **A media Segment's Words** are its item's Media Words within its range, mapped through its Segment time exactly as a Source Segment's are. They are retimed by Speed, kept when their middle is inside the cuts, and clamped to them. Reverse and Freeze frames get none.
- **Its Scenes are captioned with the Caption Style's position.** Auto puts them in the lower third, as for a Scene without a Split seam.
- **Word Edits and Cue Edits are given to each Segment** from its own timeline (Source, or its item), within the reach of its range, as Word Edits are today.
- **Breaking into Cues and lines.** The existing rules decide where Cues end:
  - the pause;
  - a sentence's end;
  - the longest Cue;
  - a cut;
  - a change of area;
  - a Word Edit's break (when the Cue is full).

  A Cue Edit's Word always starts a Cue, and a `join` Cue Edit cancels a pause, sentence-end or longest-Cue break before its Word. The characters, Words and lines per Cue still part them.
- **Lines within a Cue are balanced.** The Words are split into at most `max_lines` lines, each within `max_chars` and `max_words`. Of the splits that fit, the one with the shortest longest line wins. A `break_before` forces a line start.
- **Timing.**
  - A Cue's shown span is planned as today (it lingers after its last Word, up to the next Cue and the cuts).
  - Its Cue Edit's `shift` then moves the span and the Words' times, and `start_delta` and `end_delta` move its edges, each divided by the Segment's Speed.
  - Then it is clamped: within its Segment's span on the Timeline, not before the previous Cue's shown end, not after the next Cue's shown start, and at least the minimum length.
  - Word highlight times are clamped into the shown span.
- **Place and size.**
  - A Cue Edit's `x` and `y` place that Cue as a custom position does, kept in the frame, overriding the Caption Style's position for it alone.
  - Its `scale` multiplies the Caption Style's size before the existing shrink-to-fit.
- **The Render Plan's captions become Cues.** Each Cue carries:
  - its shown `start` and `end`;
  - its `lines` of `words` (display text, times);
  - its `plain` lines: the Words' text after Word Edits, without the Caption Style's case or stripping, for SRT and VTT;
  - its area and size;
  - its `key` (`at` as its first Word's middle on its timeline, and `media`);
  - whether a Cue Edit applies;
  - `joinable`: whether merging it into the previous Cue fits the limits;
  - where a Cue Edit keeps it (`low`, `high`), its Segment's `speed`, its Words' keys (`word_ats`) and the `at` of the Cue Edit matched to each (`cue_edit_ats`), so that the Advanced Edit retimes, splits and merges it without repeating the planner's rules (ADR 0001). The plan gives the minimum length as `cue_min_secs`.

  A `join` cancels only the one break before its Word: `max_secs` still counts from the Cue's first Word, so a merge that would pass it leaves the rest of the next Cue as its own Cue, and the Cue is shown to the joined Word's end. A retimed Cue is never dropped: one short of room takes it from the Cue before (never past that Cue's own minimum), and where its Segment leaves less than the minimum, it fills its room.

  Cue Edits whose Word isn't shown are listed in the plan as unused, and kept.

### Rendering

- **A Cue is drawn as one ASS event per highlighted Word,** as today, with its lines joined by `\N` and set from the same layout. The colour highlight is unchanged. The box highlight is placed per line from the line's own metrics.
- **The preview's caption drawing takes lines,** with the same line height and box placement, and the timing exactly as planned.
- **Caption files.**
  - A pure writer turns a plan's Cues into SRT and into VTT: one cue per Cue, its `plain` lines, its shown start and end, numbered in order. VTT gets its `WEBVTT` header.
  - Every render writes `<clip>.srt` and `<clip>.vtt` beside the MP4. The Clip record lists them, the API serves them, and deleting the Clip deletes them.
  - A Job with captions off writes none.
- **Downloads without rendering.** An endpoint returns a Candidate's SRT or VTT from its Preview Plan (saved state). It refuses while any captioned Segment is pending.

### Advanced Edit

- **Pick.** A new Pick kind, a Cue, alone, identified by its key.
  - Clicking a Cue on the Captions Track or on the preview picks it.
  - Clicking the Captions Track's label picks the captions, as clicking a Cue does today.
  - A Cue whose key disappears after an edit drops out of the Pick.
- **Captions Track.**
  - Cues are drawn as blocks, a dot marking those with a Cue Edit.
  - On a picked Cue, the edges drag `start_delta` and `end_delta`, and the body drags `shift`. They snap like other items and are clamped as the planner clamps them, so what is dropped is what is planned.
  - One drag is one step of undo. A locked Captions Track refuses all of it.
- **Preview.**
  - With a Cue picked, its Grips (move and corners, no edges, no rotation) write its Cue Edit's `x`, `y` and `scale`.
  - With the captions picked, they write the Caption Style Override as today.
  - Smart Guides apply to both.
- **Actions on a picked Cue:**
  - **Split** (Cmd/Ctrl+B) adds a Cue Edit at the first Word after the playhead. It is disabled when no Word of the Cue starts after it.
  - **Merge with next** removes the next Cue's starting Cue Edit and `break_before`. Where it would still be parted by a pause, a sentence's end or the longest Cue, it adds a `join` Cue Edit. It is disabled when the next Cue isn't `joinable`.
  - **Delete** writes an empty-text Word Edit for each of its Words, as one step.
  - **Reset timing** and **Reset position** clear those fields of its Cue Edit, dropping it when nothing is left.
- **Inspector.**
  - **A picked Cue** shows:
    - its Words as chips: retype, remove, and "New line here" (the clip editor's caption text editor, shared);
    - its shown start and end as fields (writing the deltas);
    - its own place and scale with resets;
    - Split, Merge and Delete.
  - **The picked captions** show the Preset bar and the full Caption Style panel, shared with the clip editor, writing Style Overrides. Each change is one step of undo, and saving to a Preset works as in the clip editor.
  - **A media Segment** gets:
    - a Captions switch;
    - its item's language (a select whose first entry is "Job's language (xx)", noting that it applies to the item in every Job);
    - its Words status, with Retry when failed and "Transcribe again" when ready.
- **Main Track.** A media Segment shows a "Transcribing…" badge while pending, and a red badge when failed.
- **Captions Track,** over a pending Segment: a hatched span. When the Job's captions are off, the Track says so.
- **The Media Library's item menu** gets the language select, for videos.
- **Clipboard.** Copying Segments carries the Word Edits and Cue Edits of their range, from their own timeline. Pasting adds those the target Candidate hasn't got at that key, for media Segments into any Candidate.
- **Phone:** a picked Cue's actions and inspector come in the bottom sheet as other items' do. Edge drags work on the Timeline as for other items.

### Clip editor

- Its Caption Style panel is the shared one, with `max_lines`, Phrase and Sentence.
- Its preview and Timeline draw Cues (lines, Cue Edits, media captions) from the plan.
- It doesn't pick, retime or move single Cues.

### Agent (MCP)

- **Editing tools.** `edit_candidate`, `merge_candidate_items` and `remove_candidate_items` take:
  - `word_edits[].media`;
  - `cue_edits`, keyed by `(media, at)`, merged field by field;
  - `segments[].captions`.
- **A dry run returns** the Cues (times, lines, plain text, key, whether edited, joinable), the unused Cue Edits, and each Segment's Words status.
- **New tools:**
  - `set_media_language(media_id, language | null)`;
  - `get_media_words(media_id, job_id)`: it queues if needed, waits up to a timeout, and returns Words or the status;
  - `get_captions(job_id, candidate_id, format: "srt" | "vtt")`.
- **`list_clips`** includes each Clip's caption file paths.
- **The tool descriptions** fix the Word Edit key wording: any time within the Word on its timeline, and the editor uses its middle. They also explain Cues, Cue Edits, `join` and the Captions switch.

## Testing Decisions

Good tests check what is seen and stored: text and pixels of a rendered frame, Cues in a Preview Plan, the bytes of a caption file, what the API and MCP accept and refuse, and what the editor's actions leave in a Candidate. They don't check how an ASS line or a cache file is spelled.

- **Planner (pure; prior art: the caption tests in the planner suite, the line-break tests):**
  - With `max_lines` 1 and no Cue Edits, the Cues equal today's caption events. Run this on the existing caption fixtures.
  - Sentence limits give two balanced lines, end Cues at a sentence's end, and respect `max_chars` per line.
  - `break_before` starts a line within a two-line Cue, and a new Cue in a one-line Cue.
  - A Cue Edit's Word starts a Cue even after the line limits change.
  - `shift` moves the Cue and its highlight. Edge deltas move only the edges. Both scale with Speed and are clamped by neighbours and the Segment.
  - `x`, `y` and `scale` place and size one Cue only, and stay in the frame.
  - `join` cancels a pause break but not `max_chars`. `joinable` is false when the merge wouldn't fit.
  - A Cue Edit whose Word is trimmed out is listed as unused, and applies again when the range is restored.
  - Media Words map through a media Segment's Speed, and a reversed or frozen one has none. A Word Edit with `media` applies only to that item's Words, in every Segment showing that time.
  - The SRT and VTT writer output from given Cues: numbering, times, plain case, lines, header.
- **HTTP and real ffmpeg (prior art: the media Segment and render tests):**
  - The FakeTranscriber learns to hear scripted Words per media file, and counts its calls.
  - A Candidate with a talking media Segment: prepare queues Media Words. The Preview Plan goes from `pending` to `media` and shows its Cues.
  - A second Candidate or Job using the item, or a trim, doesn't transcribe again. A language set on the item does, and keeps the old file.
  - A render with Media Words missing transcribes them first, and a rendered frame shows caption ink over the media Segment. With the Captions switch off it shows none.
  - A failed transcription fails the render with the item's name. Retry clears it.
  - A render writes `.srt` and `.vtt` whose cues match the plan's Cues. A Job with captions off writes neither and queues no transcription.
  - The API refuses `captions` on a Source Segment, a `join` Cue Edit with other fields, and out-of-range shifts.
  - A Revision merge takes another editor's new Cue Edit and keeps ours.
- **MCP (prior art: the MCP suite):**
  - A dry run lists Cues with keys and statuses.
  - `merge_candidate_items` changes one field of a Cue Edit.
  - `set_media_language`, `get_media_words` and `get_captions` work end to end with the fake transcriber.
- **Editor (vitest; prior art: the Advanced Edit actions and keyed item tests):**
  - Split, Merge (with and without `join`), Delete, Reset timing and Reset position leave the expected Word Edits and Cue Edits.
  - Edge and body drags write the deltas and `shift`, clamped as the planner clamps.
  - Grips on a picked Cue write its Cue Edit; on the picked captions, the Style Override.
  - The Clipboard carries Cue Edits and media Word Edits.
  - A locked Captions Track refuses all of these.

## Out of Scope

- **Captions as Text Layers,** and a "Convert to Text Layers" action.
- **Captions from a typed script,** with or without alignment to the voice.
- **SRT or VTT import.**
- **Captions for Overlays and Music Clips,** and so for voiceover (#16) and TTS (#17) until a later feature adds them.
- **Per-Cue colours, fonts or other Caption Style fields** beyond place and size.
- **Auto-detected language,** and a choice of Whisper model per item.
- **Retiming single Words.**
- **Picking several Cues at once.**
- **Retiming or moving single Cues in the clip editor.**
- **Caption files without burned-in captions** (a Job with captions off writes none).

## Accepted additions

The code review of 2026-10-19 found behaviour that this spec didn't ask for. These additions are kept, as part of what the feature is:

- **`needs_join` on each Cue** (plan and dry run): whether a pause, a sentence's end or the longest Cue parts it from the Cue before, so that Merge adds a `join` only when one is needed without the editor repeating the planner's break rules.
- **`get_media_words(…, again, timeout_secs)`:** `again` transcribes ready Media Words again; `timeout_secs` bounds the wait (120 s by default).
- **`centre` and `size` per Cue in the dry run,** so the agent can place a Cue Edit's `x`, `y` and `scale` from where the Cue is.
- **Words status `none` also covers** a silent video and a video whose Media Words are neither saved nor queued yet.
- **A wider Whisper budget for whole Media Library items** (`TranscriptionTuning.media_budget_secs` and `media_budget_factor`: 120 s + 2.5 × length), since a cold model load on a busy Mac overran the Clip-range budget.
- **A Transcribe button** in a media Segment's inspector for a video whose Media Words aren't queued, beside Retry and Transcribe again.
- **Reset timing and Reset position keep a bare Cue Edit** that is all that starts its Cue (as after a Split), instead of dropping it.

## Further Notes

- Decided in a grilling session on 2026-10-18. See ADR 0020 and GLOSSARY: Media Words, Cue, Cue Edit, Caption Style, Word Edit, Segment, Pick, Clipboard, Grips.
- **A choice made while writing this spec, not in the grilling:** a failed Media Words transcription fails that Clip's render rather than rendering it without those captions. This follows the decision that a render waits for missing Media Words.
- Reference: `docs/referensi/concat/src/crates/concat/src/panes/captions.rs` (Concat's captions sheet: one title per Whisper segment, placement and size, sentence splitting of a script) and `concat-speech/src/transcribe.rs`. Use them for behaviour only.
- **Templates (#21)** will carry Word Edits and Cue Edits of intro and outro media Segments. Media Words being global makes that cheap.
