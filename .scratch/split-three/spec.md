# Split in three: one panel per person when three people share the shot

Status: ready-for-agent
Created: 2026-11-05

## Problem Statement

A podcast shot with three people talking in one frame gets Blur today: Auto chooses Split only for a Scene of exactly two faces, and Blur for three or more. The three speakers end up small, in a band across the middle of the frame. I want Split to give each of them a panel of their own, as it does for two.

## Solution

**Split adapts; there is no new Layout.** Split stays one Layout, with as many panels as its Scene has people, up to three:
- two panels when the Scene shows two faces;
- three panels when it shows three or more, for the three faces seen most;
- forced with fewer than two faces, the frame's left and right halves in two panels, as today.

**Auto** chooses Split for a Scene of two or three faces. One face is still Track; none, or four or more, still Blur.

**The panels:**
- On 9:16 and 4:5 (stacked), three rows, each of the full width and a third of the height: 1080×640 on 9:16, 1080×450 on 4:5. The faces from left to right in the Source go from top to bottom.
- On 1:1 and 16:9 (side by side), three columns, each a third of the width and the full height: 360×1080 and 640×1080, from left to right.
- Each crop is about a third of the Source's width (as two-panel crops are half), of its panel's shape, and followed by its own Smooth Camera. Stacked, each face sits at SPLIT_FACE_AT (40%) of its panel's height, as with two.

**Captions:**
- On Auto, in a stacked three-panel Split, a line sits on the seam between the second and third panels (y 1280 on 9:16, 900 on 4:5), centred on it as the two-panel seam's line is (on 9:16: y 1180–1380). Side by side, the lower third, as today.
- Middle stays the middle of the frame (the two-panel seam, y 860–1060 on 9:16) in every Layout. It is a place the owner chose for the whole Clip, not one that follows the Layout; Auto is the one that follows it.

**The preview** draws the plan's panels as it does today (docs/adr/0001): each deck gets a third panel video (a second follower), as do a Transition's ghost and a Source Segment played from a Retimed copy.

## User Stories

1. As an owner with a three-person podcast, I want Auto to give each speaker their own panel, so that all three are large enough to read.
2. As an owner, I want the speakers in the same order as they sit in the shot (top to bottom, or left to right), so that the edit doesn't confuse who is who.
3. As an owner who forces Split on a shot of four or more people, I want the three seen most, so that Split still works.
4. As an owner, I want Auto captions in a three-panel Split not to cover anyone's face.
5. As an owner, I want the preview to show the three panels exactly as the render will.

## Implementation Decisions

- `Canvas.split_panels(count)` gives Split's panels for two or three; `Canvas.split_captions(count)` the Auto caption place on its lowest seam (`seam_captions`, the Middle place, is `split_captions(2)`). `SPLIT_MOST = 3` in canvas.py.
- `_choose` picks Split on Auto for 2 ≤ count ≤ SPLIT_MOST. `_split` is told the Scene's face count and plans min(count, 3) panels, at least two; if fewer distinct faces are tracked than that, it plans as many as are tracked (and the halves under two).
- `_caption_area` on Auto in a stacked Split uses `split_captions(len(scene.panels))`.
- The renderer, `scaled_plan` and the Render Plan are already per panel and need no change.
- The preview's decks (ADR 0006) hold three Source videos each, a master and two followers.

## Testing Decisions

- Planner (Seam B): Auto by face count (3 → Split, 4 → Blur); three panels' boxes on every aspect; left→right ordering; forced Split on four faces → three panels; caption on the lower seam; forced Split under two faces still two halves.
- Canvas: `split_panels(3)` per aspect, `split_captions(3)`.
- A real frame rendered through the planner and renderer, looked at.

## Out of Scope

- Four or more panels.
- Choosing which three faces by hand.

## Addendum: Split 3, three panels on demand

Status: ready-for-agent
Created: 2026-11-06

**Problem.** A podcast wide shot of three, two of them often in profile: BlazeFace sees one face in most sampled frames (in the case that prompted it, 133 frames one face, 25 two, one three), so the Scene's face count is one. Forced Split then falls back to the frame's halves in two panels, and nobody gets a panel of their own.

**Solution.** A Layout of its own, **Split 3** (stored `split3`), beside Split: as the Candidate's Layout and as a Scene's Layout Override. Auto never chooses it, and plain Split keeps adapting as above.
- It always plans three panels, in a Scene whose layout is `split` (the plan has no new Scene Layout): stacked thirds on 9:16 and 4:5, columns on 1:1 and 16:9, as `split_panels(3)` gives.
- When at least three faces are told apart in the Scene (`_track_faces`), the three seen most, left to right, each followed by its own Smooth Camera, as Split gives a Scene of three.
- Otherwise the frame's left, middle and right thirds (`_split_thirds`), each crop a third of the Source wide, of its panel's shape. A third's crop follows the largest face detected in that third at each sampled frame, without identities, so a face in profile seen now and then still steers it (`_follow`, with Split's rise). A third where no face is ever detected stays still on its third, its crop centred at the average height of the faces detected in the Scene (`_faces_level`), so as not to cut heads off (a 9:16 third's crop is 380 px tall on a 1080 px Source); centred without any face.
- Captions on Auto sit on the lower seam, as in any three-panel Split.

**Testing.** Planner: three tracked faces give the same Scene as Split's three; one face mostly gives the thirds, the face's third following it, the empty one still at the faces' height; no faces (or no analysis) give still, centred thirds; a Layout Override of Split 3 on a two-face Scene gives three panels and lower-seam captions. A real frame (job e373122d79d2, the 8.5–24.6 s Scene) composed from the plan's crops and looked at.
