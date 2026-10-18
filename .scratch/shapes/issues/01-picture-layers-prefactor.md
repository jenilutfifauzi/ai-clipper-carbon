# 01: Prefactor: the Text Layer's picture path takes any picture layer

**Parent spec:** `../spec.md` (Implementation Decisions "Drawing", "Planning and rendering"); docs/adr/0010-text-layers-are-rasterised-pictures.md; docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:** a prefactor that changes no pixel. Today the path that turns a Text Layer into a picture and lays it over the Clip is written for Text Layers only:
- the plan's event names a Text Layer;
- picture making takes a text layout only;
- the renderer's inputs, frame processes, animations and compositing read the plan's Text Layers by name;
- the preview draws Text Layer pictures in its own code.

Make that path take any **picture layer**: something with a time, a Transform, Keyframes, in/out animations, and a layout that libass draws into a picture. The layers are drawn in the plan's order between the "below" script (captions, Watermark) and the "above" script (hook). Text Layers become the first and only kind on it. Shapes join in 02.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Every existing backend and frontend test passes unchanged, apart from renames.
- [ ] A Candidate with keyed, animated, rotated and emoji Text Layers renders the same frames as before (compare against frames rendered before the change).
- [ ] The Preview Plan's JSON for Text Layers is unchanged, or every reader (the preview and the agent's dry run) is updated with it.
- [ ] Picture caching and the sweep work as before.

## Comments
