# 0008: Keyframes for pictures and sound

Status: accepted
Date: 2026-10-16

Amends 0007 ("Keyframes stay out. A Transform is constant for its item's whole length.").

## Context

The `keyframes` feature (`.scratch/keyframes/spec.md`) brings Concat's keyframe animation (`concat-core/src/animate.rs`, `ui/workspace/keyframes-pane.slint`) to the Advanced Edit.

Today:
- **Pictures are constant.** An Overlay, a media Segment and a Manual Scene have one Transform over their whole length (ADR 0007).
- **Sounds are constant.** A volume is one number, plus a Music Clip's fades.
- **The only motion is preset.** The hook and Text Layers have fade, pop and slide, drawn as linear ASS tags and copied into the preview.

Keyframes have been Out of Scope in the Advanced Edit, preview-direct-edit and transform-crop specs.

Three questions had to be settled:
- what a Keyframe's time and value mean;
- how the renderer draws a picture that changes every frame;
- how the preview stays faithful to it under ADR 0001.

## Decision

- **Keyframes on pictures and sound only:**
  - an Overlay's, a media Segment's and a Manual Layout Override's `x`, `y`, `scale`, `rotation` and `opacity`;
  - the `volume` of a Music Clip, an Overlay video and a media Segment.

  Text, the Clip's own sound and effect parameters are left for later features. They reuse the same shape.
- **A Keyframe is `{at, value, ease}`.** Items carry `keys`, a map from property to its Keyframes.
  - **`at` is seconds from the item's start.** Concat uses a fraction of the clip instead. With seconds, moving an item moves its Keyframes, and trimming its end leaves them where they are. They read the way the agent and the rest of Timeline time do.
  - **For a media Segment, `at` is seconds from where it starts on the Timeline,** which is its `start` in its video: a trim or split of its range in the video cuts as many seconds off its Keyframes' window (`[cut − start]`).
  - **For a Manual Layout Override, `at` is seconds from its Scene's start on the Source's timeline,** so it follows the Source as the override does (ADR 0002).
    - Scenes are found per Segment, so a Segment's start is always a cut of its own Scenes. The Scene's start is where the earliest of the Segments that show the override's time starts that Scene, and its end the latest end any of them shows. A Segment that shows the shot from part way in (the tail of a split, or the same piece again) then shows the motion from there, and a piece shown twice moves alike both times. The plan gives each such Scene's start in Timeline time (`ScenePlan.keys_from`), which the editor sets Keyframes from.
    - Keyframes past the Scene's end are left out of the motion and listed in the plan (`ScenePlan.ignored`) and the dry run as ignored.
    - Trimming the start of the only Segment showing the Scene's start moves that start, and its Keyframes with it on the Source; the editor doesn't re-anchor them.
  - **`value` is absolute, in the field's own units,** and replaces the constant while the property has Keyframes, as in Concat. Volume is the linear gain 0..2, so the curve drawn is the curve heard.
  - **`ease` is a CSS cubic-bezier on the Keyframe being approached.** The presets are Linear, Ease in, Ease out and Ease in-out, and any other Ease is Custom. There is no Hold.
- **Trim, split and ripple re-anchor Keyframes as Concat's `rewindow_keys` does.**
  - Keyframes outside the piece are removed, and a Keyframe at the cut end carries the value there.
  - This is an editing action (ADR 0004), in the editor only. The MCP server doesn't re-anchor; it refuses a change that would leave a Keyframe outside its item.
- **One sampling function, in Python and in TypeScript,** pinned by a shared fixture of Ease vectors. The Render Plan carries each keyed picture's tracks in Timeline time and its drawn size at scale 1. The preview samples them at the playhead and draws, and computes nothing else (ADR 0001).
- **The renderer draws a keyed picture with a Python frame process.** OpenCV samples, crops, scales, decorates, rotates and fades the picture for every output frame. It pipes the frames to ffmpeg as raw RGBA, which lays them over with `overlay=0:0`. There is one process per keyed picture, so the drawing order is kept. Unkeyed pictures keep ADR 0007's ffmpeg chain.
- **A keyed volume is an ffmpeg expression** (`volume=…:eval=frame`, each eased span resampled into 24 linear steps), multiplied by the fades.

## Considered options

- **Concat's fraction of the clip as the time base.** This is Concat's model exactly, but trimming an item's end would stretch every Keyframe, and the agent would have to divide by the item's length.
- **Values relative to the constant** (a factor or an offset). Moving a picture by its Grips would carry the whole animation, but the numbers shown would not be what is drawn.
- **A flat list of Keyframes with a property each** (Concat's `Vec<ClipKey>`). A map by property lets the agent replace one property's Keyframes and keep the others.
- **The plan sending sampled values for every frame.** There would be no second solver, but the plan would grow with the Clip's length, and a drag on a curve would wait for the 250 ms draft plan.
- **ffmpeg expressions for pictures.** The chain would be `scale … eval=frame`, then `pad`, an opacity from `sendcmd`, `rotate=a='…'` and `overlay=x='…':y='…'`. A probe with ffmpeg 9.0.2 found:
  - **A changing frame size breaks most filters silently.** `overlay` rescales the picture back, `rotate` and `hflip` smear it, and `lut` crashes. Everything sized must come first, at the largest animated size, followed at once by a fixed `pad`.
  - **Corners and border are made once at that size,** so the border shrinks with the picture.
  - **A media Segment zoomed in needs an enormous canvas.** A filled 16:9 Segment is at scale 3.16, and at scale 8 the canvas is 8640 px wide.
  - **Positions step by 2 px** over yuv420p, so slow pans judder.
  - **Animating scale or rotation costs about 1× realtime** per picture, against 1.9× for a static picture.

  The OpenCV process was faster (1.5–1.8×), sampled every frame exactly with the same function as the preview, kept borders in output pixels, placed pictures at sub-pixel positions, and drew only what is on the frame.
- **Both routes:** expressions when only position or opacity is keyed, which costs nothing, and the frame process otherwise. It would be the fastest, but there would be two paths to keep in step and to test.
- **Re-anchoring in the backend too,** for the MCP tools. That is a second copy of an editing rule, the reason ADR 0004 keeps rippling out of the server.

## Consequences

- **Overturns the Out of Scope line on keyframes** in `.scratch/advanced-edit/spec.md`, `.scratch/preview-direct-edit/spec.md` and `.scratch/transform-crop/spec.md`, and ADR 0007's "Keyframes stay out" for the properties above. Masks, keyed crops and keyed text stay out.
- **A Transform and a volume are "constant unless keyed".** Every stored Candidate reads as having no Keyframes, and plans, renders and previews as before.
- **The renderer gains a second kind of process.** That brings pipes, a decode process per keyed video, and OpenCV as a declared dependency. A Clip with keyed pictures renders slower, by the cost of each keyed picture. An unkeyed Clip's ffmpeg command is unchanged.
- **The frontend gains a bezier solver** that must agree with the backend's. The shared vectors are the guard.
- **The preview draws keyed pictures outside React's render,** on `Playback`'s frame, writing styles directly.
- **The Advanced Edit gets a Timeline | Keyframes tab bar** before `workspace-layout` (roadmap #22), which will absorb it.
- **The agent can animate,** and can be refused: a change of an item's start, length or offset that strands a Keyframe must carry the new Keyframes.
