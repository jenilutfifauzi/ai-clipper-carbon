# Watermark: text or a Logo over every Clip

Status: done
Created: 2026-10-14

## Problem Statement

Clips go out with no mark of who made them. Clipper accounts brand every Short with their handle or logo in a corner, so that a reposted Clip still points back to them. I can only add one after exporting, by hand, in another editor.

## Solution

- **Style Preset** gains a third part, the **Watermark Style**, beside the Caption Style and the Hook Style. It is saved with "Save as new" and "Update", can be overridden per Candidate like any other field, and a Clip rendered before a change is out of date.
- **A Watermark** is off (the default), a line of **text** (font, colour, thin outline), or a **Logo**.
- **Logos** are uploaded once (PNG, JPEG or WebP, up to 5 MB) into a library kept for every Job, and picked again from it.
- **Place:** one of nine places in the safe area (a 3x3 grid), or anywhere: dragged on the preview, or nudged with the arrow keys.
- **Size** (its height in output pixels) and **opacity**.
- The editor gets a **Watermark** tab.

## User Stories

1. As a clipper, I want my handle on every Clip, so that a repost still credits me.
2. As a clipper, I want my logo instead of text, so that Clips carry my brand.
3. As a clipper, I want to upload my logo once and pick it again, so that I don't upload it per Clip.
4. As a clipper, I want to put the Watermark in a corner with one click, so that placing it is quick.
5. As a clipper, I want to drag it anywhere on the preview, so that it sits clear of the speaker's face.
6. As a clipper, I want to set its size and opacity, so that it is visible but doesn't distract.
7. As a clipper, I want it saved in my Preset, so that every Clip in that Preset gets it.
8. As a clipper, I want the preview to show it where the render will burn it.

## Implementation Decisions

### Model (`backend/app/styles.py`)

- `WatermarkStyle`: `kind` (`none | text | logo`, default `none`), `text`, `font`, `colour`, `outline`, `logo` (a Logo id), `position` (nine places or `custom`), `x`/`y` (its centre for `custom`), `size` (24–480 px: the Logo's height, or the text's libass font size), `opacity` (0.05–1).
- `StylePreset.watermark` and `StyleOverrides.watermark`; `resolve()` gives `Styles(caption, hook, watermark)`. Presets and Candidates saved before have the default, off.

### Logos (`backend/app/logos.py`)

- `LogoStore` in `DATA_DIR/logos/` (not `uploads/`, which is emptied at start-up): `<id>.png` each and `logos.json`.
- An upload is converted by ffmpeg to an RGBA PNG at most 1080 px on its longest side; its size is read with ffprobe. No new dependency.
- `GET/POST /api/logos`, `GET/DELETE /api/logos/{id}`. A Preset or an override naming a Logo that doesn't exist is refused (422). A Logo deleted later just shows no Watermark, and doesn't block other edits.

### Planner

- `WatermarkEvent(kind, area, opacity, text, size, logo)` and `RenderPlan.watermark` / `watermark_style`.
- At the nine places it sits `WATERMARK_MARGIN` (32 px) inside `SAFE_AREA`; the middle column is centred in the frame like the captions. `custom` centres it on (x, y), kept inside the frame.
- Text is measured with the font's metrics and set smaller if wider than the frame. A Logo keeps its aspect.

### Renderer

- Text: one ASS event (style `Watermark`) first in the script, under the captions and the hook, with `\alpha` for its opacity.
- Logo: a second ffmpeg input, `scale` + `colorchannelmixer=aa=` + `overlay` onto the joined frames before the `ass` filter. The poster has it too.
- With the default (off) Watermark the ASS script and the ffmpeg command are unchanged.

### Editor

- A **Watermark** tab: Off/Text/Logo; text, font, colour and outline; the Logo library (upload card, delete with a confirmation); a 3x3 place grid; size and opacity sliders.
- The preview draws the plan's Watermark and, while the tab is open, lets it be dragged or nudged (Shift for 40 px). It is drawn where it is put until the next plan comes back.
- The editor's tabs are sized to their labels, so that five fit.

## Testing Decisions

- Seam B: places, clamping, text measuring, the ASS event, override validation (`tests/test_watermark.py`); the v1 byte-for-byte fixture still passes.
- Seam A: a Logo and a text Watermark burned in with the real ffmpeg, checked by pixel colour inside the plan's area; the Logos API.
- Frontend: typecheck, build and a browser walkthrough (no frontend test runner).

## Out of Scope

- SVG logos; animated Watermarks; showing the Watermark for part of the Clip only; text and a Logo at once.
