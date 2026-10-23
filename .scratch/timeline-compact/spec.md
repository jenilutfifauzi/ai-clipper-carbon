# A compact Timeline: only the Tracks with something on them

Status: done
Created: 2026-10-23

## Problem Statement

On a laptop the Bottom tabs are about 40% of the window high, and the Advanced Edit's Timeline always drew nine Track rows — Text, Shape, Adjust and Overlay above the Video Track, then Behind, Captions, Hook and Music — each 44 px tall even when empty. The Video Track, the one the owner edits most, was pushed out of view, and the ruler scrolled away with the rows. Each Segment carried its source-time badge and a Layout tag for every Scene under it, which cluttered the Video Track. Concat shows only the Tracks with content, a tall Video Track with its frames, and one label per clip.

## Solution

- **Only the Tracks with something on them are drawn.** A layer Track (Text, Shape, Adjust, Overlay, Behind, Music) with items draws a row per lane, as before; an empty one draws nothing. The Video Track is always drawn. The Captions Track is drawn while the plan has captions or a Segment's captions are on their way (before the plan comes, when the Job is captioned, so that it doesn't jump in); the "Captions are off for this Job" note is gone with the empty row. The Hook Track is drawn when the plan has a hook.
- **An empty Track appears while something it takes is dragged.** From the drag's start (anywhere in the window) until it drops or ends, each empty Track that takes what is dragged shows one empty row with a dashed outline, to drop on. So the row is there before the pointer reaches the Timeline. What each takes:
  - Text: a Text Preset. Shape: a Stickers tile. Adjust: a Filters card or an Effects card.
  - Overlay and Behind: a Media Library item with a picture (a video or an image).
  - Music: a Media Library item with sound (a song, or a video with sound).
  - A Media Library item says whether it has a picture and sound by two extra DataTransfer types beside its id; a drag that says neither shows every Track that takes media.
  - Transitions drop on joins of the Video Track, which is always there.
- **Heights.** The Video Track is 72 px, with its Filmstrip; the layer Tracks 36 px; the Captions and Hook Tracks 32 px.
- **One label per Segment.** A Segment keeps its source-time badge (or its video's name) at the left, and its status badges (Speed, Freeze frame, Muted, Transcribing, Captions failed). Its Scenes' Layout tags show only while it is hovered or focused, or while it is picked. The lines where Scenes meet stay.
- **The ruler stays at the top** as the Tracks scroll under it, the corner over the labels' column with it.
- **The Video Track in view.** When the Timeline first has room, if the Tracks above the Video Track push it out of view, it is scrolled to show it under the ruler.
- **The phone** follows the same rule. Its adds go through its sheets at the playhead, not by dropping on a row, so nothing there needs an empty row.

## Out of scope

- An empty Track's hide, mute and lock buttons: on a desktop they show with its label once it has something on it. The phone's Tracks sheet lists every Track as before.
