# Roadmap Advanced Edit v2: setara Concat, plus prompt mattpocock per fitur

Status: needs-triage
Created: 2026-10-15

Daftar gap Advanced Edit terhadap editor referensi `docs/referensi/concat`, urutan pengembangan, dan satu seed prompt `/grill-with-docs` per fitur. Setiap fitur nanti mendapat folder `.scratch/<slug>/` sendiri lewat `/to-spec` dan `/to-tickets`.

---

## A. Perbandingan fitur (ringkas)

| Area | Concat | ai-clipper sekarang | Gap |
|---|---|---|---|
| Timeline | track mute/hide/lock, magnetic toggle, filmstrip, waveform, zoom-to-fit, hover scrub, keyframe diamonds | auto-lane, snap, zoom, scrub | **besar** |
| Clip ops | split semua track, ripple delete, merge, freeze, copy/paste, reverse, detach audio | split/trim/dup/delete per item; ripple hanya di Main Track | **besar** |
| Selection | multi, Shift/Cmd-click, marquee, select all, edit banyak title sekaligus | single `Picked` | **besar** |
| Shortcut | Home/End, frame step (±1/±10), zoom keys, B/N/S/M/H tools | Space, Cmd+Z/B/D, Delete | sedang |
| Transform | scale, posisi, rotasi, stretch, flip, crop, opacity, rotate grip, smart guides | posisi/size di stage; Segment hanya `fit` | **besar** |
| Keyframes | Pos/Scale/Rot/Opacity/Volume + param effect, easing bezier, panel dopesheet | hanya animasi in/out preset | **tidak ada** |
| Speed | 0.0625–16×, preserve pitch, reverse, freeze | tidak ada | **tidak ada** |
| Color/filters | Adjust (13 slider), wheels/curves, 56 looks, LUT .cube, adjustment layer, blend mode | tidak ada | **tidak ada** |
| Effects | 21 effect (blur, glitch, grain, glow, chroma/luma key, …), chain per clip | tidak ada | **tidak ada** |
| Transitions | 20 jenis, seam handle untuk resize | 10 jenis xfade, tanpa apply-all | sedang |
| Text | shadow, tracking, line height, plate radius/padding, wrap box, impor font, CJK/emoji, 31 preset + simpan sendiri | font/size/outline/box/align/anim; 4 look | sedang |
| Captions | Whisper dari clip mana pun / dari script, mode frasa/kalimat | Words dari Source saja; style hanya di clip editor | sedang |
| Shapes | 7 bentuk dengan fill/stroke | tidak ada | kecil |
| AI | cutout person/object, smart brush (SAM), TTS (3 engine + clone), upscale | AI hanya di Selection/hook | **besar** |
| Audio | volume line + keyframes, fade, denoise/enhance/loudness per clip, 25 efek suara, voiceover, meters, detach | volume konstan + fade di Music Clip | **besar** |
| Export | codec H.264/HEVC/AV1, 720p–4K, fps, CRF/bitrate, 10-bit, save frame PNG, audio WAV | 1080x1920 fixed, tanpa UI | **besar** |
| Canvas | aspect 16:9 / 9:16 / 1:1 / 4:3 / custom | 9:16 fixed | sedang |
| Templates | project template dengan placeholder slot | Style Presets (caption/hook/watermark) saja | **besar** (dan sangat cocok untuk clipping massal) |

