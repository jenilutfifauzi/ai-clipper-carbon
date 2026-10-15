# Glossary

Use these terms in code, UI copy, tickets and commit messages.

## Jobs and selection

- **Job:** one episode being processed, from its URL, upload or a file on this Mac to its Clips.
- **Source:** the episode video. Times "on the Source's timeline" are seconds into it.
- **Transcript / Words:** the episode's normalized text with per-Word timing.
- **Window:** a Transcript slice scored by the AI.
- **Candidate:** a proposed clip under review: a range of the Source (or, once cut in the Advanced Edit, its Segments), its hook text, Layout, style and edits.
- **Clip:** a rendered output of a Candidate.
- **Channel Profile / Brief:** standing and per-Job steering for Selection.
- **Reference Set:** past clips used for evaluation and few-shot examples.

## Rendering

- **Layout:** how a Scene is framed: Track, Split or Blur (Auto: chosen per Scene by its faces).
- **Scene:** a shot between two cuts.
- **Render Plan:** the planner's output for one Clip (Scenes with their panels, caption events, and the hook event). It is everything the renderer draws.
- **Hook:** the opening overlay: the Candidate's hook text (with any Emphasis) and its Kicker, drawn as its Hook Style says.

## Clip editor

- **Style Preset:** a named, global look for captions, the hook and the Watermark: a Caption Style, a Hook Style and a Watermark Style. Built-in Presets can't be changed or deleted.
- **Caption Style:** how captions look and are broken into lines: font, size, colours, outline, shadow, case, highlight, position (one of four, or wherever a line is dragged on the preview: every line goes there), and line limits.
- **Hook Style:** how the hook looks and moves: Shape, font, size, case, lines, alignment, colours, outline, shadow, Quote Mark, Kicker colours, position (one of three, or wherever it is dragged on the preview), and animations.
- **Hook Shape:** how the hook's box is drawn: one block behind all its lines, a strip per line, or none.
- **Emphasis:** words of the hook text marked `*like this*`, drawn in the Hook Style's Emphasis colour.
- **Kicker:** an optional short label (at most 24 characters) in a pill above the hook, such as "TERBONGKAR!".
- **Quote Mark:** a badge with quote marks on the hook's top-left corner.
- **Watermark:** a line of text or a Logo shown over the whole Clip, under the captions and the hook, at one of nine places in the safe area or wherever it is dragged on the preview.
- **Watermark Style:** what the Watermark is (off, text or a Logo), its text's font, colour and outline, its place, size and opacity.
- **Logo:** an image the owner uploads for Watermarks, kept as a PNG for every Job. Deleting one leaves the Presets and Candidates that showed it with no Watermark.
- **Style Override:** a field of the Preset's style replaced on one Candidate.
- **Word Edit:** a correction of one caption Word, keyed by a time on the Source's timeline. It gives new text, removes the Word (empty text), or starts a new line before it.
- **Layout Override:** a Layout for the one Scene that holds a time on the Source's timeline, replacing the Candidate's Layout there.
- **Preview Plan:** the Render Plan of a Candidate, or of an unsaved draft of its edits, computed for the editor's preview without rendering.
- **Revision:** one saved state of a Candidate, numbered from 1; each saved change makes the next. An edit made from an older Revision is refused, so that no editor (the clip editor, the Advanced Edit, another tab or the agent) saves over another's change without knowing. The editor then merges its unsaved changes onto the newer Revision, item by item; where both changed the same item, the owner's change in front of them wins and they are told. Choosing a Candidate for rendering (selected) is not a change of its Revision.
- **Revision History:** the Candidate's last 50 saved states kept on this Mac, one per stretch of saving from one editor (a new one when another editor saves, or after a pause), always including the state just before another editor's change. Restoring one saves it again as the next Revision; nothing is lost.
- **Timeline:** the editor's tracks under the preview: the clip's range, Scenes, caption lines and the hook. The Advanced Edit has its own Timeline of Tracks, in Timeline time.

## Advanced Edit

