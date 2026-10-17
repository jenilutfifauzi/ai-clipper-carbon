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

- **Layout:** how a Scene is framed: Track, Split, Blur or Manual (Auto: chosen per Scene by its faces, never Manual).
- **Manual:** the Layout that frames the Source by hand with a Framing, still for the whole Scene: face tracking is not run there. The Candidate's Layout may be Manual (one Framing for every Scene without an override), and so may a Layout Override (its own Framing). See docs/adr/0007-one-transform-for-every-picture-and-a-manual-layout.md.
- **Transform:** where and how a picture sits on the frame: its centre in output pixels (kept on the frame), its scale over its fitted size (the largest that fits 1080×1920; 1 fits), its stretch across and down, its rotation (degrees clockwise), its flips and its opacity. Constant over its item's length, except where its position, scale, rotation or opacity has Keyframes.
- **Crop:** what is cut off each edge of a picture before it is fitted, as fractions of its width and height (at most 0.9 each, a tenth always kept).
- **Framing:** a Transform, a Crop and a Background: how a media Segment, or the Source in a Manual Scene, fills the frame.
- **Background:** what shows behind a Framing's picture where it doesn't cover the frame: the picture itself, blurred, or a colour.
- **Scene:** a shot between two cuts.
- **Render Plan:** the planner's output for one Clip (Scenes with their panels, caption events, and the hook event). It is everything the renderer draws.
- **Hook:** the opening overlay: the Candidate's hook text (with any Emphasis) and its Kicker, drawn as its Hook Style says.

## Clip editor

