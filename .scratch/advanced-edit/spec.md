# Advanced Edit: a CapCut-style workspace with Text Layers, Music, Segments and Transitions

Status: done
Created: 2026-10-14

## Problem Statement

The clip editor polishes what Selection proposed: one range of the Source, its captions, hook, Layout and Watermark. Anything past that (a title card mid-clip, background music, cutting a pause out of the middle, an intro from another file, a B-roll on top, a fade between two shots) means exporting and finishing the Clip in CapCut. The Clip then leaves the app, and any later fix (a caption typo, a new hook) has to be redone by hand in the other editor.

## Solution

An **Advanced Edit** workspace, opened from the clip editor with an "Edit Advanced" button. It edits the same Candidate as the clip editor, through the same save, Preview Plan and render paths, laid out like CapCut:

- **Desktop** (like CapCut PC): the asset panel on the left (Media, Audio, Text, Transitions), the player in the middle, the inspector of the selected item on the right, and a multi-track Timeline below.
- **Mobile** (like the CapCut app): the player on top, the Timeline in the middle, a toolbar at the bottom, and the inspector in a bottom sheet. Pinch zooms the Timeline, a tap selects an item, and a long press then drag moves it.
- **Undo/redo** from the first release (Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, and buttons on mobile).

The four features ship in this order, each usable on its own:

1. **Text Layers.** Any number of free text overlays, each with its own time, place, style and in/out animation.
2. **Music.** Music Clips from the Media Library on an audio track, mixed under the Clip's own sound.
3. **Segments.**
   - The Main Track becomes a list of Segments. Split, delete, trim and reorder them.
   - Insert pieces of the Source or uploaded videos as new Segments.
   - **Overlays** (picture-in-picture) follow on their own track.
4. **Transitions** between adjacent Segments.

The clip editor's preview shows (and plays) Text Layers, Music Clips, Overlays and Transitions too, read-only. They are changed only in the Advanced Edit workspace. Its Timeline gets no new tracks.

## User Stories

1. As a clipper, I want a CapCut-like workspace for a Clip, so that I can finish it without leaving the app.
2. As a clipper on my phone, I want the same workspace laid out like the CapCut app, so that I can edit on the go.
3. As a clipper, I want to undo and redo, so that I can try an edit without fear.
4. As a clipper, I want to add a text box at any moment of the Clip, so that I can label a point, add a title card or a call to action.
5. As a clipper, I want to style each text box (font, size, colour, outline, background box) and drag it on the preview.
6. As a clipper, I want a text box to fade, pop or slide in and out.
7. As a clipper, I want to duplicate a text box, so that I can reuse its style.
8. As a clipper, I want to upload music once and use it in any Clip.
9. As a clipper, I want to place, trim and fade music and set its volume and the Clip's own volume, so that the speaker stays audible.
10. As a clipper, I want to split the Clip at the playhead and delete a piece, so that I can cut a pause or a slip out of the middle.
11. As a clipper, I want to reorder pieces and add another moment of the Source, so that I can build a Clip from two moments of the episode.
12. As a clipper, I want to add an uploaded video as an intro, an outro or a full-screen B-roll, framed to fill the screen or fit over a blurred copy.
13. As a clipper, I want to lay a video or an image over the Clip (picture in picture), placed, sized and faded, muted unless I raise its volume.
14. As a clipper, I want a transition between two pieces (a fade, a slide, a wipe, a zoom), so that cuts look intentional.
15. As a clipper, I want the preview to keep the render's timing exactly, so that what I time is what I get.
16. As a clipper, I want to be stopped from deleting media that a Clip still uses, and to see which Clips use it.

## Implementation Decisions

### Principles

- **ADR 0001 holds.** Every new item is an edit on the Candidate. The planner turns it into a new event type in the Render Plan, and the editor draws exactly that. The frontend never times or places anything itself, except to draw a drag in progress until the next plan comes back.
- **Stored on the Candidate** as new fields, beside Word Edits and Layout Overrides. They go through `CandidateChange` → `update()` → `candidate_plan()`, which preview and render share. They are not stored in a separate project document.
- **Timeline time.** Text Layers, Music Clips, Overlays and the hook are anchored to seconds into the output, as `hook_start` already is. Trimming or cutting the Main Track leaves them where they are on the output. **Word Edits and Layout Overrides stay on the Source's timeline**, so a piece of the Source used twice gets the same corrections in both places.

### Media Library (`backend/app/media.py`)

- One global library, like the Logos, in `DATA_DIR/media/`: `<id>.<ext>` per item plus `media.json`.
- **Kinds:**
  - `video`: MP4, MOV or WebM, at most 500 MB and 3 minutes.
  - `audio`: MP3, M4A, WAV or AAC, at most 50 MB.
  - `image`: PNG, JPEG or WebP, as the Logos are.
- **On upload, ffmpeg normalizes the file:**
  - A video becomes H.264/AAC at 30 fps, with a small preview proxy.
  - Audio becomes AAC.
  - The duration, size and whether it has sound are read with ffprobe.
- `GET/POST /api/media`, `GET/DELETE /api/media/{id}` (plus `/proxy`).
- Deleting an item that any Candidate uses is refused (409), and the response lists those Candidates.
- An edit naming an item that doesn't exist is refused (422).