- **Advanced Edit:** a CapCut-like workspace for one Candidate, opened from the clip editor: assets, player, inspector and a multi-track Timeline (on a phone: player, Timeline, a toolbar and bottom sheets). It edits the same Candidate, with undo and redo.
- **Main Track:** the Clip's video in the Advanced Edit: its Segments, back to back.
- **Segment:** a piece of the Main Track: a range of the Source, its ends snapped to Words; or part of a video from the Media Library (filled or fitted over its blur, with its own sound's volume, never captioned). A Clip that isn't cut is one Segment (`start` to `end`); with several, `start` and `end` are the hull of what they show. Word Edits and Layout Overrides apply in every Segment that shows their time (docs/adr/0002-segments-and-timeline-time.md).
- **Media Library:** the videos, songs and images the owner uploads for the Advanced Edit, kept for every Job, each normalized on upload. An item a Candidate uses can't be deleted.
- **Music Clip:** part of a song (or of a video's sound) from the Media Library, heard under the Clip from a time in Timeline time, at its volume, faded in and out. The Clip's own sound has a volume too.
- **Overlay:** a video or image from the Media Library laid over the Clip (picture in picture), in Timeline time: its place and width on the frame, its opacity, and a video's sound (muted by default). Drawn over the Segments and under the Watermark.
- **Transition:** how one Segment gives way to the next at their join (a fade, a dip, a slide, a wipe, a zoom, a circle): the two overlap for its length (at most half the shorter), so the Clip is that much shorter. Not the Job's status history (`StatusChange`).
- **Text Layer:** a free text overlay added in the Advanced Edit: its words (lines split at newlines), its time in Timeline time, its centre on the frame, and its own look and in/out animation. Drawn over the captions and under the hook.
- **Pick:** the items picked on the Advanced Edit's Timeline or preview, which its actions and inspector act on: one or more Segments, Text Layers, Music Clips and Overlays, mixed; or the hook, the captions or a join, alone. Not Selection (the AI's) nor a Candidate selected for rendering. Kept in the editor only, never saved or undone; items removed by an undo or another editor drop out of it.
- **Clipboard:** the Advanced Edit's copied items, kept in memory while the browser tab is open, keeping their order and their times relative to one another. They paste into any Candidate, of this Job or another; Segments of a Source only into its own Job, bringing the Word Edits and Layout Overrides of their range where the Candidate has none.
- **Track:** a row of the Advanced Edit's Timeline by kind: Text, Overlay, Video (the Main Track), Captions, Hook and Music. Text Layers, Overlays and Music Clips are spread over as many lanes as their overlaps need, worked out each time, never saved. A Track can be hidden or muted in the preview and locked against hand edits (Text, Overlay, Video, Captions and Hook hide; Overlay, Video and Music mute; every Track locks). These are kept in the editor only: never saved, never undone, and the Clip renders as if none were set.
- **Magnetic timeline:** the Advanced Edit's switch (on by default, remembered by the browser) under which Text Layers, Music Clips, Overlays and the hook follow the Main Track when it gets shorter or longer at a point: deleting, trimming or inserting Segments. Those after the point move with it; those across it lose what was cut; those wholly inside a cut go, except the hook, which moves to the join. Reordering Segments and Transitions move nothing. The clip editor's trim follows the same switch. See docs/adr/0004-layers-ripple-with-the-main-track.md.
- **Ripple delete:** Shift+Delete: a delete that closes the gap whatever the Magnetic timeline's switch says. On a Segment, the layers follow; on a Text Layer, Music Clip or Overlay, the later items of its Track move up by its length.
- **Split all:** splitting at the playhead every Segment, Text Layer, Music Clip and Overlay under it, except on locked Tracks (Cmd/Ctrl+B with nothing picked). The hook is never split; the captions break their lines at the new join, as at every join.
- **Timeline time:** seconds into the output Clip. What the Advanced Edit adds, and the hook, are anchored to it; Word Edits and Layout Overrides stay on the Source's timeline.
