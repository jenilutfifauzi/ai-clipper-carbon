# Clip Editor: caption text and style, hook, and timeline

Status: ready-for-agent
Created: 2026-10-14

## Problem Statement

Review lets me change a Candidate's range (by clicking Words), its hook text, and one Layout for the whole clip. Everything else about how a Clip looks is fixed in code:
- **Caption look.** White uppercase Montserrat ExtraBold, a black outline, the spoken Word in orange, the lower third or Split's seam.
- **Caption line breaks.** At most 16 characters or 1.4 s per line.
- **Caption text.** Whatever Whisper heard, including misheard words and names.
- **Hook look and placement.** A dark box at the top for the first 3 s. In Split it covers the top speaker's face.

I also only see any of this after a render, which takes a minute per clip on my M1. To fix a typo or try another colour I render, watch, edit and render again.

## Solution

A clip editor in Review, built around a live 9:16 preview of the Candidate:
- **Live preview.** The Source is framed the way the Render Plan frames it, with the captions and hook drawn over it in the browser as I edit. The final Clip is still burned by libass.
- **Text editor.** I can:
  - fix any Word of the captions, or delete it;
  - force a line break before a Word;
  - set how lines are broken (characters, Words and seconds per line);
  - style the captions: font, size, colours, outline, shadow, case, highlight and position.
- **Style Presets.** Global, saved for every Job. Each Candidate uses one and may override any of its fields; I can save a Candidate's look as a new Preset.
- **Hook.** Style (font, size, colours, box), position (top, middle, bottom, custom), timing (start and duration), and an entrance and exit animation (fade, pop, slide).
- **Timeline** under the preview, with four tracks:
  - the clip's range, with trim handles that snap to Words;
  - its Scenes, coloured by Layout, each with its own Layout override;
  - its caption lines;
  - the hook, dragged to move it and resized to change how long it shows.

## User Stories

### Preview
1. As a podcaster, I want to see a Candidate as a 9:16 clip with its captions and hook while I edit, so that I don't render to check a change.
2. As a podcaster, I want the preview to follow the Render Plan's framing (Track, Split, Blur), so that I judge text placement against what the Clip will show.
3. As a podcaster, I want to be told when the preview uses the episode Transcript's Words or a single Scene because the clip hasn't been transcribed or analysed yet, and to start that work with one click, so that I know how close the preview is.

### Caption text
4. As a podcaster, I want to correct a misheard Word or name in the captions, so that the Clip doesn't show a typo.
5. As a podcaster, I want to delete a Word (a filler, a stutter) from the captions, so that they read cleanly.
6. As a podcaster, I want to start a new caption line at a Word of my choice, so that a phrase isn't split awkwardly.
7. As a podcaster, I want my text edits to survive a small change to the clip's range and a re-transcription, so that trimming doesn't throw away my corrections.

### Caption style
8. As a podcaster, I want to choose the captions' font from a set of bundled fonts, so that clips match my brand.
9. As a podcaster, I want to set the size, text colour, highlight colour, outline width and colour, shadow, and upper or original case, so that captions look the way I want.
10. As a podcaster, I want to choose how the spoken Word is highlighted (colour, a box behind it, or none), so that I can follow trends.
11. As a podcaster, I want to place captions automatically (by Layout), at the top, middle or bottom, or at a custom height, so that they don't cover faces.
12. As a podcaster, I want to set the most characters, Words and seconds per caption line, so that I control the rhythm.

### Presets
13. As a podcaster, I want named Style Presets shared by all my Jobs, so that I set my look once.
14. As a podcaster, I want each Candidate to use a Preset and override single fields of it, so that one clip can differ without a new Preset.
15. As a podcaster, I want to see which fields a Candidate overrides and reset them, so that I can return to the Preset.
16. As a podcaster, I want to save a Candidate's resolved look as a new Preset, or update its Preset with it, so that good experiments become reusable.
17. As a podcaster, I want built-in Presets, including one that is today's look, that I can't delete, so that I always have a working default.

### Hook
18. As a podcaster, I want to style the hook (font, size, text colour, box colour and opacity, corner radius), so that it matches the captions.
19. As a podcaster, I want to place the hook at the top, middle, bottom or a custom height, so that it doesn't cover a face in Split.
20. As a podcaster, I want to set when the hook appears and how long it stays, so that it lands on the right moment.
21. As a podcaster, I want an entrance and exit animation for the hook (none, fade, pop, slide), so that it feels produced.

### Timeline
22. As a podcaster, I want a timeline of the clip with a playhead synced to the preview, so that I can scrub and see where things happen.
23. As a podcaster, I want to drag the clip's start and end on the timeline, snapping to Words, with some of the episode around it shown, so that trimming is quicker than clicking Words.
24. As a podcaster, I want to see the clip's Scenes coloured by Layout and change one Scene's Layout, so that one bad wide shot doesn't force a Layout on the whole clip.
25. As a podcaster, I want to see the caption lines on the timeline and click one to edit its Words, so that I can find a line quickly.
26. As a podcaster, I want to drag and resize the hook on the timeline, so that timing it is direct.

### Rendering
27. As a podcaster, I want every edit above used by the next render, so that the Clip matches the preview.
28. As a podcaster, I want a rendered Clip marked as changed when any of these edits differ from its render, so that I know to render it again.

## Implementation Decisions