- **Style Preset:** a named, global look for captions, the hook and the Watermark: a Caption Style, a Hook Style and a Watermark Style. Built-in Presets can't be changed or deleted.
- **Caption Style:** how captions look and are broken into lines: font, size, colours, outline, drop shadow (as a Text Layer's), tracking, case, highlight (and the highlight box's padding and corners), position (one of four, or wherever a line is dragged on the preview: every line goes there), and line limits.
- **Hook Style:** how the hook looks and moves: Shape, font, size, case, lines, alignment, line height, tracking, colours, outline, drop shadow (as a Text Layer's), its box's padding and corners, Quote Mark, Kicker colours, position (one of three, or wherever it is dragged on the preview), and animations.
- **Hook Shape:** how the hook's box is drawn: one block behind all its lines, a strip per line, or none.
- **Emphasis:** words of the hook text marked `*like this*`, drawn in the Hook Style's Emphasis colour.
- **Kicker:** an optional short label (at most 24 characters) in a pill above the hook, such as "TERBONGKAR!".
- **Quote Mark:** a badge with quote marks on the hook's top-left corner.
- **Watermark:** a line of text or a Logo shown over the whole Clip, under the captions and the hook, at one of nine places in the safe area or wherever it is dragged on the preview.
- **Watermark Style:** what the Watermark is (off, text or a Logo), its text's font, colour and outline, its place, size and opacity.
- **Logo:** an image the owner uploads for Watermarks, kept as a PNG for every Job. Deleting one leaves the Presets and Candidates that showed it with no Watermark.
- **Style Override:** a field of the Preset's style replaced on one Candidate.
- **Word Edit:** a correction of one caption Word, keyed by a time on the Source's timeline. It gives new text, removes the Word (empty text), or starts a new line before it.
- **Layout Override:** a Layout for the one Scene that holds a time on the Source's timeline, replacing the Candidate's Layout there. A Manual one carries its Framing.
- **Preview Plan:** the Render Plan of a Candidate, or of an unsaved draft of its edits, computed for the editor's preview without rendering.
- **Revision:** one saved state of a Candidate, numbered from 1; each saved change makes the next. An edit made from an older Revision is refused, so that no editor (the clip editor, the Advanced Edit, another tab or the agent) saves over another's change without knowing. The editor then merges its unsaved changes onto the newer Revision, item by item; where both changed the same item, the owner's change in front of them wins and they are told. Choosing a Candidate for rendering (selected) is not a change of its Revision.
- **Revision History:** the Candidate's last 50 saved states kept on this Mac, one per stretch of saving from one editor (a new one when another editor saves, or after a pause), always including the state just before another editor's change. Restoring one saves it again as the next Revision; nothing is lost.
- **Timeline:** the editor's tracks under the preview: the clip's range, Scenes, caption lines and the hook. The Advanced Edit has its own Timeline of Tracks, in Timeline time.

## Advanced Edit

- **Advanced Edit:** a CapCut-like workspace for one Candidate, opened from the clip editor: assets, player, inspector and a multi-track Timeline (on a phone: player, Timeline, a toolbar and bottom sheets). It edits the same Candidate, with undo and redo.
- **Main Track:** the Clip's video in the Advanced Edit: its Segments, back to back.
- **Segment:** a piece of the Main Track: a range of the Source, its ends snapped to Words; or part of a video from the Media Library (placed by its Framing, with its own sound's volume, never captioned). It plays its range at its Speed, forwards or in Reverse, or holds one frame as a Freeze frame; its length on the Timeline is its range's divided by its Speed. A Clip that isn't cut is one Segment (`start` to `end`); with several, `start` and `end` are the hull of what they show. Word Edits and Layout Overrides apply in every Segment that shows their time (docs/adr/0002-segments-and-timeline-time.md).
- **Media Library:** the videos, songs and images the owner uploads for the Advanced Edit, kept for every Job, each normalized on upload. An item a Candidate uses can't be deleted.
- **Music Clip:** part of a song (or of a video's sound) from the Media Library, heard under the Clip from a time in Timeline time, at its volume, faded in and out. The Clip's own sound has a volume too.
- **Overlay:** a video or image from the Media Library laid over the Clip (picture in picture), in Timeline time: its Transform and Crop, its corners (a radius as a fraction of its shorter side), border and shadow, and a video's sound (muted by default). A video's may have a Speed and play in Reverse. Drawn over the Segments and under the Watermark.
- **Transition:** how one Segment gives way to the next at their join (a fade, a dip, a slide, a wipe, a zoom, a circle): the two overlap for its length (at most half the shorter), so the Clip is that much shorter. Not the Job's status history (`StatusChange`).
- **Text Layer:** a free text overlay added in the Advanced Edit: its words (lines split at newlines and wrapped at its Text Style's wrap width), its time in Timeline time, its Transform (position, scale, rotation and opacity, which Keyframes can move), its Text Style and its in/out animation. Rendered as a picture (docs/adr/0010-text-layers-are-rasterised-pictures.md). Drawn over the captions and under the hook.
- **Text Style:** how a Text Layer's words look:
  - its face, size and colour;
  - its stroke and drop shadow (colour, opacity, blur, distance, angle);
  - its plate (a Block or Strips, with colour, opacity, radius and padding);
  - its line height, tracking, alignment, wrap width and fixed height (the box's outer size, the plate's padding included).

  The box grows to hold the words; they are never shrunk to fit.
- **Text Preset:** a named Text Style that a new Text Layer starts from. It is copied into the layer, never linked to it. Built-in Presets can't be changed or deleted; the owner saves, renames and deletes their own. One Preset is used for new titles, by the editor and the agent. Not a Style Preset.
- **Face:** one font file of a family, at one weight and slant. A style names a Face; weight and italic choose another Face of the same family. Bundled Faces come with the app. Imported Faces are added by the owner for every Job: a variable font is split into a Face per named instance, and a Face can't be deleted while anything uses it. One bundled CJK Face is never named by a style: a Text Layer's characters its own Face hasn't got are set in it.
- **Speed:** the constant rate a Segment or a video Overlay plays at, 0.0625–16× (1 by default). The pitch is kept unless "Change pitch with speed" is on. Words of a Source Segment are retimed with it. Not the preview rate, a viewing aid. See docs/adr/0009-speed-keeps-the-range-and-reverse-is-a-derived-copy.md.
- **Reverse:** a Segment or a video Overlay playing its range backwards, from a Retimed copy. A reversed Segment of the Source has no captions.
- **Retimed copy:** a file derived from a range of the Source or a media item, reversed (or, for the preview, retimed at a Speed outside 0.25–4×), kept on this Mac beside its Job or item. Any copy of a wider range of the same item serves.
- **Freeze frame:** a Segment that holds one frame of the Source or a video for its hold, silent, framed as its Segment was at that moment. Made by splitting a Segment at the playhead (Shift+F); it ripples the Main Track. The ends of the Segments beside it that touch its frame stay there, not snapped to Words.
- **Pick:** the items picked on the Advanced Edit's Timeline or preview, which its actions and inspector act on: one or more Segments, Text Layers, Music Clips and Overlays, mixed; or the hook, the captions or a join, alone. Not Selection (the AI's) nor a Candidate selected for rendering. Kept in the editor only, never saved or undone; items removed by an undo or another editor drop out of it.
- **Clipboard:** the Advanced Edit's copied items, kept in memory while the browser tab is open, keeping their order and their times relative to one another. They paste into any Candidate, of this Job or another; Segments of a Source only into its own Job, bringing the Word Edits and Layout Overrides of their range where the Candidate has none.
- **Track:** a row of the Advanced Edit's Timeline by kind: Text, Overlay, Video (the Main Track), Captions, Hook and Music. Text Layers, Overlays and Music Clips are spread over as many lanes as their overlaps need, worked out each time, never saved. A Track can be hidden or muted in the preview and locked against hand edits (Text, Overlay, Video, Captions and Hook hide; Overlay, Video and Music mute; every Track locks). These are kept in the editor only: never saved, never undone, and the Clip renders as if none were set.
- **Magnetic timeline:** the Advanced Edit's switch (on by default, remembered by the browser) under which Text Layers, Music Clips, Overlays and the hook follow the Main Track when it gets shorter or longer at a point: deleting, trimming or inserting Segments. Those after the point move with it; those across it lose what was cut; those wholly inside a cut go, except the hook, which moves to the join. Reordering Segments and Transitions move nothing. The clip editor's trim follows the same switch. See docs/adr/0004-layers-ripple-with-the-main-track.md.
- **Ripple delete:** Shift+Delete: a delete that closes the gap whatever the Magnetic timeline's switch says. On a Segment, the layers follow; on a Text Layer, Music Clip or Overlay, the later items of its Track move up by its length.
- **Split all:** splitting at the playhead every Segment, Text Layer, Music Clip and Overlay under it, except on locked Tracks (Cmd/Ctrl+B with nothing picked). The hook is never split; the captions break their lines at the new join, as at every join.
- **Filmstrip:** the frames of a Segment's video drawn along it on the Timeline, one for each whole second of the Source or the media item; each tile shows the frame under its middle. The frames are the video as it is, not framed by the Layout.
- **Peaks:** the highest and lowest sample of each millisecond of a sound (the Source's, or a media item's), kept on this Mac to draw Waveforms.
- **Waveform:** the sound of a Music Clip or a Segment drawn along it on the Timeline from its Peaks, shaped by its volume and fades.
- **Volume Line:** a line across a Music Clip or a media Segment on the Timeline at its volume (100% at two thirds of its height), following its volume Keyframes where it has them. Dragging it on a picked item sets the volume, as one step of undo. Source Segments have none: the Clip's own sound has one volume.
- **Fade Ramp:** a Music Clip's fade in or out, drawn as a slope at its start or end. On a picked Music Clip, its handle drags the fade's length.
- **Zoom to fit:** zooming the Timeline so that the Pick fills it, or, with nothing picked, the whole Clip (1×). Never past the Timeline's deepest zoom.
- **Keyframe:** the value of one property of an item at one time, in seconds from the item's start (from its Scene's start on the Source's timeline, for a Manual Layout Override). An Overlay's, a Text Layer's, a media Segment's or a Manual Scene's position, scale, rotation and opacity, and the volume of a Music Clip, an Overlay video or a media Segment, can have them. While a property has Keyframes they replace its constant; between two, the value moves by the later one's Ease. Trimming or splitting an item keeps its motion on the same moments; changing its Speed scales them, and Reverse mirrors them, keeping its motion on the same frames. See docs/adr/0008-keyframes-for-pictures-and-sound.md.
- **Ease:** how a Keyframe is approached from the one before it: a cubic-bezier curve, Linear, Ease in, Ease out, Ease in-out, or Custom.
- **Auto-key:** once a property of an item has Keyframes, every change to it in the Advanced Edit (a field, the Grips, the Volume Line, Fit or Fill) writes a Keyframe at the playhead instead of changing its constant.
- **Keyframes pane:** the Advanced Edit's second bottom tab, beside the Timeline (desktop only): the picked item's keyable properties as rows, shown as a Dopesheet or as Curves.
- **Dopesheet:** the Keyframes pane's view of a lane per property with its Keyframes as diamonds, to retime them.
- **Curves:** the Keyframes pane's view of each keyed property's value drawn over time, with a dot per Keyframe and two handles per span that shape its Ease.
- **Edit Point:** a place on the Advanced Edit's Timeline where something starts or ends: a join of Segments, an edge of a Text Layer, Music Clip or Overlay, an edge of the hook, or either end of the Clip. ↑ and ↓ move the playhead to the one before or after it, skipping hidden Tracks.
- **Skim:** the preview showing the frame under the pointer while it moves over the Advanced Edit's Timeline, the playhead staying where it is; with the pointer gone, the preview is back at the playhead. Switched with S and remembered by the browser; the Skim's sound is a second switch, off by default. Only while paused, and not on a phone.
- **Grips:** the handles on a picked picture on the preview (an Overlay, a Text Layer, a media Segment, or the Source in a Manual Scene): corners scale it about its centre, edges stretch it, the handle above it rotates it. A Text Layer's are on its words' box, and it has no edges to stretch. One drag is one step of undo.
- **Smart Guide:** a line shown while a picture is dragged, where its edge or centre meets an edge or centre of the frame, of another picture shown at the playhead, or a fixed guide; it snaps there (Alt: no snapping).
- **Crop mode:** the preview showing a picked picture whole and dimmed, with handles on its edges and corners that move its Crop. Enter or a click outside keeps it; Escape drops it.
- **Loop Region:** the stretch between the In and Out marks (set at the playhead with I and O) that playback repeats while Loop is on (L). Kept in the editor only: never saved, never undone.
- **Timeline time:** seconds into the output Clip. What the Advanced Edit adds, and the hook, are anchored to it; Word Edits and Layout Overrides stay on the Source's timeline.
