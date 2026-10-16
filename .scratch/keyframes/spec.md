# Keyframes for pictures and sound

Status: ready-for-agent
Created: 2026-10-16

## Problem Statement

Nothing in the Advanced Edit moves over its length.

- **A picture is still.** An Overlay, a media Segment and a Manual Scene have one Transform for their whole length (ADR 0007: "Keyframes stay out"). A slow zoom into a still (Ken Burns), a picture-in-picture that slides in from the edge, a logo that spins, an Overlay that fades out on a beat: none of these can be made.
- **A sound has one level.** A Music Clip has one volume plus a fade in and a fade out. A song can't dip under one sentence and come back. An Overlay video's sound and a media Segment's sound are one level too.
- **The only motion is preset.** The hook and Text Layers have in/out animations (fade, pop, slide), drawn by ASS tags and copied into the preview. Everything else is constant.
- **Concat has all of this:**
  - `KeyProperty`: Scale, OffsetX, OffsetY, Rotation, Opacity and Volume, plus the Adjust parameters;
  - a cubic-bezier ease per key, with Linear, In, Out, In · Out and Custom;
  - a Keyframes pane with a dopesheet and a curve editor;
  - a diamond toggle beside each keyable field of the inspector;
  - diamonds on the ruler for the selected clip.

## Solution

Pictures and sounds of the Advanced Edit get **Keyframes** and their **Eases** (see the glossary and ADR 0008).

**What can be keyed.**

| Item | Properties |
|---|---|
| Overlay | `x`, `y`, `scale`, `rotation`, `opacity`; `volume` for a video |
| Media Segment | `x`, `y`, `scale`, `rotation`, `opacity` of its Framing's Transform; `volume` |
| Layout Override with Manual | `x`, `y`, `scale`, `rotation`, `opacity` of its Framing's Transform |
| Music Clip | `volume` |

Stretch, flips, the Crop, the Background and an Overlay's corners, border and shadow stay constant. A Source Segment, a Layout Override that isn't Manual, and the Candidate's own Manual Framing have no Keyframes. Neither do Text Layers, the hook, the captions, the Watermark or the Clip's own sound.

**A Keyframe** is the value of one property of one item at one time:
- `at`: seconds from the item's start. Moving the item moves its Keyframes with it. For a Manual Layout Override, it is seconds from its Scene's start on the Source's timeline, so a piece of the Source shown twice moves alike in both places (ADR 0002).
- `value`: in the field's own units: output pixels for `x` and `y`, a multiplier of the fitted size for `scale`, degrees clockwise for `rotation`, 0..1 for `opacity`, the linear gain 0..2 of today's volume fields (shown as %).
- `ease`: how the Keyframe is approached from the one before it (an **Ease**).

