# 12: Keyframes on Text Layers

**Parent spec:** `spec.md` (Solution "Transform and Keyframes"; Implementation Decisions "Planner (layout)": picture scale, "Renderer", "Preview and editor"); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:** a Text Layer's position, scale, rotation and opacity can be keyed with Eases, as an Overlay's are.

- **Model and validation:** a Text Layer gains `keyframes` for position, scale, rotation and opacity, with ADR 0008's rules. Trimming, splitting and the Magnetic timeline keep its motion where it was, as for Overlays.
- **The picture's scale** is the largest the layer reaches: its constant or keyed scale, times Pop's peak. It is capped at 4096 px on its longest side.
- **Renderer and preview:** they key the picture as they key an Overlay's.
  - Fade, Pop and Slide are stacked on the keyed values: opacity multiplied, scale multiplied, y offset added.
- **Editor:** Text Layers' rows in the Keyframes pane (Dopesheet and Curves), keyframe buttons by the Transform's fields, and Auto-key from stage grips and fields.
- **MCP:** keyframes can be set and merged as an Overlay's. The dry run lists them.

**Blocked by:** 05.

**Status:** ready-for-agent

- [ ] A Text Layer keyed from x=200 to x=880 over 1 s with Ease out is at the eased x at given frames of the render.
- [ ] Keyed rotation and opacity show in rendered frames as planned.
- [ ] Pop on a layer keyed to scale 2 peaks at its picture's full resolution, and stays sharp.
- [ ] Splitting a keyed Text Layer keeps each half's motion on the same moments.
- [ ] Moving a keyed layer on stage writes a Keyframe at the playhead (Auto-key). The Dopesheet retimes it.
- [ ] A keyed Text Layer set through MCP renders the same as one keyed in the editor.
