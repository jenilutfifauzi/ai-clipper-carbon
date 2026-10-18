# 01: Prefactor: the Text Layer's picture path takes any picture layer

**Parent spec:** `../spec.md` (Implementation Decisions "Drawing", "Planning and rendering"); docs/adr/0010-text-layers-are-rasterised-pictures.md; docs/adr/0011-shapes-are-pictures-like-text-layers.md.

**What to build:** a prefactor that changes no pixel. Today the path that turns a Text Layer into a picture and lays it over the Clip is written for Text Layers only:
- the plan's event names a Text Layer;
- picture making takes a text layout only;
- the renderer's inputs, frame processes, animations and compositing read the plan's Text Layers by name;
- the preview draws Text Layer pictures in its own code.

Make that path take any **picture layer**: something with a time, a Transform, Keyframes, in/out animations, and a layout that libass draws into a picture. The layers are drawn in the plan's order between the "below" script (captions, Watermark) and the "above" script (hook). Text Layers become the first and only kind on it. Shapes join in 02.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Every existing backend and frontend test passes unchanged, apart from renames.
- [x] A Candidate with keyed, animated, rotated and emoji Text Layers renders the same frames as before (compare against frames rendered before the change).
- [x] The Preview Plan's JSON for Text Layers is unchanged, or every reader (the preview and the agent's dry run) is updated with it.
- [x] Picture caching and the sweep work as before.

## Comments

**2026-10-18, agent:** Built. The seam:
- **Planner** (`app/planner.py`): `PictureLayout`, a base of every kind's layout (`width`, `height`, `scale`; `raster` and `picture_key` shared; `name` and `faces` per kind), which `TextLayout` now extends; and `PictureLayer`, a base of every kind's event (`layer`, `start`, `end`, `area`, `layout`, `picture`, `bounds`; the `image` and `picture_key` computed fields shared), which `TextEvent` extends. `RenderPlan.picture_layers` gives them in drawing order (today `texts`); Shapes go before the Text Layers there, as a second list `shapes` on the plan, so the Text Layers' JSON is untouched. `layer_picture` (placed by the Transform, keyed by `with_motion`), `picture_scale` (stepped, capped at MAX_TEXT_PICTURE) and `bounds_at` (was `text_bounds_at`) work on any kind.
- **Pictures** (`app/text_pictures.py`): `make_picture(s)` and `rasterised` take any `PictureLayout`. `layout_script` and `pasted` are `singledispatch`: a new kind registers its own script (and, if it needs, what is pasted after libass; by default nothing). Text's script is `text_script`, its paste the emoji. `pictures_used` still walks `text_layers` (02 adds `shapes`).
- **Renderer**: inputs, frame processes, animation and compositing go by `plan.picture_layers` (`_layer_inputs`, `_picture_layer`, `layer_at`, `layer_animation`; feeds keyed `("layer", i)`). `rendering.py` and `editor.py` make the pictures of `plan.picture_layers`.
- **Dry run** (`mcp_server.py`): `_layer_view(event, adapter, picture_url, *fields)` gives a picture layer's id, times, bounds, picture URL and Keyframes; Text Layers add `lines`.
- **Preview**: `PictureLayerEvent`/`PictureLayerItem` in `api.ts` (TextEvent extends it); `pictureLayers(plan)` in `picture.ts` gives `{ id, event }` in drawing order; `textPicture.ts`/`textStage.ts` became `layerPicture.ts`/`layerStage.ts` (`useLayerPicture`, `placedLayer`, `layerStagePicture`, `layerEventAt`, `heldLayerEvent`, `layersAt`), and `ClipPreview` draws every picture layer with `PictureLayerView`.
- GLOSSARY: **Picture layer**.

Checked: a Candidate with keyed (x, scale), popped/slid, rotated, faded, shadowed and emoji Text Layers, captions and a hook rendered byte-identical frames at 15 times before and after, and its Preview Plan `texts` JSON was identical. New tests: a layout of another kind drawn by its own registered script (test_text_pictures.py), and `pictureLayers`/`layersAt` (layerStage.test.ts). Backend 785 passed; frontend 713 passed; tsc clean.
