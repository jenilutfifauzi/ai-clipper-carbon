# 02: Crop on Overlays

**Parent spec:** `spec.md` (user stories 12, 16, 17, 54; Implementation Decisions "Model", "Planner", "Renderer", "Preview"); ADR 0007.

**What to build:** an Overlay gets a `Crop`: per-edge fractions, taken before fitting. It is set from the inspector's four numbers and through MCP. Crop mode on the stage is 07.

- **Model.** Add `Crop` (each edge 0..0.9, tidied as Concat's so that a tenth is kept), and `Overlay.crop`.
- **Planner.** `Picture.crop` is in item pixels. The fitted size is that of the cropped picture.
- **Renderer.** `crop` is the first step of `_picture`.
- **Preview.** `PicturePanel` positions the media inside the wrapper to show only the crop, as `PanelView` does.
- **Inspector.** The four Crop numbers in the Transform section. `_plan_view` lists the crop.

**Blocked by:** 01

**Status:** done

- [x] Seam B:
  - [x] left 0.25 on 1000×1000 crops x 250, w 750, and fits 750×1000;
  - [x] left 0.6 with right 0.6 is tidied.
- [x] Seam A: crop `left` 0.5 drops the left quadrants' colours; with rotation 90° the crop turns with the picture.
- [x] Seam H: `Picture` to CSS gives the crop's inner offset and size.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done.** Built as specified, at each seam test first.

- **Model.** `Crop` (`left`, `top`, `right`, `bottom`) is in `backend/app/candidates.py`, beside `Transform`. pydantic refuses an edge outside 0..0.9 (or not a number); `__post_init__` then tidies it as Concat's `Crop::tidy` and the frontend's `tidyCrop` do: each edge held to 0..0.9, and the second of a pair (`right`, `bottom`) pulled back so a tenth is kept. `Overlay.crop` defaults to `Crop()`, so old Candidates and migrated Overlays need nothing.
- **The fitted-size module.** `kept(width, height, crop)` in `backend/app/pictures.py` gives the kept pixels (x, y, w, h), each edge at the nearest pixel so it stays inside the item. `fitted` itself is unchanged: `picture_of` passes it the kept size through `drawn_size`.
- **Planner.** `picture_of(width, height, transform, crop=Crop())`: `Picture.crop` is the kept box in item pixels and the drawn size is the kept part's fitted size times scale and stretch. `Picture` gained `item_size` (the item's width, height), which the renderer needs to tell a crop from the whole item and the preview needs to size the media inside the box.
- **Renderer.** `_picture` starts with `crop=w:h:x:y:exact=1` (exact, so an odd x of 4:2:0 video isn't rounded away from the plan), left out when the crop is the whole item. A plain Overlay's graph is unchanged.
- **Preview.** `pictureStyle` returns `inner` (left, top, width, height in % of the box: the whole item sized `item/crop` and moved by `-crop.x/crop.width`), and `PicturePanel` lays the media in that inner box inside an `overflow-hidden` media layer, so the handle's corner grip outside the box isn't cut off.
- **Inspector.** `TransformFields` takes `crop` and `onCrop(crop, field)` and shows a Crop fieldset (Left, Right, Top, Bottom in %, 0–90), each change tidied by `tidyCrop` and one history group `overlay:<id>:crop.<edge>`. Fill now covers the frame with the kept size (`croppedSize`).
- **Frontend types.** `Crop` is defined in `api.ts` (with `Overlay.crop` and `Picture.item_size`); `cropGestures.ts` imports and re-exports it instead of its own copy. `newOverlay` sets `crop: NO_CROP`.
- **MCP.** `_plan_view` lists each Overlay's `crop` (the kept box in item pixels, after `rotation`). The nested merge already treated `crop` as a dataclass field: tested with `{"crop": {"left": 0.25}}` then `{"crop": {"bottom": 0.5}}`. The instructions' units paragraph names the crop's fractions. The tool list is 49.8 kB of its 60 kB budget.

Choices: Reset still resets the Transform only and leaves the Crop (it has its own four fields; Crop mode in 07 may want a "no crop" action). The dry run gives the crop as resolved pixels, not the fractions the agent set (those are on the Candidate). The backend tidies with the edge fractions as given (0.9 − 0.6 is 0.30000000000000004), as Concat and `tidyCrop` do, rather than rounding.

Not tried: no browser walkthrough (the four Crop fields on a picked Overlay, a cropped image and a cropped video Overlay in the preview against a rendered frame, Fill on a cropped Overlay). Crop mode on the stage is 07.
