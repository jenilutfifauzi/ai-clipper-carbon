# Hook Styles: shapes, Emphasis, Kicker and Quote Mark

Status: ready-for-agent
Created: 2026-10-14

## Problem Statement

The hook is always the same thing: one rounded box, centred, at most 2 lines, in one colour. Indonesian clipper accounts use richer hook looks (references collected in the grilling session):
- **Highlighter strips:** black capitals on white strips, one strip per line, left-aligned, with a green quote badge on the corner.
- **Headline card:** a white card of condensed capitals with key words in red, 4 lines in the lower half.
- **Quote card:** a white card in sentence case with a green quote badge on its corner.
- **Kicker over bare text:** a yellow pill ("TERBONGKAR!!!!") over white capitals with no box, left-aligned.

I can't make any of these. The Style panel's hook section is also 11 controls in a row with no grouping. And when the AI writes an emoji in a hook, libass can't draw it.

## Solution

- **Hook Style** gains:
  - a **Hook Shape**: one block, a strip per line, or no box;
  - left or centred alignment, up to 4 lines, optional capitals, outline and shadow;
  - an **Emphasis** colour, a **Quote Mark**, and colours for the **Kicker**.
- **Hook text** may mark Emphasis with `*asterisks*`.
- **Candidate** gains an optional **Kicker**: a short label in a pill above the hook.
- **The AI** writes the hook with 1–3 emphasised words and proposes a Kicker. It never writes emoji. Emoji are also stripped from hook text when it is planned.
- **Entrance animations** run line by line (Kicker first) with an 80 ms stagger.
- **Four new built-in Presets** reproduce the references.
- **Style panel's hook section:** a Shape picker of thumbnail cards, then grouped controls under subheadings.
- **HookEditor:** a Kicker field and an "Emphasis" button (Cmd/Ctrl+B).

## User Stories

### Shape and text
1. As a podcaster, I want to choose the hook's Shape (one block, a strip per line, or no box), so that I can follow the looks that work on TikTok.
2. As a podcaster, I want to left-align or centre the hook's lines, so that strip and bare-text looks read like the references.
3. As a podcaster, I want to allow the hook up to 4 lines, so that a longer headline isn't shrunk.
4. As a podcaster, I want the hook in capitals or as written, so that I don't retype it to change case.
5. As a podcaster, I want an outline and shadow on the hook's text, so that a hook with no box stays readable over the video.

### Emphasis
6. As a podcaster, I want to mark words of the hook to show in an Emphasis colour, so that the key claim pops.
7. As a podcaster, I want to select words and press an Emphasis button or Cmd/Ctrl+B, so that I don't type asterisks by hand.
8. As a podcaster, I want the AI to mark 1–3 key words of its hooks, so that a new Candidate already looks finished.

### Kicker and Quote Mark
9. As a podcaster, I want an optional Kicker in a coloured pill above the hook, so that I can label the clip ("TERBONGKAR!").
10. As a podcaster, I want the AI to propose a Kicker, so that I only edit it.
11. As a podcaster, I want a Quote Mark badge on the hook's corner, so that a hook that quotes the speaker looks like a quote.

### Motion
12. As a podcaster, I want the hook's entrance to run line by line, Kicker first, so that it feels produced.

### Presets and panel
13. As a podcaster, I want built-in Presets for the four reference looks, so that I can start from one.
14. As a podcaster, I want the hook section grouped, with the Shape chosen from pictures, so that I can find a control quickly.
15. As a podcaster, I want controls that don't apply to the current Shape hidden, so that the panel only shows what changes something.

### Rendering
16. As a podcaster, I want the preview and the Clip to agree on all of the above, so that I don't render to check.
17. As a podcaster, I want a Clip marked changed when the Kicker changes, so that I know to render again.
18. As a podcaster, I want existing Candidates and Presets to look exactly as before, so that nothing I've reviewed changes under me.

## Implementation Decisions

ADR 0001 still holds. The planner decides every box, line, run and size. The renderer (libass) and `ClipPreview` only draw them.

### HookStyle fields (all defaulting to v1's look)