### Model (`backend/app/candidates.py`)

- `TextLayer`:
  - `id`, `text`, `start`/`secs` (Timeline time).
  - Place: `x`/`y` (its centre).
  - Style:
    - `font`, `size`, `colour`, `outline`, `box` (off or a colour), `align`
    - `anim_in`, `anim_out` (`none | fade | pop | slide_up`, matching the hook's animations where they overlap)
- `MusicClip`:
  - `id`, `media`, `start` (Timeline time), `offset` (into the file), `secs`.
  - `volume`, `fade_in`, `fade_out`.
  - `Candidate.source_volume` sets the volume of the Clip's own sound.
- `Segment` (in phase 3), each one of:
  - `source`: `in`/`out` on the Source's timeline.
  - `media`: a video item, `in`/`out` into it, `fit` (`fill | blur`), `volume`.
  - `Candidate.segments` replaces `start`/`end`. A Candidate saved before reads as a single Source Segment.
- `Overlay`:
  - `id`, `media` (video or image), `start`/`secs`, `offset`.
  - `x`/`y`/`scale`, `opacity`, `volume` (0 by default).
- `Transition` (in phase 4): `after` (a Segment id), `kind`, `secs`.

### Planner

- New events, drawn in this order (bottom to top): the Segments' video, Overlays, Watermark, captions, Text Layers, hook.
  - `TextEvent`: area, font size after fitting, and animations.
  - `AudioEvent`: per Music Clip, its Timeline span, file span, volume and fades.
  - `SegmentPlan`: Timeline span, the input and its range, and Scenes for Source Segments.
  - `OverlayEvent`
  - `TransitionEvent`
- **Captions** come from the Words of Source Segments only. A media Segment has none.
- **Clip length.** A Transition overlaps the end of one Segment with the start of the next, as CapCut does, so the Clip is that much shorter. The longest-clip limit applies to the Timeline's length.

### Renderer (`backend/app/renderer.py`)

- **Text Layers** are ASS events (style per layer, `\fad`/`\t`/`\move` for the animations) in the same script as the captions and the hook.
- **Music** files are extra inputs. Each is `atrim` + `adelay` + `volume` + `afade`, then `amix` with the Clip's own sound, before `loudnorm`.
- **Segments:**
  - Each Source Segment is its own trimmed branch, with Scenes as today.
  - A media Segment is scaled to fill, or fitted over a blurred copy of itself.
  - Branches are joined with `concat`.
- **Transitions** join their pair with `xfade` (video) and `acrossfade` (audio) instead.
- **Overlays** are extra inputs `overlay`'d with `enable='between(t,…)'` before the `ass` filter.

### Editor

**Workspace**
- A new route, `/jobs/:job/candidates/:id/advanced`.
- The same draft, save and Preview Plan hooks as the clip editor (`useDraftSave`, `usePreviewPlan`), plus an undo/redo history of draft states.

**Timeline**
- Tracks from top to bottom:
  - Text, Overlay
  - Main Track (Segments; before phase 3, the Clip and its Scenes)
  - Captions and hook (read-only)
  - Audio
- Behaviour: drag to move, drag an edge to trim, snapping to the playhead and to item edges, zoom, and a playhead with split.
- Hook: the track shows it, and it can be moved and resized as in the clip editor.

**Inspector:** shows the properties of the selected item.

**Preview**
- Text Layers and Overlays are drawn as DOM layers on the 1080x1920 stage, and can be dragged.
- Music plays with `<audio>` elements slaved to `Playback`.
- Segments play through a video element per input, switched at the plan's boundaries.
- Transitions and animations are imitated with CSS. Their timing must match the render exactly; how they look may differ slightly from ffmpeg.

**Clip editor**
- Its preview draws the new events.
- Once a Candidate has more than one Segment, its Clip track turns read-only, with an "Edit in Advanced" link.

### Glossary

Add these terms to `GLOSSARY.md`: **Advanced Edit**, **Media Library**, **Text Layer**, **Music Clip**, **Main Track**, **Segment**, **Overlay**, **Transition**. In the existing terms:
- **Candidate:** "a range of the Source" becomes "its Segments".
- **Timeline:** add "the Advanced Edit's multi-track Timeline".

## Testing Decisions

- **Seam B (pure planner):**
  - Placement and fitting of each new event.
  - Timeline-time anchoring across trims.
  - Captions only on Source Segments.
  - Transition overlaps shortening the Clip.
  - A Candidate saved before planning byte for byte as today.
- **Seam A (HTTP + real ffmpeg):**
  - Text Layers burned in where planned (pixel colour).
  - Music audible: RMS in its span, silent where faded.
  - Multi-Segment and Transition renders: duration and frames at the joins.
  - The Media Library API: upload, refusals, delete blocked while in use.
- **Frontend:**
  - Typecheck and build.
  - Browser walkthroughs at desktop and phone widths.
  - There is no frontend test runner.

## Out of Scope

- A built-in music or stock library (licensing).
- Auto-ducking.
- Keyframes, masks, rotation, stickers, filters and effects.
- Text styles in Style Presets (duplicate a layer instead).
- Transcribing uploaded videos for captions.
- Face tracking or Layouts on uploaded videos.
- Speed changes, voiceover recording.
