# 0020: Media items carry their own Words; captions stay planned, edited by Cue Edits

Status: accepted
Date: 2026-10-18

Builds on 0002 (Word Edits stay on the Source's timeline; the planner maps them into each Segment) and 0009 (Speed retimes a Source Segment's Words; a reversed one has none).

## Context

The `captions-advanced` feature (roadmap #18, `.scratch/advanced-edit-v2/roadmap.md`) asks for captions at parity with Concat and beyond:
- captions for the voice of any clip, not only the Source;
- retiming one caption and moving one on its own;
- phrase or sentence captions;
- SRT and VTT.

Today:
- **Only Source Segments have captions.** Each Source range is transcribed again (±2 s) and cached per range in the Job. Media Segments get no Words.
- **Captions are planned.** The planner breaks Words into one-line events by the Caption Style's line limits and the Word Edits. Nothing about a single event is stored.
- **Concat makes captions differently.** Each Whisper segment becomes an ordinary text title. The titles are free to edit, but they have no word timing and no link to the clip they came from, and there is no style shared between them.

`.scratch/advanced-edit/spec.md` lists "Transcribing uploaded videos for captions" as Out of Scope.

## Decision

- **Captions stay planned from Words, on one Captions Track.** They are not turned into Text Layers. The per-Word highlight, the Caption Style, Style Presets, Word Edits and the agent all keep working, and a later Template keeps them.
- **A video in the Media Library has Media Words.**
  - Its whole sound is transcribed once. Videos are at most 180 s.
  - The result is kept beside the item, keyed by language and model: `media/<id>.words/<language>-<model>.json`, in seconds of the item.
  - Every Segment, Candidate and Job that shows the item reads it. Trimming or splitting never transcribes again.
  - The language is the item's own (`MediaItem.language`) if set, else the Job's. Changing it transcribes again; the old file stays for its language.
  - Transcription starts by itself in the background when the Advanced Edit opens or a media Segment is placed. A render waits for any that is missing. This also prepares Source Segments that have no Words yet.
- **Only media Segments are captioned from Media Words.**
  - Each has a Captions switch, on by default. An empty field means on.
  - A media Segment follows the Source's rules: Speed retimes its Words, Reverse and a Freeze frame have none, and Cues break at joins.
  - Overlays and Music Clips are never captioned.
- **Corrections belong to the Candidate, keyed on the item's timeline.**
  - A Word Edit gains `media`. Its `at` is then a time on that item's timeline.
  - It applies in every Segment of the Candidate that shows that time, as a Source Word Edit does.
- **A Cue is one block shown at once, of one to three lines** (Caption Style `max_lines`, 1 by default). It is what an SRT or VTT cue is. A Word Edit's new line starts a new Cue when its Cue has all its lines, so every saved Candidate plans as before.
- **A Cue Edit changes one Cue.**
  - It is keyed as a Word Edit is: by the time of its first Word, with `media` for an item. That Word starts a Cue.
  - It holds shifts of the Cue's start and end, in seconds of that timeline, so they scale with Speed. It also holds its own place, and a size as a scale of the Caption Style's.
  - Or, instead, it holds `join`, which keeps the Cue with the one before it where only a pause, a sentence's end or the longest-Cue limit would part them. The characters and lines per Cue still apply.
  - While its Word isn't shown, the Cue Edit does nothing and is kept.
  - Retimed Cues are clamped by their neighbours and their Segment.
- **SRT and VTT are exported, not imported.**
  - Every render writes `.srt` and `.vtt` beside the MP4 from the planned Cues.
  - Each file has one cue per Cue, keeping its lines. The text has the Word Edits applied, but not the Caption Style's case or its stripping.
  - A Job with captions off gets neither.

## Considered options

- **Captions as Text Layers, as Concat makes them.** Each would be free to edit, but a Text Layer has no Word timing, so the per-Word highlight would be lost. So would the shared Caption Style and Presets, the Word Edits, and regeneration without duplicates. "Convert to Text Layers" was also turned down for now.
- **Transcribing each media Segment's range, as Source Clips are.** Every trim would change the key and transcribe again. Media items are short, global and reused across Jobs, so one transcription per item is cheaper and stable.
- **Corrections to Media Words kept on the item, for every Candidate.** This would suit a branded intro used everywhere. But those corrections would sit outside the Candidate's Revisions, undo and merge. Templates can carry the Word Edits instead.
- **Auto-detected language.** One cache per item, but Whisper guesses from the first 30 s and is often wrong on short or mixed clips. The Job already states its language.
- **Freezing an edited Cue into fixed lines and times.** Simple to retime, but the Cue would no longer follow the Caption Style's line limits or the Word Edits. Keying by its first Word keeps it planned and stable when the limits change.
- **Retiming Words one by one** (start and end on each Word Edit). It is finer than anyone asked for, and a Cue's ends would hang on two separate edits.

## Consequences

- **Overturns the Out of Scope line on transcribing uploaded videos** in `.scratch/advanced-edit/spec.md`, for media Segments only.
- **A Whisper run per new video item, per language.** It is queued on the one Whisper worker, and its status shows on the Segment. A failure offers Retry.
- **Captions on a saved Candidate can appear without anyone editing it.** A media Segment with talking in it gains Cues once its Media Words exist, because the Captions switch defaults to on.
- **The Pick gains a Cue.** A picked Cue can be split at the playhead, merged with the next one, have its Words removed (Delete) or retyped, and be moved and scaled on the preview. With the captions picked, a drag moves them all as before.
- **The clip editor draws Cues, and its Caption Style panel gains `max_lines`, Phrase and Sentence.** Retiming and moving one Cue happen only in the Advanced Edit.
- **The Clipboard brings Cue Edits with Segments,** as it brings Word Edits.
- **The agent reaches all of it:**
  - `word_edits[].media`, `cue_edits` and `segments[].captions` in `edit_candidate`, `merge_candidate_items` and `remove_candidate_items`;
  - Cues and per-Segment Words status in a dry run;
  - `set_media_language`, `get_media_words` and `get_captions` (srt or vtt);
  - caption files in `list_clips`.
- **Not now:**
  - SRT import;
  - captions from a typed script;
  - captions for Overlays and Music Clips (and so for voiceover and TTS until those land);
  - per-Cue colours or fonts.