| Field | Values | Default |
|---|---|---|
| `shape` | `block`, `strips`, `none` | `block` |
| `align` | `center`, `left` | `center` |
| `max_lines` | 1–4 | 2 |
| `uppercase` | bool | `false` (as written) |
| `outline`, `outline_colour` | 0–20 px, Colour | 0, `#000000` |
| `shadow`, `shadow_colour` | 0–20 px, Colour | 0, `#000000` |
| `emphasis_colour` | Colour | `#FFE600` |
| `quote`, `quote_colour` | bool, Colour | `false`, `#22C55E` |
| `kicker_colour`, `kicker_box_colour` | Colour | `#000000`, `#FFE600` |

Notes:
- `box_opacity: 0` still draws no box in any Shape, so saved Presets keep working.
- `uppercase` was not asked about in the grilling session. It is added because the references mix capitals and sentence case and the hook had no case field.

### Hook text and Emphasis
- **Markup.** Emphasis is stored in `Candidate.hook_text` as `*run*`, and a run may span words. An unpaired `*` is shown as written. `HOOK_MAX_CHARS` (200) counts the stored text, markup included.
- **Planning.** The planner parses the markup into runs `(text, emphasised)`. Emoji (Unicode `Extended_Pictographic` and variation selectors) are removed before fitting. `uppercase` is applied after parsing.

### Line fitting (`fit_hook`)
- Choose the split into at most `max_lines` lines, between words, whose widest line is narrowest.
- One line is preferred when it fits; otherwise the fewest lines that fit, balanced. When even `max_lines` lines are too wide, the font is set smaller, as now.
- With `max_lines` 2 this matches v1's behaviour exactly.

### HookEvent (what the plan carries)
- `lines`: a list of lines, each a list of runs `(text, emphasised)`.
- `line_boxes`: one Box per line: the line's own width plus padding for `strips`, or the shared block for `block`.
- `area`: the whole hook, Kicker and Quote Mark included, so position and the Timeline keep using one Box.
- `kicker`: `None`, or `(text, box, size)`. The size is 0.55 × the hook's set size. It sits one line, above the first line, aligned like the hook, with a gap of 0.25 × the hook's size.
- `quote`: `None`, or the badge's Box, placed half outside the top-left corner of the first box. With Shape `none` it uses the first line's text box.
- **Alignment.** `left` aligns lines and strips to the left edge of the widest line's box. The whole hook stays centred in the frame.

