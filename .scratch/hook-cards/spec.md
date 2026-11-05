# Hook Cards: bordered boxes and a Quote Mark on top

Status: ready-for-human
Created: 2026-11-05

## Problem Statement

Indonesian clipper accounts frame their hook as a card, and the Hook Style can't draw these references:
- **Framed blue:** white sentence-case text on a blue rounded card with a thick yellow border.
- **Red quote card:** black capitals with key words in pink on a white card with a red border, and a red quote badge centred on its top edge.
- **White card:** black left-aligned capitals on a plain white card.

The hook's box has no border, and the Quote Mark only sits on the top-left corner. The channel-name labels in the references are out of scope, as are emoji (ADR 0010).

## Solution

- **Hook Style** gains a **Hook Border** (`border`, 0–20 px, and `border_colour`). It is drawn just inside the edge of the block or of each strip, and the padding grows by the same width. It does nothing with no box.
- The **Quote Mark** gains `quote_place`. `corner` is the default. `top` centres the badge on the first box's top edge, and the box's padding above the text grows to clear it. With no box, it centres the badge above the text.
- Three built-in **Style Presets**, one per reference: `framed-blue`, `red-quote-card` and `white-card`.
- The editor's Hook Style panel gets Border and Border colour controls under Box, and a Corner / Top middle choice for the Quote Mark.

## Implementation notes

- `backend/app/planner.py`: `hook_border()` adds the border to `_hook_padding()` and to `fit_hook()`. `_hook()` places a top Quote Mark.
- `backend/app/renderer.py`: `_hook_events()` draws a bordered box as a fill inset by the border, plus a ring (`reversed_drawing` hole) in the border colour.
- `backend/app/ass.py`: `moved_drawing()` was moved here from `layer_pictures.py`.
- `frontend/src/pages/job/editor/ClipPreview.tsx`: the preview draws the inset fill and a stroked rect, matching the ring.
- The existing presets' plans and ASS are unchanged (`tests/fixtures/builtin_preset_plans.json` only gains the new presets).
