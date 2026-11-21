# Media3 overlay API notes

This local text-overlay slice uses AndroidX Media3 version 1.11.1, already declared by `mobile/modules/on-device-renderer/android/build.gradle`.

- [Official `OverlayEffect` API reference](https://developer.android.com/reference/androidx/media3/effect/OverlayEffect): an `OverlayEffect` applies `TextureOverlay` instances to video frames in FIFO order, with later overlays drawn on top.
- [Official `CanvasOverlay` API reference](https://developer.android.com/reference/androidx/media3/effect/CanvasOverlay): `CanvasOverlay(false)` permits a configured canvas size, with `setCanvasSize` used before drawing; `onDraw(Canvas, presentationTimeUs)` draws the timestamp-specific frame contents.
- [Official `BitmapOverlay` API reference](https://developer.android.com/reference/androidx/media3/effect/BitmapOverlay): overlays can supply timestamp-specific bitmaps through `getBitmap(presentationTimeUs)`.
- [Official Media3 Transformer transformations guide](https://developer.android.com/media/media3/transformer/transformations): `EditedMediaItem` accepts ordered video effects and Media3 Transformer handles transcode/export on Android.

The implementation applies `Presentation` first to create the fixed 720 × 1280 portrait frame, followed by an `OverlayEffect` with a 720 × 1280 `CanvasOverlay`. The canvas receives manual Cue and per-word timing data from the native local editor. The documentation confirms the APIs, not runtime behavior for this app; the effect order, clipped timestamp origin, overlay placement and output quality remain unverified on a device/emulator.