**Sengaja tidak diadopsi** (tidak cocok dengan produk/arsitektur): multi-timeline per project (1 Candidate = 1 timeline), HDR/HLG/PQ, compositor GPU native, docking penuh dengan drag-to-dock (diganti versi ringan: fitur #22 `workspace-layout`), 25 bahasa UI, self-update, API JSON-RPC/gRPC (sudah ada MCP), plugin WGSL custom, upscale Real-ESRGAN (output 1080p dari podcast jarang butuh), slip/slide/roll (Concat pun tidak punya).

**Prinsip arsitektur yang wajib dijaga di setiap fitur:**
- ADR 0001 "backend plans, frontend draws": semua hitungan di `planner.py`; preview hanya menggambar Render Plan.
- ADR 0002 Segments + Timeline time.
- Render tetap ffmpeg `-filter_complex` (`renderer.py`). Preview cukup mendekati (CSS/Canvas/WebGL) dengan **timing persis**, seperti Transitions.
- Pakai istilah `GLOSSARY.md`, dan perluas tool MCP (`mcp_server.py`) untuk setiap model baru.
- Beberapa fitur **membalik "Out of Scope" di `.scratch/advanced-edit/spec.md`**: keyframes, masks, rotasi, stickers, filters/effects, speed, voiceover, ducking, text styles di presets, transcribe upload. Setiap pembalikan butuh ADR atau catatan keputusan saat grilling.

---

## B. Daftar fitur yang akan dikembangkan (urutan disarankan)

| # | Slug `.scratch/` | Fitur | Bergantung pada | Prioritas |
|---|---|---|---|---|
| 0 | `edit-sync` | Live sync dan deteksi konflik (browser ↔ MCP ↔ tab lain) — **selesai 2026-10-15** | — | P0 (fondasi) |
| 1 | `multi-select-clipboard` | Multi-select, marquee, select all, copy/paste, operasi massal — **selesai 2026-10-15** | — | P1 |
| 2 | `track-controls` | Track mute/hide/lock, magnetic toggle, ripple delete layer, split semua track | 1 | P1 |
| 3 | `timeline-visuals` | Filmstrip, waveform, garis volume dan fade di clip, zoom-to-fit | — | P1 |
| 4 | `navigation-playback` | Frame step, Home/End, zoom keys, hover scrub, sheet shortcut, loop/fullscreen, join mulus | — | P1 |
| 5 | `transform-crop` | Scale/posisi/rotasi/flip/crop/opacity untuk Segment dan Overlay, rotate grip — **selesai 2026-10-16** | — | P1 |
| 6 | `keyframes` | Keyframe Pos/Scale/Rot/Opacity/Volume dengan easing, panel keyframe — **spec 2026-10-16** (`.scratch/keyframes/spec.md`, ADR 0008) | 5 | P2 |
| 7 | `speed` | Speed konstan, preserve pitch, reverse, freeze frame | — | P2 |
| 8 | `text-advanced` | Shadow, tracking, line height, rotasi, plate, impor font, preset teks | — | P2 |
| 9 | `shapes` | Shape layers (rect, circle, triangle, line, arrow…) | 8 (opsional) | P3 |
| 10 | `transitions-expanded` | ±30 jenis xfade, apply ke semua join, seam handle, animasi masuk/keluar Overlay | — | P2 |
| 11 | `color-adjust` | Panel Adjust, filter looks, impor LUT, adjustment layer | — | P2 |
| 12 | `video-effects` | Rantai efek per clip (blur, grain, glitch, glow, vignette, chroma key…) | 11 | P3 |
| 13 | `background-removal` | Cutout person AI di Segment/Overlay | 12 (opsional) | P3 |
| 14 | `audio-mixing` | Fade Segment, detach audio, mute clip, auto-ducking | 2 | P2 |
| 15 | `audio-effects` | Denoise, enhance voice, loudness per clip, preset efek suara | 14 | P3 |
| 16 | `voiceover` | Rekam mic di playhead | 14 | P3 |
| 17 | `text-to-speech` | TTS lokal (Kokoro) menjadi Music Clip | 14 | P4 |
| 18 | `captions-advanced` | Style caption di Advanced Edit, caption media Segment, retime per line, SRT | — | P2 |
| 19 | `export-settings` | Resolusi, fps, codec, kualitas, save frame PNG, audio-only | — | P2 |
| 20 | `canvas-aspect` | Aspect 9:16 / 1:1 / 4:5 / 16:9 | 19 | P3 |
| 21 | `templates` | Simpan Advanced Edit sebagai Template dengan slot, terapkan ke banyak Candidate | 1, 5 | P1 (nilai bisnis tinggi) |
| 22 | `workspace-layout` | Panel bisa diubah ukuran dan disembunyikan, panel bawah bertab (Timeline / Keyframes / Meters), ukuran tersimpan | — (sebelum atau bersama 6) | P2 |

**Catatan urutan:**
- Fitur 0–4 membuat editor terasa "pro" tanpa menyentuh renderer secara berat.
- Fitur 5–7 mengubah model dan filter graph, jadi kerjakan berurutan.
- Templates (21) sebaiknya setelah model stabil, tetapi nilai bisnisnya paling tinggi untuk clipping massal.
- Workspace layout (22) dikerjakan sebelum `keyframes`, `audio-mixing` (meters) dan `color-adjust`, karena fitur-fitur itu menambah panel dan memperpanjang inspector.

---

## C. Alur skill mattpocock (sama untuk setiap fitur)

Satu sesi Claude baru per fitur:

1. `/grill-with-docs` + **seed prompt fitur** (bagian D). Grilling sampai frontier kosong; GLOSSARY dan ADR diperbarui selama sesi.
2. `/to-spec`: hasilnya `.scratch/<slug>/spec.md` (Problem, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope).
3. `/to-tickets .scratch/<slug>/spec.md`: hasilnya `.scratch/<slug>/issues/NN-*.md` dengan `Blocked by:` dan `**Status:** ready-for-agent`.
4. `/implement .scratch/<slug>/issues/01-*.md` (memakai `/tdd` pada seam yang disepakati: Seam A = HTTP + ffmpeg nyata, Seam B = planner murni), lalu `/code-review`. Ulangi per ticket.
5. Opsional: `/prototype` untuk pertanyaan UI yang belum jelas (panel keyframe, panel Adjust).

Untuk sekuens besar (fitur 5–7 sekaligus), boleh pakai `/wayfinder` dengan destinasi "spec siap".

Prompt ditulis dalam bahasa Inggris agar cocok dengan GLOSSARY, spec dan kode. Konteks bersama yang **wajib ditempel di awal setiap prompt**:

> Context: AI Clipper's Advanced Edit (`frontend/src/pages/job/advanced/`, backend `backend/app/candidates.py`, `review.py`, `planner.py`, `renderer.py`, `mcp_server.py`). Read `GLOSSARY.md`, `docs/adr/0001-*` (backend plans, frontend draws) and `0002-*` (Segments, Timeline time), and `.scratch/advanced-edit/spec.md`. The reference editor is `docs/referensi/concat` (Rust). Use it for behaviour and UX only, never copy code (licence). The render stays a single ffmpeg `-filter_complex` at 1080x1920 unless this feature changes that. The preview may approximate the look but must match timing exactly. Every new model field must be reachable through the MCP tools (`edit_candidate`, `merge_candidate_items`, `dry_run`). Flag explicitly when this overturns an Out of Scope item of the Advanced Edit spec, and record it as an ADR.

---

## D. Seed prompt per fitur (untuk `/grill-with-docs`)

### 0. `edit-sync`
```
/grill-with-docs
[shared context]
Feature: live sync and conflict safety for the Advanced Edit. Today it loads the Job once with no SSE subscription (`useJobEvents` is only used in JobPage), so edits from MCP or another tab are silently saved over, and undo history (`useEditHistory.ts`) lives only in memory.
Goal: see external Candidate edits live, detect conflicting saves (e.g. a Candidate revision number checked on PATCH, 409 on mismatch), and decide how undo history behaves when an external edit lands.
Grill me on: revision vs timestamp, merge vs reject, what the user sees on conflict, whether MCP edits enter the undo stack, and whether history should persist across reloads.
Out of scope: real-time multi-user collaboration (Concat has none either).
```

### 1. `multi-select-clipboard`
```
/grill-with-docs
[shared context]
Feature: multi-selection and clipboard in the Advanced Edit, at parity with Concat (`docs/referensi/concat/src/crates/concat/src/studio.rs`: select_all, copy_clips, paste_clips, paste_plan; `ui/timeline/lanes.slint` rubber band).
Today: single selection `Picked` in `edits.ts`; actions in `actions.ts` work on one item.
Scope: Shift/Cmd-click add, marquee (rubber band) on empty lanes, Cmd+A (skipping locked tracks once they exist), move/delete/duplicate a group as one undo step, Cmd+C/Cmd+V keeping the group's shape at the playhead (also into another Candidate of the same Job?), and an inspector that edits shared fields of several Text Layers at once ("Editing N layers").
Grill me on: whether a selection may mix kinds (Segment + Text Layer), what paste does with Segments (insert vs overwrite on the Main Track), clipboard scope (in-memory vs across Candidates and Jobs), phone UX (long-press to enter multi-select?), and how the stage shows several selected items.
```

### 2. `track-controls`
```
/grill-with-docs
[shared context]
Feature: track controls and magnetic editing at parity with Concat (`TrackFlag` hide/mute, view-only lock, magnetic timeline toggle `TrimClip.ripple`/`RemoveClips.ripple`, ripple delete Shift+Delete, split at playhead across every clip under it).
Today: tracks are auto-laned (`trackLanes` in `edits.ts`); ripple exists only implicitly on the Main Track; split works on the selected item only.
Scope: per-track (or per-lane?) mute, hide and lock; a magnetic toggle that closes gaps on layer tracks too; ripple delete; "split all at playhead"; optionally moving items between lanes by hand and adding empty lanes.
Grill me on: whether lanes become persisted (a model change: today they are computed) or flags live per track kind, whether hide/mute are saved and rendered (excluded from the Render Plan) or preview-only, how ripple on a layer track interacts with Text Layers anchored to speech, and what "split all" does to the hook and captions.
```

### 3. `timeline-visuals`
```
/grill-with-docs
[shared context]
Feature: richer timeline visuals at parity with Concat (filmstrips on video clips, waveforms from precomputed peaks `concat-media/src/peaks.rs`, a draggable volume line on clips, fade ramps drawn on clips, zoom to fit, keyframe diamonds later).
Today: the Video track shows Scenes with Layout labels and one tiled still for media Segments; audio lanes have no waveform; zoom 1–40×.
Scope: backend endpoints producing thumbnail sprites per Source/media item and waveform peaks (cached under DATA_DIR), drawing them in `AdvancedTimeline.tsx`/`Tracks.tsx` efficiently at every zoom, a volume line and fade handles directly on Music Clips and Segments, and zoom-to-fit.
Grill me on: sprite resolution and density per zoom level, when they are generated (at upload/prepare vs on demand), the caching keys, performance on phone, and whether dragging the volume line is one undo gesture.
```

### 4. `navigation-playback`
```
/grill-with-docs
[shared context]
Feature: navigation and playback at parity with Concat (Home/End, ←/→ frame step with Shift ×10, `=`/`-` zoom, preview axis "S" hover scrubbing with optional audio, playhead-stops-at-end, a shortcuts help sheet, previous/next edit point) plus preview gaps we already know: the visible seek pause at each join (preload a second video, as ADR 0001 notes), loop region, playback rate, fullscreen preview.
Today: `useShortcuts` in `AdvancedEdit.tsx`; `Playback` class in `editor/playback.ts`; the playhead is quantized to 1/30 s.
Grill me on: which keys collide with existing item-focus shortcuts (←/→ already move items), whether a J/K/L shuttle is wanted, how a seamless join is done with two `<video>` elements, and whether the loop region is saved.
```

### 5. `transform-crop`
```
/grill-with-docs
[shared context]
Feature: transform and crop for Segments and Overlays at parity with Concat (`SetClipTransform`: scale 0.05–8, position, rotation, non-uniform stretch, flip H/V, opacity; `Crop` per-edge fractions; on-stage grips for corner scale, edge stretch and a rotation handle; smart guides to other pictures' edges).
Today: Overlays have x/y/size/opacity; media Segments only have `fit` fill|blur; Source Segments are framed automatically per Scene (Track/Split/Blur/Auto) with Layout Overrides; `StageEdit.tsx` does move/resize/snap.
Scope: a Transform on Overlays and media Segments; a manual reframe for Source Segments (pan/zoom box) and how it coexists with Layout and Layout Overrides (a new "Manual" Layout? per Segment or per Scene?); rotation and flip; crop; rounded corners/border/shadow for Overlays (beyond Concat); background colour behind a scaled-down Segment.
Overturns Out of Scope: rotation. Grill me on: the model (one `Transform` value object shared by Overlay and Segment?), ffmpeg graph (crop → scale → rotate with transparent fill → overlay), preview drawing in output pixels, and how a manual reframe survives face tracking.
```

### 6. `keyframes`
```
/grill-with-docs
[shared context]
Feature: keyframe animation at parity with Concat (`KeyProperty`: Scale, PositionX/Y, Rotation, Opacity, Volume, plus every numeric effect parameter; cubic-bezier easing with Linear/Ease in/Ease out/Ease in-out/custom; a keyframes pane with dopesheet and curve editor; diamond toggles in the inspector; diamonds on the ruler for the selected clip). Reference: `concat-core/src/animate.rs`, `ui/workspace/keyframes-pane.slint`.
Depends on `transform-crop`. Today only preset in/out animations exist (fade, pop, slide).
Overturns Out of Scope: keyframes (write an ADR).
Grill me on: which items get keyframes first (Overlays, Text Layers, media Segments, Music volume, Ken Burns on images), keyframe time base (relative to the item, so it survives a move), how the planner turns keys into ffmpeg expressions (overlay x/y expr, scale eval=frame, rotate expr, volume expr, or baked per-frame ASS `\move`/`\t` for text), how easing is sampled, preview interpolation in the frontend under ADR 0001 (the plan sends keys and easing, the frontend only interpolates), limits, and the MCP shape for keys.
```

### 7. `speed`
```
/grill-with-docs
[shared context]
Feature: speed at parity with Concat (constant speed 0.0625–16×, "change pitch with speed" toggle, reverse, freeze frame that inserts a still and ripples). Reference: `SetClipSpeed`, `concat-host/src/reverse.rs`, `Command::FreezeFrame`. Speed curves are out (Concat has no editor for them either).
Applies to Segments (Source and media) and probably Overlays.
Overturns Out of Scope: speed changes.
Grill me on: how a sped Segment's Timeline length is computed (`timeline_length`), what happens to captions and Word Edits of a sped Source Segment (retime Words by 1/speed?), Word snapping on trim, ffmpeg (`setpts`, chained `atempo` with or without `rubberband` for pitch), reverse (precomputed cached copy vs in-graph `reverse` memory limits), freeze frame as a new Segment kind (still of Source at time t, duration d), and the preview (`playbackRate`, reverse needs the cached copy).
```

### 8. `text-advanced`
```
/grill-with-docs
[shared context]
Feature: Text Layer styling at parity with Concat (`TextStyle`: stroke, drop shadow, background plate with radius and padding, line height, tracking, wrap width and fixed height, opacity, italic/weight; searchable font picker with font import; CJK and colour emoji fallback; 31 text presets stored as data plus user-saved presets; "use for new titles").
Today: `TextLayer` in `candidates.py` (font of 6 bundled, size, colour, outline, box, align, animation in/out); the planner strips emoji; 4 hard-coded `TEXT_PRESETS`; libass renders via ASS.
Scope: new style fields mapped to ASS (`\shad`, `\fsp`, `\frz`, `\bord`, box via BorderStyle 3 or a drawn `\p1` plate for radius), font upload into the font dir used by libass and the preview, Text Presets as a library (built-in + user, like Style Presets in `styles.py`), rotation on stage.
Overturns Out of Scope: text styles in presets, rotation. Grill me on: whether Text Presets join Style Presets or stay separate, emoji (libass has no colour emoji: render emoji as image Overlays?), line height in libass, licence checks on uploaded fonts, and preview fidelity.
```

### 9. `shapes`
```
/grill-with-docs
[shared context]
Feature: Shape layers at parity with Concat (`ShapeKind`: square, circle, triangle, parallelogram, trapezoid, line, arrow; fill, stroke, stroke width; on the Stickers page). Reference: `concat-project/src/model.rs` ShapeStyle.
Proposal: a new layer kind drawn with ASS vector drawing (`\p1`) so it renders through libass like Text Layers, with the same time, position, size, rotation, opacity and in/out animations.
Grill me on: whether shapes are a variant of Text Layer or their own list, rounded rectangles, layering order against Text Layers and Overlays (today: Segments < Overlays < Watermark < captions < Text Layers < hook), image stickers (a built-in PNG/GIF pack shipped as Media Library items?), and keyframes later.
```

### 10. `transitions-expanded`
```
/grill-with-docs
[shared context]
Feature: more transitions at parity with Concat's 20 (dissolve, blur dissolve, film burn, glitch, RGB split, light leak, push, slide, spin, swirl, clock wipe, iris, linear/shape wipe, whip pan, zoom, zoom blur). Reference: `concat-effects/packages/*`, `concat-render/src/transitions.rs`.
Today: `TransitionKind` with 10 ffmpeg xfade kinds; preview imitates them with CSS (`PreviewTransitions.tsx`).
Scope: expose most of ffmpeg's built-in xfade kinds (wiperight/up/down, dissolve, pixelize, radial, hblur, circleclose, squeeze, zoomin, diag*, hl/hr slices, fadegrays, distance…) grouped by category; decide which Concat looks (glitch, light leak, whip pan, spin) can be made with xfade `custom` expressions or a filter chain; "apply to all joins"; drag handles on the seam to resize; in/out transitions (animations) for Overlays.
Grill me on: the catalogue format (data vs enum), thumbnails/animated previews in the Transitions tab, preview fidelity per kind (CSS vs WebGL), and the duration bounds.
```

### 11. `color-adjust`
```
/grill-with-docs
[shared context]
Feature: colour at parity with Concat: an Adjust panel (temperature, tint, saturation, exposure, brightness, contrast, highlights, shadows, whites, blacks, sharpen, fade, vignette — `packages/concat.adjust/effect.toml`), filter "looks" in categories (Cinematic, Film, Retro, Portrait…), `.cube` LUT import, lift/gamma/gain wheels and curves (later), and adjustment-layer clips that grade everything beneath them over a span.
Applies to Segments (Source and media) and Overlays; a Job-wide or Candidate-wide grade is worth considering for podcasts.
Overturns Out of Scope: filters and effects (ADR).
Grill me on: the model (an `Adjust` value object + `look` id + LUT media), ffmpeg mapping (`eq`, `colortemperature`, `colorbalance`, `curves`, `unsharp`, `vignette`, `lut3d`), how looks are defined (data files of filter chains) and where LUTs live (Media Library kind?), the preview (CSS filters are too coarse: WebGL shader on the player canvas with the same maths, or server-rendered still for comparison?), and whether adjustment layers are a new track.
```

### 12. `video-effects`
```
/grill-with-docs
[shared context]
Feature: a per-clip effect chain at parity with Concat's 21 effects (sharpen, gaussian/motion/zoom blur, chromatic aberration, fisheye, pixelate, bloom pulse, halftone, film grain, glow, posterize, vignette, chroma key, luma key) with add/remove/bypass/reorder/intensity and starred favourites. Reference: `concat-effects/packages/*`, `ui/inspector/clip-inspector.slint`.
Depends on `color-adjust` (same chain, same preview approach).
Grill me on: which effects have a credible ffmpeg filter (`gblur`, `avgblur`, `noise`, `pixelize`, `chromakey`/`colorkey`, `lenscorrection`, `rgbashift`, `elbg`…) and which to drop, an Effects catalogue format (data packages: filter chain template + params + ranges), effect params as keyframeable later, blend modes for Overlays (`blend` filter: multiply/screen/add/lighten/darken), preview via WebGL, and render-time cost.
```

### 13. `background-removal`
```
/grill-with-docs
[shared context]
Feature: AI background removal on Segments and Overlays at parity with Concat (subject Auto/Person/Object with edge feather; smart brush with SlimSAM is a later step). Reference: `concat-vision/src/segment.rs`, `concat-host/src/cutout.rs`.
We already run mediapipe/onnx on Apple Silicon for faces. Options: mediapipe selfie segmentation, RVM (Robust Video Matting) via onnxruntime CoreML.
Use case: put the podcast speaker over a B-roll or a branded background.
Grill me on: precomputing a matte video (alpha mask cached per Source range) as a background job with progress vs on the fly, storage format (mask MP4 + `alphamerge`), the preview (play the cached mask in the browser via canvas compositing), the background options (colour, blur, image, another Segment), cost on long Sources, and the model download/licence.
```

### 14. `audio-mixing`
```
/grill-with-docs
[shared context]
Feature: audio mixing at parity with Concat: fades on Segments and on the Clip's own sound, detach audio from a Segment onto an audio lane (and reattach), mute a clip (M), per-track mute (from `track-controls`), a volume line on clips (from `timeline-visuals`), volume keyframes (from `keyframes`), save clip audio as WAV, and a meters view. Beyond Concat: auto-ducking of Music under speech (Concat lists it as an open request).
Today: `MusicClip` volume/fades, `source_volume`, per-Segment `volume`; render `amix` + two-pass loudnorm; preview Web Audio gain.
Overturns Out of Scope: auto-ducking.
Grill me on: what a detached Source audio item is in the model (Music Clips name Media Library items today: a new "source audio" Music Clip kind?), ducking from Words (we know when speech happens) vs `sidechaincompress`, fade shapes, and the preview of ducking.
```

### 15. `audio-effects`
```
/grill-with-docs
[shared context]
Feature: audio cleanup and effects per clip at parity with Concat: quick switches Reduce noise, Enhance voice, Normalize loudness, and 25 effect presets (voice: chipmunk, deep, megaphone, pitch, robot, whisper; space: echo, hall, room, stadium, underwater; tone: bass, treble, lo-fi, radio, telephone, vinyl…). Reference: `concat-effects/packages/concat.denoise`, `enhance-voice`, `loudness`, audio packages as ffmpeg filter-chain templates.
Applies to Segments (Source/media), Music Clips, voiceover.
Grill me on: ffmpeg chains (`afftdn`/`arnndn` with a bundled model, `highpass`+`equalizer`+`acompressor` for voice, `aecho`, `asetrate`+`atempo` for pitch), the catalogue format shared with video effects, preview (Web Audio approximations vs server-rendered audio preview), and interaction with the final loudnorm.
```

### 16. `voiceover`
```
/grill-with-docs
[shared context]
Feature: record a voiceover from the microphone at the playhead, at parity with Concat (`panes/voiceover.rs`: level meter, timeline sound held silent while recording, the take lands on an audio lane).
Plan: browser `MediaRecorder` → upload to the Media Library (normalised like other audio) → a Music Clip at the recording start.
Overturns Out of Scope: voiceover.
Grill me on: the phone flow, countdown, punch-in over an existing take, retakes, latency compensation, whether takes are Media Library items or Candidate-owned, and auto-applying "Enhance voice" from `audio-effects`.
```

### 17. `text-to-speech`
```
/grill-with-docs
[shared context]
Feature: local text-to-speech at parity with Concat (Kokoro with built-in speakers, speed and pauses; Pocket TTS voice cloning; models downloaded on demand and checked by SHA-256). Reference: `concat-speech/src/tts.rs`, `models/manifest.toml`.
Plan: a backend TTS job (Kokoro ONNX on Apple Silicon) producing audio into the Media Library, added as a Music Clip; optionally generate captions/Text Layers from the same script.
Grill me on: Indonesian voice support (Kokoro has none: alternatives such as an OpenAI-compatible TTS through the existing `LLM_PROVIDER` setup), model download UX, voice cloning ethics/consent, and whether the LLM may draft the narration from the Transcript.
```

### 18. `captions-advanced`
```
/grill-with-docs
[shared context]
Feature: captions in the Advanced Edit at parity with and beyond Concat (Whisper captions from any clip's voice or from a typed script, one title per phrase or per sentence, top/centre/bottom, three sizes).
Today: captions come only from Source Segment Words; Caption Style is edited only in the clip editor; the caption track is read-only; no SRT.
Scope: Caption Style controls inside the Advanced Edit inspector; transcribe Media Library videos (mlx-whisper) so media Segments and voiceovers get captions; retime a single caption line and move one line on its own; SRT/VTT export (and import?).
Overturns Out of Scope: transcribing uploaded videos.
Grill me on: where Words of a media item live (on the Media item, cached by id), how Word Edits key into media time, per-line overrides vs the current planner line breaking (`max_chars`, `max_words`…), and the caption language.
```

### 19. `export-settings`
```
/grill-with-docs
[shared context]
Feature: export settings at parity with Concat (codec H.264/HEVC (AV1 if videotoolbox allows), resolution 720p/1080p/1440p/4K, frame rate list, quality tiers High/Recommended/Smallest, advanced bitrate VBR/CBR, size estimate and time remaining; save the current frame as PNG; save audio only). Reference: `panes/export.rs`, `concat-media/src/encode.rs`.
Today: `RenderTuning` constants in `config.py` (h264_videotoolbox 8M/12M, fallback libx264 crf 20, 1080x1920, AAC 192k, loudnorm −14 LUFS); `POST /jobs/{id}/render` with `candidate_ids`.
Grill me on: per-render settings vs saved Export Presets (e.g. "TikTok", "YouTube Shorts", "Archive HEVC"), whether the planner must scale its pixel space (everything is in 1080x1920 output pixels), what "stale Clip" means when only the export settings change, loudness target choice, and the MCP `render_clips` parameters.
```

### 20. `canvas-aspect`
```
/grill-with-docs
[shared context]
Feature: canvas aspect ratio per Candidate (9:16, 1:1, 4:5, 16:9), at parity with Concat's project formats (16:9, 9:16, 1:1, 4:3, custom).
Today: 1080x1920 is hard-coded across `planner.py` (safe area x=950, y=232..1536), the Layouts (Track/Split/Blur), Style Presets positions, the preview SVG and `StageEdit.tsx` guides.
Grill me on: whether positions become fractions of the canvas or are rescaled, how the Layouts behave on 1:1 and 16:9, safe areas per platform, whether one Candidate can export several aspects at once (variants), and the migration of saved positions.
```

### 21. `templates`
```
/grill-with-docs
[shared context]
Feature: Templates — save an Advanced Edit (Text Layers, Music Clips, Overlays, Transitions style, intro/outro media Segments, Style Preset, effects) as a reusable Template and apply it to many Candidates at once, at parity with Concat's project templates (placeholder slots filled on instantiate; `concat-host/src/templates.rs`, `SetMediaPlaceholder`, `FillSlot`).
Why it matters most for ai-clipper: Selection produces many Candidates per Job; a branded intro, outro, lower-third and music bed should apply to all of them in one action, and survive each Candidate's different length.
Grill me on: what is a slot (the Candidate's own Source range as the main slot; text slots fed by hook/Kicker/title; media slots), anchoring rules so layers adapt to length (anchored to start, to end, or relative %), whether applying is a copy or a live link, conflict with existing edits, Templates via the Channel Profile as a default for new Jobs, and MCP tools (`list_templates`, `apply_template`).
```

### 22. `workspace-layout`
```
/grill-with-docs
[shared context]
Feature: a flexible desktop workspace for the Advanced Edit, a lighter take on Concat's dockable workspace (`src/crates/concat/src/dock.rs`, `ui/workspace/*.slint`: Monitor, Timeline, Library, Inspector, Keyframes, Meters and Config panels, split/add/remove, compact dock under 860 px). Full drag-to-dock is out of scope.
Today: a fixed CSS grid in `AdvancedEdit.tsx` (≥64rem: asset panel | player | inspector over the timeline; phone: player, timeline, toolbar and bottom sheets via `Chrome.tsx`).
Scope:
- Drag dividers to resize the sidebars and the timeline height, with sensible minimums and double-click to reset.
- Collapse or expand the asset panel and the inspector (buttons and shortcuts), so the player and timeline can use the whole width.
- A tabbed bottom area (Timeline, plus Keyframes and Meters once those features exist), designed now so later features slot in without rewriting the shell.
- Remember the layout per browser (localStorage, wrapped in try/catch); the phone layout is unchanged.
Grill me on: which panels are fixed vs optional, whether the timeline and the keyframes view are side-by-side or tabs, how the player scales when panels resize (the stage is drawn in 1080x1920 output pixels), keyboard access and focus order for the dividers, persistence per browser vs per user (backend settings), and whether to use a library (e.g. react-resizable-panels) or a small own implementation matching the codebase's no-dependency style.
```

---

## E. Verifikasi (saat nanti dieksekusi per fitur)

- Backend: `uv run pytest backend/tests/test_<area>.py` pada Seam B (planner) dan Seam A (HTTP + ffmpeg nyata, misalnya frame di tengah efek berbeda dari input). Full suite di akhir.
- Frontend: `npm run typecheck && npm run build`, lalu walkthrough di browser (skill `run`/`ego-browser`) untuk desktop dan phone.
- MCP: `edit_candidate` dengan `dry_run=true` menampilkan field baru di Preview Plan; `render_clips` → `list_clips` menghasilkan MP4 yang benar.
- Setiap ticket ditutup dengan `/code-review` dan `**Status:** done` plus `## Comments` sesuai `docs/agents/issue-tracker.md`.