### The backend plans, the frontend draws
See `docs/adr/0001-backend-plans-frontend-draws.md`. Line breaking, hook fitting and per-Scene Layout stay in `app/planner.py`. A new endpoint returns the Render Plan for a Candidate (and optionally an unsaved draft of its edits), and the frontend only draws it. No layout logic is duplicated in TypeScript. The preview may differ from the Clip in sub-pixel text rendering (browser against libass), but never in line breaks, timing, position or Layout.

### Styles
- `app/styles.py` holds `CaptionStyle` and `HookStyle`. They are frozen dataclasses whose defaults are today's constants, so the built-in **Default** Preset renders byte-identically to v1.
- **CaptionStyle:**
  - font, size, colour, active colour, outline width and colour, shadow, uppercase;
  - highlight (`colour`, `box`, `none`);
  - position (`auto`, `top`, `middle`, `bottom`, `custom` with a y);
  - line breaking: max characters, max Words (optional), max seconds, pause seconds.
- **HookStyle:**
  - font, size, colour, box colour, box opacity, radius;
  - position (`top`, `middle`, `bottom`, `custom` with a y);
  - animation in, animation out (`none`, `fade`, `pop`, `slide`), and animation length in ms.
- **Style Preset:** an id, a name, a CaptionStyle, a HookStyle, and `builtin`. Presets are kept in `DATA_DIR/presets.json` by a `PresetStore`, like the Channel Profile. Built-in Presets are defined in code, listed first, and can't be changed or deleted.
- **Candidate:**
  - `preset_id` (default `"default"`);
  - `style_overrides`: a partial `{caption: {...}, hook: {...}}`. The resolved style is the Preset with the overrides applied, validated as a whole.
  - A Candidate whose Preset was deleted falls back to Default.

### Caption text edits are keyed by time
- Words are re-transcribed per range (`words/<ms>-<ms>.json`), so edits can't refer to a Word by index.
- A **Word Edit** is `(at, text, break_before)`, where `at` is seconds on the Source's timeline. It applies to the Word whose span holds `at`; if none holds it, to the nearest Word within 0.25 s.
  - Empty text removes the Word.
  - `break_before` starts a new line at that Word.
- Edits outside the clip's range are kept, but do nothing.

### Hook timing
`Candidate.hook_start` (seconds into the Clip, default 0) and `hook_secs` (default None, meaning 3 s). Both are clamped to the Clip.

### Layout per Scene
- **Layout Override:** `(at, layout)` with `at` on the Source's timeline. It replaces the Layout of the planned Scene that holds `at`.
- `Candidate.layout` stays as the default for every other Scene.

### Fonts
- Six SIL OFL fonts are bundled in `backend/assets/fonts/`: Montserrat ExtraBold (already there), Anton, Bebas Neue, Poppins Black, Inter ExtraBold, and Bangers.
- `app/fonts.py` maps a font id to its file and the family name libass matches.
- `font_metrics(font_id)` measures any of them.
- The browser loads the same files from `GET /api/fonts/{id}`.

### Preview Plan and preparation
- `POST /api/jobs/{job}/candidates/{id}/preview-plan` takes an optional draft of the Candidate's style, Word Edits, hook text and timing, and Layout Overrides. It returns:
  - the Render Plan;
  - the clip's Words (with edits marked);
  - `words_source` (`clip` or `transcript`);
  - `analysed`.
- **Without cached clip Words**, the episode Transcript's Words in the range are used. They are shifted to the Clip's timeline, as `_words` does.
- **Without a cached analysis**, the clip is one Scene, framed by the Layout (Auto as Track in the middle).
- `POST /api/jobs/{job}/candidates/{id}/prepare` queues the Candidate's transcription and analysis without an encode. It runs on the render worker, one at a time with renders. While it runs the Job is `rendering`, as for a render.

### Staleness
`RenderedClip.inputs` records a hash of everything the render used. A Clip is changed when the Candidate's current hash differs.

## Testing Decisions

- **Seam B** (pure planner):
  - Default styles reproduce v1 plans exactly. All existing tests pass unchanged.
  - New tests cover line breaking by characters, Words and seconds, `break_before`, edited and removed Words, uppercase off, caption positions, hook positions and timing, and Layout Overrides.
- **Renderer:** the ASS script for the highlight box, the shadow, a non-default font, and each hook animation, checked as text.
- **Seam A** (HTTP):
  - Preset CRUD, including refusing to delete or change a built-in Preset.
  - The new `PATCH` fields.
  - `preview-plan` with and without cached Words and analysis.
  - `prepare`.
  - A render that uses a non-default Preset, a Word Edit and a hook timing (the plan file holds them).
- **Frontend:** `npm run typecheck` and `npm run build`, plus a browser walkthrough of each user story.

## Out of Scope

- Uploading fonts.
- Manual crop positioning (moving a Track crop or Split panel by hand).
- Per-Word animation (bouncing or popping Words), emoji, and keyword colouring.
- Free text tracks other than the captions and the hook.
- Editing caption timing (Word start and end).
- Editing AI titles and descriptions (still copy-only).

This spec supersedes two v1 out-of-scope lines (`.scratch/ai-clipper-v1/spec.md`): "Manual caption-text editing" and "Selectable caption style presets". Manual crop positioning stays out.

## Further Notes

The vocabulary is in `GLOSSARY.md`.