**Keys replace the constant.** While a property has Keyframes, its constant (the Transform's field, the volume) is not used. It is kept, and when the last Keyframe of a property is removed in the editor, the constant becomes the value the picture had at the playhead, so nothing jumps.

**The value between Keyframes:**
- before the first Keyframe, the first one's value; after the last, the last one's;
- between Keyframes `a` and `b`, `a.value + (b.value − a.value) × ease_b((t − a.at) / (b.at − a.at))`.

**An Ease** is a CSS cubic-bezier: `[x1, y1, x2, y2]`, its ends pinned at (0, 0) and (1, 1). `x1` and `x2` are kept within 0..1; `y1` and `y2` may overshoot (−2..3).
- The presets are Linear `[0, 0, 1, 1]`, Ease in `[0.42, 0, 1, 1]`, Ease out `[0, 0, 0.58, 1]` and Ease in-out `[0.42, 0, 0.58, 1]`. Any other is Custom.
- A preset is recognised within 0.005 of each number.
- The first Keyframe's Ease is unused.
- A new Keyframe takes the Ease of the Keyframe before it, or Linear if it is the first, so that laying down a run of Keyframes doesn't alternate between shapes.
- There is no Hold.

**Volume and fades.** A Music Clip's fade in and fade out multiply its keyed volume. The Fade Ramp works as today, and the Keyframes shape the middle.

**Limits.**
- At most 100 Keyframes per property of an item.
- At least one frame (1/30 s) between two Keyframes of a property. In the editor, a Keyframe set within half a frame of another replaces it.
- Each value within its field's range: `scale` 0.05–8, `opacity` 0..1, `volume` 0..2. `x` and `y` are kept on the frame as the Transform's centre is. `rotation` is −3600..3600, so that a picture can turn several times.
- `at` within 0..the item's length. A Manual Layout Override's Keyframes need only be ≥ 0. Its Scene's length comes from the analysis, so Keyframes past the Scene's end are ignored and the dry run says so.

**Trimming, splitting and rippling re-anchor the Keyframes, as Concat's do.** Each piece plays exactly what the whole did at those moments.
- Trimming the start moves every Keyframe earlier by what was cut.
- A Keyframe that falls outside the item is removed.
  - If some were removed before the new start, a Keyframe is added at 0 with the value there, Linear.
  - If some were removed after the new end, a Keyframe is added at the end with the value there, with the Ease of the first one removed.
- A split gives the head and the tail each the Keyframes of their own part, re-anchored so.
- An item that loses a part to a ripple (ADR 0004) is trimmed in this way.
- Lengthening an item leaves its Keyframes where they are. The last value holds to the new end.
- A Manual Layout Override's Keyframes are never re-anchored: they follow the Source, and Segment cuts don't change its Scenes.

**Editing (the Advanced Edit, desktop).**
- **Diamonds in the inspector.** A ‹ ◆ › cluster sits beside each keyable field: X, Y, Scale, Rotation and Opacity of the Transform section, and Volume (an Overlay's Sound, a media Segment's, a Music Clip's).
  - The diamond is filled when the property has a Keyframe at the playhead. It is outlined when the property has Keyframes elsewhere, and grey when the property is constant.
  - Clicking it adds a Keyframe at the playhead with the value shown there, so the picture doesn't move, or removes the one there.
  - ‹ and › move the playhead to the property's previous and next Keyframe.
- **Auto-key.** Once a property has Keyframes, every change to it writes a Keyframe at the playhead, or replaces the one there:
  - a field in the inspector;
  - a drag of the Grips on the stage (move, corner scale, rotate);
  - a drag of the Volume Line;
  - Fit and Fill.

  A property without Keyframes is changed as today: its constant.
- **Reset** of the Transform section removes the section's Keyframes and resets its constants, as one step of undo.
- **Only one item.** The diamonds, the ruler diamonds and the Keyframes pane work while the Pick is exactly one Overlay, media Segment, Manual Scene or Music Clip. They are off while the playhead is outside it. In a multi-item Pick, a field that is keyed on any picked item is disabled, with a note saying why.
- **Diamonds on the ruler.** While the Pick is one item, its Keyframes show as diamonds on the ruler's floor: one per instant, every property together. A click moves the playhead there. A drag moves every Keyframe at that instant, snapped to frames, as one step of undo.
- **The Volume Line follows the curve** on an item with volume Keyframes. The Waveform is shaped by it. Dragging the line writes a volume Keyframe at the playhead; outside the item the drag is off.
- **The Keyframes pane.** The bottom of the Advanced Edit gets two tabs, Timeline and Keyframes. The browser remembers which tab is open. With no single item picked, the pane says "Pick one item to edit its Keyframes". With one item, the pane has:
  - **A tool strip:**
    - Dopesheet / Curves;
    - ‹ ◆ › for the active row;
    - the Ease of the Keyframe at the playhead, or of the next eased one (Linear, Ease in, Ease out, Ease in-out, Custom);
    - Clear all Keyframes, as one step of undo.
  - **A row per keyable property** of the item, each with its value field and its own ‹ ◆ ›. Clicking a row makes it the active row.
  - **A ruler** in the item's own seconds. Clicking or dragging it moves the playhead.
  - **The Dopesheet:** a lane per row with its diamonds. A click moves the playhead to a diamond. A horizontal drag moves the Keyframe, snapped to frames, not past its neighbours.
  - **The Curves:** every keyed row's curve, faint, each scaled to its own range. The active row's curve is drawn bold, with its range's labels.
    - A Keyframe's dot drags in time and value.
    - Each span between two Keyframes has two Ease handles. Dragging one makes the Ease Custom.
    - Each drag is one step of undo.
  - **The playhead,** drawn over both views.
- **Shortcuts.**
  - K adds or removes a Keyframe at the playhead on the active row. With the pane closed, the active row is the property last touched, else the first keyed one, else Scale (Volume for a Music Clip).
  - [ and ] move the playhead to the picked item's previous and next Keyframe, any property.
  - They go in the keymap table and the shortcuts sheet.

**On a phone.** The sheet inspector has the same ‹ ◆ › per field and auto-keys the same way. It shows an Ease picker for the Keyframe at the playhead, and the ruler shows its diamonds. The Keyframes pane, its Dopesheet and its Curves are on the desktop only.

**The clip editor** draws Keyframes in its preview, as it draws every plan event, and edits none.

**The agent (MCP).** Items carry `keys`, a map from property to its Keyframes:

```json
"keys": {
  "scale": [{"at": 0, "value": 1}, {"at": 4, "value": 1.15, "ease": "ease_in_out"}],
  "opacity": [{"at": 3.5, "value": 1}, {"at": 4, "value": 0, "ease": [0.3, 0, 0.2, 1]}]
}
```

- `ease` is a preset's name (`linear`, `ease_in`, `ease_out`, `ease_in_out`) or four numbers. Leaving it out means Linear.
- In `merge_candidate_items`, `keys` merges by property: a property given replaces its list, `[]` clears it, and the properties not given are kept.
- The server doesn't re-anchor (ADR 0004: it changes exactly what it is told). A change of `start`, `secs`, `offset` or a Segment's range that would leave a Keyframe outside its item is refused, naming the Keyframe and the item's length, for example: "the Overlay's scale Keyframe at 4.2 s is past its length of 3 s; send its keys too".
- The dry run lists each keyed item's Keyframes in Timeline time with their values and Ease names, and each picture's bounds at every Keyframe.

## User Stories

**Moving a picture**

1. As an owner, I want to zoom slowly into a still image Overlay over its length, so that a photo feels alive (Ken Burns).
2. As an owner, I want to slide an Overlay in from off the frame and out again, so that a picture-in-picture enters like in an edited Reel.
3. As an owner, I want to fade an Overlay out at a moment of my choosing, so that it leaves on a beat rather than at its end.
4. As an owner, I want to spin a logo Overlay, more than once if I like, so that a sticker can turn.
5. As an owner, I want to push into a detail of a media Segment, so that a B-roll clip draws the eye.
6. As an owner, I want to pan a Manual Scene across the Source, so that I can move from one speaker to the other in one shot by hand.
7. As an owner, I want the same piece of the Source shown twice to move the same way both times, so that a repeat looks like a repeat.
8. As an owner, I want a Keyframe's motion to ease in and out, so that it doesn't start and stop with a jolt.
9. As an owner, I want to pick Linear, Ease in, Ease out or Ease in-out, so that I can shape motion without drawing curves.
10. As an owner, I want to drag a curve's handles for a custom Ease, so that I can make an overshoot or a snap.

**Shaping the sound**

11. As an owner, I want to dip a song under one sentence and bring it back up, so that the music doesn't fight the speaker.
12. As an owner, I want the song's fade in and fade out to keep working on top of its Keyframes, so that I don't have to rebuild them as Keyframes.
13. As an owner, I want to see the Volume Line follow the curve, so that I can see the dip on the Timeline.
14. As an owner, I want to drag the Volume Line at the playhead to set a level there, so that keying a sound is as quick as setting its volume.
15. As an owner, I want an Overlay video's sound and a media Segment's sound to be keyable, so that a clip's own sound can come up for a moment.

**Setting Keyframes**

16. As an owner, I want a diamond beside each keyable field, so that I can key a property where I already edit it.
17. As an owner, I want adding a Keyframe to keep the picture where it is, so that keying never makes anything jump.
18. As an owner, I want every change to a keyed property to write a Keyframe at the playhead, so that I can animate by moving the playhead and dragging the picture.
19. As an owner, I want a property without Keyframes to change as it always has, so that I'm never animating by accident.
20. As an owner, I want ‹ and › to take the playhead to the previous and next Keyframe, so that I can step through my motion.
21. As an owner, I want K to add or remove a Keyframe and [ and ] to step between Keyframes, so that I can key from the keyboard.
22. As an owner, I want the diamonds to show filled, outlined or grey, so that I can see at a glance whether a property is keyed here, elsewhere or not at all.
23. As an owner, I want Reset to drop the Keyframes of the Transform, so that I can start again in one click.
24. As an owner, I want removing the last Keyframe to leave the picture as it was at the playhead, so that clearing motion doesn't jump.

**Seeing and editing Keyframes**

25. As an owner, I want the picked item's Keyframes as diamonds on the ruler, so that I can see where things change without opening a pane.
26. As an owner, I want to drag a ruler diamond to move every Keyframe at that instant, so that I can retime a move in one drag.
27. As an owner, I want a Keyframes tab beside the Timeline, so that I can work on motion with room for it.
28. As an owner, I want a Dopesheet with a lane per property, so that I can retime Keyframes one by one.
29. As an owner, I want a Curves view with the value drawn over time, so that I can see and shape how a property moves.
30. As an owner, I want each drag in the pane to be one step of undo, so that a slip costs one undo.
31. As an owner, I want Clear all Keyframes, so that I can drop an item's motion at once.
32. As an owner, I want the pane to tell me to pick one item when I haven't, so that an empty pane isn't a puzzle.

**Editing the clip around Keyframes**

33. As an owner, I want to move an item and keep its motion, so that retiming an Overlay doesn't break it.
34. As an owner, I want trimming the start to keep the motion on the same moments, so that trimming doesn't shift the animation.
35. As an owner, I want a split to leave each piece playing what the whole played, so that splitting is invisible.
36. As an owner, I want layers that follow a ripple to keep their motion right, so that the Magnetic timeline doesn't scramble animations.
37. As an owner, I want copied, pasted and duplicated items to bring their Keyframes, so that I can reuse an animation.
38. As an owner, I want Keyframes to merge with other editors' changes as the rest of the item does, so that the agent and I don't lose each other's work.
39. As an owner, I want a locked Track's Keyframes to be safe from hand edits, so that a lock means a lock.

**On a phone**

40. As an owner on a phone, I want the diamonds and auto-key in the inspector sheet, so that I can key a zoom on the go.
41. As an owner on a phone, I want to pick the Ease of the Keyframe at the playhead, so that a phone move needn't be linear.

**The preview and the Clip**

42. As an owner, I want the preview to move exactly as the rendered Clip does, so that what I keyed is what I get.
43. As an owner, I want a picture that is moving to stay sharp and move smoothly in the Clip, so that slow pans don't judder.
44. As an owner, I want a media Segment's Background to show wherever a moving picture leaves the frame uncovered, so that a zoom out never shows black.

**The agent**

45. As the agent, I want to set Keyframes as a map of properties to lists of time, value and Ease, so that I can write a motion in one call.
46. As the agent, I want to replace one property's Keyframes and keep the others, so that I can change a zoom without touching a fade.
47. As the agent, I want a clear refusal when a change leaves a Keyframe outside its item, so that I know to send the Keyframes too.
48. As the agent, I want the dry run to list the Keyframes in Timeline time with the picture's bounds at each, so that I can check a motion without rendering.

## Implementation Decisions

**The Candidate model.**
- Two new value objects:
  - **Ease:** four numbers, with the four presets as constants.
  - **Keyframe:** `at`, `value` and `ease`.
- **A `keys` field,** a map from property name to a list of Keyframes, empty by default:
  - on the Overlay: `x`, `y`, `scale`, `rotation`, `opacity`, and `volume` for a video;
  - on the Segment: the same picture properties and `volume`, for a media Segment only;
  - on the Layout Override: the picture properties, for a Manual one only;
  - on the Music Clip: `volume` only.
- **Validation,** with the model's other field checks. These are refused:
  - a property the item can't have (a volume Keyframe on an image, Keyframes on a Source Segment);
  - two Keyframes closer than 1/30 s;
  - more than 100 Keyframes on a property;
  - an `at` outside the item;
  - a value outside its range.

  Each list is sorted by `at`. `x` and `y` are clamped to the frame as the Transform's centre is. The Ease is tidied: `x1` and `x2` to 0..1, `y1` and `y2` to −2..3, anything non-finite to Linear.
- **The API and MCP** accept an Ease as a preset's name or as four numbers, and always store four numbers.
- **No migration.** Every stored item reads as having no Keyframes.

**One sampling module, twice: backend and frontend (a deep module).**
- Its interface is the value of a property's Keyframes at a time, given the constant to use when there are none.
- Inside, the bezier solver: up to 8 Newton steps from t = x, then 32 steps of bisection, skipped for a linear Ease (as Concat's).
- The frontend's copy also holds the editor's pure Keyframe actions:
  - set, remove and toggle at a time, with the half-frame replace and the inherited Ease;
  - move one Keyframe, or every Keyframe at an instant;
  - set an Ease;
  - clear a property, or all;
  - re-anchor a list for a trim or a split, given the old length and the kept window.
- **A shared fixture of Ease vectors** is read by both test suites, so the two solvers can't drift (ADR 0001).

**Planner (ADR 0001).**
- **A keyed picture's plan** carries its motion: a track per keyed property, in Timeline time.
  - The tracks are `x` and `y` (pixels, clamped), `scale`, `rotation` and `opacity`.
  - The picture's plan also carries its drawn width and height at scale 1 (the fitted size times its stretch), so a sampled scale gives the drawn size.
  - Its other fields hold the geometry at the item's constants, as today.
- **Keyframe times become Timeline time** in the planner, from the item's start.
  - A Manual Layout Override's Keyframes are mapped from the Source's timeline through every Segment that shows its Scene. A piece of the Source shown twice gives two sets, one in each Scene's plan.
  - Keyframes outside the visible part stay in the track, so the motion is the same on both sides of a cut.
- **No on-frame trim for a keyed picture.** Today the planner keeps only the on-frame part of an unturned zoomed picture. A keyed picture is planned whole.
- **A keyed media Segment's or Manual Scene's Background** is drawn unless the picture covers the frame at every frame. The planner samples at the Clip's frame rate to decide.
- **A sound's plan event carries a gain track** for volume Keyframes, in seconds from the event's start. Its fades multiply it. An unkeyed event keeps its constant volume.
- **A picture's bounds stay its bounds at the constants.** The dry run computes the bounds at each Keyframe.

**Renderer.**
- **An unkeyed picture keeps today's picture chain** (ADR 0007).
- **A keyed picture is drawn by a new Python frame process,** one per keyed picture, so the drawing order of Overlays and Segments is kept. For each output frame of its span, it:
  1. samples its tracks with the sampling module;
  2. draws the cropped picture at the sampled size with OpenCV (area resampling when shrinking), with its flips and rotation, its corners and border at their pixel sizes, and its shadow in screen space, into only its bounding box of a reused transparent 1080×1920 RGBA frame;
  3. multiplies the alpha by the sampled opacity;
  4. writes the frame raw to a pipe that ffmpeg reads as an RGBA input at the Clip's frame rate.
- **ffmpeg lays the frames over at 0, 0 with straight alpha.** Premultiplied alpha darkens them over yuv420p. They go where today's picture chain's result goes, and are enabled over the picture's span as today.
- **An image is read once.** A video is decoded by its own ffmpeg process, which crops it and sends RGBA frames at the Clip's frame rate over the span the picture shows.
- **A media Segment's keyed picture** is laid over its Background inside its Segment's chain, before Transitions, so the Transitions see it.
- **The picture gets 2 px of transparent margin** before it is warped, with its colour copied from the edge, to keep black fringes off it.
- **OpenCV becomes a declared backend dependency** (the headless build). Today it comes only through mediapipe.
- **A keyed volume is an ffmpeg volume expression,** evaluated per 480-sample block, in the item's own audio chain after it is trimmed and its time reset. There `t` is the item's own time, so each Keyframe's `at` is used as it is.
  - The expression is a sum of clipped linear ramps, one per step, with no nesting.
  - Each eased span is resampled into 24 linear steps, within 0.6% of the change.
  - The fades are applied after it, as today.
- **Speed,** measured on this Mac: a keyed picture renders at about 1.5–1.8× realtime, against 1.9× for today's static chain. Only keyed pictures pay it.

**Preview (ADR 0001).**
- **A keyed picture is drawn outside React's render.** On every frame of the preview's playback clock, it samples its motion at the playhead and writes its transform, size and opacity to its element directly, so a frame doesn't re-render the stage. The pure function that maps a picture's plan to its CSS boxes takes the sampled values.
- **A keyed sound** sets its gain node from its track sampled at 100 Hz from the playhead, on play and on every seek. This covers Music Clips, Overlay sounds and Segment sounds.
- **The Timeline's gain curve takes the track,** so the Volume Line and the Waveform follow it.
- **The Smart Guides and the Grips** use the picture's bounds at the playhead, from the sampled values.
- **Crop mode** shows the picture as it is at the playhead. The Crop is constant.

**Editor actions (ADR 0004).**
- **Every Keyframe edit is one change of the edits:** one step of undo, saved and merged like any other.
  - A Keyframe is set at the playhead minus the item's start.
  - For a Manual Scene, it is the playhead's Source time minus its Scene's start.
- **Trim, split and ripple** (ADR 0004's pure functions) re-anchor the Keyframes of the items they cut.
- **The Clipboard and duplicate** carry Keyframes unchanged, since they are relative to their item.
- **The client merge** treats Keyframes as part of their item.
- **A locked Track** refuses Keyframe edits by hand. Its items still re-anchor when they ripple.
- **The keymap table** gains three commands: toggle a Keyframe (K), previous Keyframe ([) and next Keyframe (]).

**The bottom tabs.**
- A minimal Timeline | Keyframes tab bar above the Timeline area, on the desktop only. The browser remembers the choice.
- `workspace-layout` (roadmap #22) later turns it into its tabbed bottom area, so nothing here should need rewriting then.

**MCP.**
- **The edit tools' patches** treat `keys` as a map patch: each property given replaces its list, `[]` clears it, and the others are kept.
- **The dry run's plan view** adds the Keyframes of each keyed item, in Timeline time, with Ease names where they are presets, and the bounds at each Keyframe.
  - A Manual Scene's Keyframes past its Scene's end are listed as ignored.
- **The server instructions** get a paragraph on Keyframes:
  - `at` is in seconds from the item's start, or from its Scene's start for a Manual Layout Override;
  - values are in the field's own units;
  - the Ease names;
  - the server doesn't re-anchor, and refuses a change that would leave a Keyframe outside its item.

## Testing Decisions

Good tests here check what is seen and heard:
- a sampled value at a time;
- the pixels of a rendered frame;
- the gain of a rendered sound;
- the Keyframes after an edit;
- what the API and MCP refuse.

They don't check how an expression or a filter string is spelled, or which functions call which. Existing seams are used wherever they reach. One new seam is added, for the sampling module.

**Seam K: the sampling module (new, pure; pytest and vitest).** Both suites read the shared fixture of Ease vectors.
- Each preset and some Custom Eases (one overshooting), at x 0, 0.25, 0.5, 0.75 and 1, to within 1e-6.
- The value before the first Keyframe, after the last, between two, and at two Keyframes a frame apart.

**Seam A: the app over HTTP and MCP, with the real ffmpeg (existing, extended).** Prior art: `test_render.py`, `test_overlays.py`, `test_mcp.py`, `test_revisions.py`.
- **A moving picture.** An image Overlay keyed in `x` from 200 to 800 over 2 s, Ease in-out, is rendered. In the frame at 1 s, the picture's centre, measured from its pixels, is at 500 within 2 px.
- **Rotation and opacity.** A keyed picture held at 0.5 opacity and 90° matches the static chain's frame at those constants, above a set PSNR.
- **A keyed sound.** A tone under a Music Clip keyed from 1 to 0.25 has, at the midpoint, the RMS that the sampled gain predicts, within 0.5 dB.
- **An unkeyed Clip** renders with no frame process, and its ffmpeg command is unchanged.
- **Refusals,** each with its message:
  - Keyframes closer than a frame (a frame apart is accepted);
  - a 101st Keyframe;
  - a volume Keyframe on an image Overlay;
  - Keyframes on a Source Segment;
  - an `at` past the item's length;
  - an MCP change of an item's length that strands a Keyframe, which names it.
- **Merging.** `merge_candidate_items` with only opacity Keyframes keeps the item's scale Keyframes.
- **Eases.** An Ease sent as `ease_out` is stored as its four numbers.
- **The dry run** lists the Keyframes in Timeline time and the bounds at each.

**Seam B: the pure planner (existing, extended).** Prior art: `test_planner.py`, `test_overlays.py`, `test_media_segments.py`.
- An Overlay keyed in `scale` from 1 to 2 plans a picture whose scale track holds those values at its start plus each `at`, with its drawn size at scale 1.
- A Manual Layout Override's Keyframes come out in Timeline time in each Segment that shows its Scene. A piece shown twice gets two sets.
- A media Segment zooming out from cover to scale 1 gets its Background. One that stays covered at every frame doesn't.
- A Music Clip's volume Keyframes come out as its sound event's gain track, in the event's own seconds.
- A keyed zoomed picture is planned whole, not trimmed to the frame.

**Seam C: the client merge (existing).** A remote change to one Overlay's Keyframes and a local change to another Overlay both survive. When both change one Overlay, the owner's wins.

**Seam D: the pure actions module (existing, extended).** Prior art: the actions tests' style of whole results from small inputs.
- **Toggle:**
  - adds a Keyframe with the value shown at the playhead and the Ease of the one before;
  - toggling again removes it;
  - removing the last Keyframe sets the constant to the value at the playhead.
- **Auto-key:** a Transform change on a keyed property writes a Keyframe at the playhead. On an unkeyed property it changes the constant.
- **Re-anchoring:**
  - trimming 1 s off the start moves every Keyframe 1 s earlier and adds one at 0 with the value there;
  - trimming the end adds one at the end;
  - a split's two pieces give the same values at the same Timeline times as the whole;
  - lengthening changes nothing.
- **Ripple:** an Overlay across a deleted Segment keeps its motion at the moments that remain.
- **Moving every Keyframe at an instant** moves every property's together, snapped to frames, never past a neighbour.
- **Reset** clears the Transform's Keyframes.
- **A locked Track** refuses a Keyframe edit.

**Seam E: the pure Timeline-view module (existing, extended).** Prior art: the Timeline-view tests.
- The ruler diamonds of one picked item: one per instant across properties, merged within half a frame, at their Timeline times.
- The Volume Line's height along a Music Clip with volume Keyframes, including its fades.

**Seam G: the keymap table (existing, extended).**
- K, [ and ] resolve to their commands.
- They don't resolve while typing in a field.

**By hand (a walkthrough ticket), desktop and phone:**
- a Ken Burns on an image;
- a slide-in Overlay with Ease out;
- a song dipped under a sentence;
- a spun logo;
- a split and a trim of keyed items;
- the Curves' Ease handles;
- the preview and the rendered Clip compared frame by frame at a few times.

## Out of Scope

- **Keyframes on Text Layers, the hook, the captions and the Watermark.** The ffmpeg probe found that ASS can't ease or animate `\pos` with `\t`. A working route is one ASS event per linear step (each a `\move` plus one `\t` of `\fscx\fscy\frz\alpha` to the next step). Another is drawing text as a picture through the frame process. This belongs with `text-advanced` (roadmap #8).
- **Keyframes on effect parameters.** There are no effects yet. `color-adjust` (#11) and `video-effects` (#12) bring their parameters with the same `keys` shape.
- **Keyframes on stretch, flips, the Crop, the Background, corners, border and shadow.**
- **Keyframes on the Clip's own sound** (one volume; roadmap #14 `audio-mixing`) and on **the Candidate's own Manual Framing**.
- **A Hold Ease**, and any step without a frame between.
- **A Ken Burns button, motion presets, and image Segments** (a Segment is a video).
- **Copying and pasting just the Keyframes** ("paste attributes").
- **The Keyframes pane on a phone,** its Dopesheet and its Curves.
- **Keyframes on several picked items at once.**
- **Speed ramps and time remapping** (`speed`, roadmap #7).
- **A resizable, dockable workspace** (`workspace-layout`, roadmap #22). Here there are only the two tabs.

## Accepted additions

The code review of 2026-10-16 found behaviour that this spec didn't ask for, or asked for differently. These are kept, as part of what the feature is:

- **A Keyframe set within a frame of another replaces it,** not only within half a frame: the server refuses two closer than 1/30 s, and at 50 fps the next frame is 0.02 s away. The replaced Keyframe keeps its Ease.
- **A cut eased span keeps its curve.** Re-anchoring gives the new end Keyframe (and the first kept one after a cut start) the part of the cut Ease that remains, so a split's pieces play the whole's motion to within a thousandth of a pixel. Splitting an Ease in-out leaves two Custom Eases. A Linear span stays Linear.
- **No Keyframe is added within a frame of a kept one** when re-anchoring.
- **Extending an item's start earlier moves its Keyframes later by as much,** so the motion stays on the same moments.
- **A layer over a whole deleted Segment loses its last seconds, not its middle,** as ripple already shortens it, so its picture and its Keyframes go on without a jump.
- **A Manual Scene's start** is where the earliest Segment showing the override's time starts that Scene (Scenes are found per Segment). Trimming the start of the only Segment that shows it moves the motion with it on the Source. ADR 0008 records it.
- **A Clip with a keyed picture brings its joined frames to one frame rate** before the Overlays (ADR 0008).
- **The ruler diamonds and the pane's drags work with the playhead outside the item,** since they are how the playhead gets there. The Ease picker, Clear all and keyed fields are off there.
- **Clear all Keyframes leaves each constant at its value at the playhead,** as removing the last Keyframe does.
- **A rotation constant is kept within ±360°** when the last rotation Keyframe goes.
- **`at` is at most 3600 s.**
- **The bottom area grows while the Keyframes tab is open,** and the Timeline stays mounted under it.
- **The Volume Line of a picked keyed item has a knob at the playhead,** which is what is dragged.
- **A keyed video is decoded at the largest size it is drawn at,** and its shadow blurred at a reduced size, for speed.
- **OpenCV is the contrib build** that mediapipe already depends on.

## Further Notes

- **Overturns the Out of Scope line on keyframes.** ADR 0008 records it.
  - `.scratch/advanced-edit/spec.md` ("Keyframes, masks, rotation, …");
  - `.scratch/preview-direct-edit/spec.md`;
  - `.scratch/transform-crop/spec.md`;
  - ADR 0007 ("Keyframes stay out"), which ADR 0008 amends.
- **Choices made by default, not grilled.** Revisit them in review if they feel wrong:
  - one frame process per keyed picture, to keep the drawing order, rather than one composited layer;
  - a keyed media Segment's Background decided by sampling every frame;
  - Keyframe drags snapped to frames and never past a neighbour;
  - the Smart Guides using the bounds at the playhead;
  - the Clipboard carrying `keys` as they are;
  - Ease `y` bounded to −2..3;
  - volume sampled with 24 steps per eased span and 480-sample blocks;
  - the constant taking the value at the playhead when the last Keyframe goes;
  - which row K acts on with the pane closed;
  - K, [ and ] as the shortcuts.
- **Measurements behind the renderer choice** (ffmpeg 9.0.2, M1, 1080×1920 at 30 fps):
  - today's static picture chain: 1.9× realtime;
  - the ffmpeg expression chain with animated scale and rotation: about 1×;
  - the OpenCV frame process: 1.5× (a video) to 1.8× (an image).

  The probe's scripts were thrown away; ADR 0008 summarises what they found.
- **Roadmap:** item 6, `keyframes`, in the Advanced Edit v2 roadmap. It depends on item 5, `transform-crop`. It goes ahead of item 22, `workspace-layout`, with only the two tabs.
