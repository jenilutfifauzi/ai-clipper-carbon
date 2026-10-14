# 01: Watermark (text or Logo)

**Parent spec:** `spec.md` in this feature folder (all user stories).

**What to build:**
- **WatermarkStyle** in Presets and Style Overrides, off by default.
- **Logos:** upload, list, serve and delete, kept in `DATA_DIR/logos/`.
- **Planner:** `WatermarkEvent` at nine places in the safe area or a custom centre.
- **Renderer:** text as an ASS event, a Logo as an ffmpeg overlay.
- **Editor:** a Watermark tab, the Logo library, the 3x3 place grid, size and opacity, drag and arrow keys on the preview.

**Blocked by:** none.

**Status:** done

- [x] The default Watermark gives v1's ASS byte for byte.
- [x] Seam B tests: places, clamping, text measuring, ASS event, validation.
- [x] Seam A tests: a Logo and a text Watermark burned in where the plan puts them.
- [x] Logos API tests: upload, bad files refused, list, serve, delete.
- [x] Typecheck and build.
- [x] Browser check: text Watermark, drag on the preview, Logo upload.

## Comments

**2026-10-14: done.** `make test` (348 passed), `npm run build` (typecheck + build), `scripts/check_ffmpeg.py`.

**Changes from the plan:** one ticket instead of four. The outline switch sits with the text fields, not behind More options (it would have been its only field). A Logo Watermark without a Logo yet is valid and shows nothing, so that choosing Logo before uploading one doesn't fail the draft. The editor's tabs are now as wide as their labels, with the thumb measured on the selected tab, since five equal tabs didn't fit the editor's column.

**Checks:** browser walkthrough on a copy of a real Job: a text Watermark drawn top right, dragged to a custom place (saved as `custom`, x 414, y 971), a PNG uploaded through the Logo card and shown top left with its transparency.
