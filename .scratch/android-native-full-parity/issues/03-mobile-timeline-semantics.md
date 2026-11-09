# 03 — Mobile Timeline semantics and gestures

Type: grilling
Status: open
Blocked by: 02

## Question

Which timeline operations define the first genuinely native multi-track editor, and how must each behave on touch? Specify whether the Main Track is ripple or overwrite on trim, insert, split, reorder, and delete; how music, captions, overlays, and transitions are placed and selected; and the minimum undo/redo, snapping, track mute/lock, and accessibility behavior.

Use concrete cases: splitting one segment while a caption crosses the cut; moving a clip into an occupied range; deleting a clip with attached sound; and editing after another device has saved a newer Candidate Revision. The choice must preserve the existing `Timeline` and `Revision` semantics or explicitly define a mobile-only boundary.
