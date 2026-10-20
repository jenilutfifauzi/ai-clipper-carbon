# 01: Prefactor: the captions become Cues in the Render Plan

**Parent spec:** `../spec.md` (Implementation Decisions "Planning Cues", "Rendering"); docs/adr/0020-media-words-and-cue-edits.md.

**What to build:** a prefactor that changes no pixel and no caption time.

Today the plan's captions are one-line events: a text, times, the Words, an area and a size. The renderer, the preview in both editors and the agent's dry run all read that shape.

Give each caption the shape of a **Cue** (GLOSSARY):
- its shown `start` and `end`;
- its `lines`, each a list of Words (display text and times). Today there is always one line.
- its `plain` lines: the Words' text after Word Edits, without the Caption Style's case or its end-punctuation and emoji stripping;
- its area and size;
- its `key`: the middle of its first Word on its timeline (`at`) and `media` (always empty for now);
- `edited` (always false for now) and `joinable` (whether merging it into the previous Cue fits the line limits; computed now, so later tickets only read it).

The renderer and the preview draw a Cue line by line. With one line, that is exactly what they draw today.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Every existing backend and frontend test passes unchanged, apart from renames.
- [x] A Candidate with captions in each highlight mode (colour, box, none), custom-positioned, tracked and shrunk-to-fit, renders byte-identical frames before and after (compare frames at several times).
- [x] The preview in the Advanced Edit and in the clip editor shows the same captions as before, and the caption lines on both Timelines are unchanged.
- [x] A dry run lists each Cue with its times, lines, plain text and key. The plain text keeps the Words' case and punctuation, with Word Edits applied.
- [x] The planner tests cover `plain` and `key`, and `joinable` for a pair that fits and a pair that doesn't.

## Comments

**2026-10-18, agent:** Built. The seam:
- **Planner** (`app/planner.py`): `CaptionEvent` became `Cue` (`start`, `end`, `lines` of `CaptionWord`, `plain`, `area`, `size`, `key`, `edited`, `joinable`; `words` and `text` are read-only conveniences, not in the JSON), keyed by `CueKey` (`at`, `media`). `_captions` takes each Word's middle on the Source's timeline (`plan_render` gives `start` + the middle for one range; `_segment_words` gives the Segment's range start + the middle, whatever its Speed), so `key.at` is what `PreviewWord.at` and a Word Edit's key already are. `plain` is the Word's text or its Word Edit's, stripped of nothing but whitespace. `joinable` is false for the first Cue and across a cut or an area change (`parted`, shared with the breaking rules), else whether the two fit one line (`_fits`: `max_chars` and `max_words`). Ticket 03 widens `_fits` to `max_lines`. A Cue moved at a Layout change stays two plan entries in two places with one key (as before: two events); later tickets that pick or export by key should treat them as one Cue.
- **Renderer**: `_caption_events` joins a Cue's lines with `\N` and counts the highlighted Word across them; `_highlight_box` finds the Word's line and puts it one font size per line about the area's middle. With one line the ASS is unchanged byte for byte.
- **Dry run** (`mcp_server.py`, `_cue_view`): each Cue's `start`, `end`, `lines` (as shown), `plain` and `key` (`at` to 3 decimals; `media` only when set).
- **Preview**: `Cue`/`CueKey` in `api.ts`; `editor/cues.ts` (`cueWords`, `cueText`, `cueWordAt`, `cueLineMiddle`). `ClipPreview` draws a Cue line by line (`CaptionLines`/`CaptionLine`, the highlight box per line) and grabs the widest line; the Tracks and the clip editor Timeline show `cueText`; `lineWords`, `InlineText` and `CaptionTextEditor` read the Cue's Words.

Checked: a Candidate's captions in colour, box and no highlight, custom-positioned, tracked (with a blurred drop shadow), shrunk-to-fit, each as one range (with Layout Overrides that move a Cue, Word Edits and a break) and as two Segments (one at 1.5x): 12 renders, 132 frames at 11–12 times each, byte-identical before (HEAD) and after, with the same ASS scripts. (Frames were compared with single-threaded ffmpeg: renders of one plan with ffmpeg's default threading differ in a few frames run to run, before and after alike.) The built-in Presets' plans still match `builtin_preset_plans.json` (its test now projects each Cue to the old line shape). The HTTP tests that read a plan's caption `text` and `words` now read them through `cue_text` and `cue_words` (conftest). New tests: Cue lines and keys (one range, a Clip's start cutting a Word, a Cue moved at a Layout change, a sped Segment), `plain` with Word Edits and either case, `joinable` for pairs that fit and don't (max_chars, max_words, a cut, a Layout change) in test_planner.py; the dry run's Cues in test_mcp.py; `cues.test.ts`. Backend 826 passed (five timing tests that failed once under a loaded machine pass on a rerun); frontend 854 passed (after merging main); tsc clean; build clean.