### Drawing
- **Renderer:**
  - Lines are drawn run by run: `\c` switches to `emphasis_colour` and back.
  - `strips` draws one rounded box per line.
  - `none` draws no box. Outline and shadow use `\bord` / `\shad` on the text layers (Style line fields stay v1's when they are 0).
  - The Quote Mark is a rounded-square badge in `quote_colour` with two white quote marks, as an ASS vector drawing.
  - The Kicker is a pill (radius = half its height) in `kicker_box_colour` with text in `kicker_colour`.
- **Preview.** `ClipPreview`'s `Hook` draws the same boxes, runs, badge and pill at the planned Boxes.

### Stagger
- When `animation_in` isn't `none`, elements come on in order: Kicker, then each line together with its strip (`strips`), each `HOOK_STAGGER_MS` = 80 ms after the previous one.
- With `block`, the box comes on with the first line. The Quote Mark comes on with the first box.
- The exit is not staggered. `_hook_phases` / `hookLook` gain a per-element offset. With one element (no Kicker, one line) or `animation_in: none`, the output is v1's.

### Kicker on the Candidate
- `Candidate.hook_kicker: str = ""`. It holds at most 24 characters, whitespace collapsed, and emoji are stripped when planned.
- **API.** PATCH takes `hook_kicker`, and a change marks the Candidate edited. `preview-plan`'s draft takes it too.
- **Staleness.** `RenderedClip` records `hook_kicker`, and the Clip card compares it like `hook_text`. Old `clips.json` files without it read as `""`.

### Hook fit check
`GET /api/hook` is replaced: `HookEditor` reads fit from the Preview Plan, where the hook doesn't fit when `hook.size < hook_style.size`. That accounts for the Candidate's style, `max_lines` and markup. Remove the endpoint if nothing else uses it.

### AI
- **`ClipProposal`:**
  - `viral_hook_text` may contain `*Emphasis*` on 1–3 key words (the claim, number or name);
  - new `hook_kicker`: 1–2 words, at most 24 characters, or empty.
- **Prompt.**
  - The HOOK PLAYBOOK says "at most 2 short lines" now. With `max_lines` per style, keep the ~40 characters guidance.
  - Add Emphasis and Kicker rules (Kicker patterns: "TERBONGKAR!", "FAKTA", "POV", or empty when none fits).
  - Forbid emoji in both.
- **`selection.py`.** Normalises `viral_hook_text` and `hook_kicker` (whitespace, length).
- **Existing Candidates** are not re-run. They keep an empty Kicker and no Emphasis.

### Built-in Presets

| Id | Caption | Hook |
|---|---|---|
| `quote-strip` | Montserrat ExtraBold | `strips`, `left`, white box at 1.0, black text, `uppercase`, `quote` on (green), top |
| `headline-red` | Anton | `block`, radius 0, white box, black text, `emphasis_colour` red `#E11D2E`, Anton, `uppercase`, `max_lines` 4, `left`, custom y ≈ 1100 |
| `quote-card` | Poppins Black, sentence case | `block`, radius 0, white box, black text, Poppins Black, as written, `quote` on (green), centred, custom y ≈ 1150 |
| `kicker-bare` | Montserrat ExtraBold | `none`, white text, shadow 4, `uppercase`, `max_lines` 4, `left`, Kicker yellow pill with black text, middle |

Exact sizes and heights are tuned against the reference screenshots in the ticket.

### Style panel (frontend, built with the emil skills)
- **Hook section:**
  1. **Shape:** three radio cards (native `<input type="radio">`, visible focus ring). Each holds a small SVG thumbnail drawn in the current style's box and text colours.
  2. **Text:** font, size, text colour, Emphasis colour, capitals, lines (1–4), alignment.
  3. **Box and decoration:** box colour, opacity, radius (hidden for `none`), outline, shadow, Quote Mark (toggle and colour), Kicker colours.
  4. **Position.**
  5. **Animation.**
- **Rules for the panel:**
  - Subheadings, not accordions: everything stays visible.
  - Override markers work for every new field as for the old ones.
  - Hidden controls keep their values.
- **HookEditor:**
  - A Kicker input above the hook textarea, with a counter to 24.
  - The textarea keeps `*markup*`. An "Emphasis" button and Cmd/Ctrl+B wrap the selection in `*`, or unwrap it when it is already wrapped.
  - The fit warning comes from the Preview Plan.

## Testing Decisions

- **Seam B (planner):**
  - Default styles reproduce v1 plans exactly, so existing tests pass unchanged.
  - New tests cover:
    - markup parsing (spanning runs, unpaired `*`);
    - emoji stripping;
    - fitting into 3 and 4 lines;
    - `strips` line boxes, `left` alignment, the Kicker and Quote Mark placement, and `area` enclosing them.
- **Renderer:** ASS text checks for Emphasis `\c` switches, strip boxes, Shape `none` with outline and shadow, the Quote Mark drawing, the Kicker pill, and staggered starts. The v1 fixture stays byte-identical.
- **Seam A (HTTP):**
  - `hook_kicker` PATCH and its validation;
  - a draft Kicker in `preview-plan`;
  - each new built-in Preset listed and undeletable;
  - a render whose plan file holds a Kicker and Emphasis.
- **Selection:** a fake LLM proposal with markup, a Kicker and an emoji is normalised as specified.
- **Frontend:** `npm run typecheck` and `npm run build`. A browser walkthrough of each user story, comparing each new Preset's preview with its libass render and its reference screenshot.

## Out of Scope

- Colour emoji rendering (Twemoji overlays): emoji are stripped instead.
- Speaker name tags (lower thirds that identify who is talking, with their own timing). This is a separate feature.
- Icons other than the Quote Mark.
- A wipe animation for strips, staggered exits, and a configurable stagger.
- A separate font or size for the Kicker.
- Re-running the AI on existing Candidates.
- Right alignment.

## Further Notes

The vocabulary is in `GLOSSARY.md` (Hook Shape, Emphasis, Kicker, Quote Mark). This spec extends `.scratch/clip-editor/spec.md` and supersedes its out-of-scope line "keyword colouring" for the hook only. Captions still have no keyword colouring.
