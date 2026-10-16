# 01: A keyed image Overlay, end to end

**Parent spec:** `spec.md` in this feature folder (user stories 1–4, 8–10, 42–43, 45–48; Implementation Decisions "The Candidate model", "One sampling module, twice", "Planner", "Renderer", "Preview", "MCP"); docs/adr/0008-keyframes-for-pictures-and-sound.md.

**What to build:** the agent can animate an image Overlay's position, scale, rotation and opacity with Keyframes and Eases. The preview plays the motion, and the rendered Clip moves the same way. There is no editor UI for Keyframes yet (06): this is driven through MCP and the API. Video Overlays and decoration on keyed pictures come in 02.

- **Model.** The Ease and Keyframe value objects, and `keys` on the Overlay for `x`, `y`, `scale`, `rotation` and `opacity`. The spec's validation: properties allowed, sorted, one frame apart, at most 100, `at` within the Overlay, values in range, the Ease tidied. An Ease is accepted as a preset's name or four numbers, and stored as four numbers.
- **The sampling module,** in the backend and the frontend: the value at a time, and the bezier solver. Both test suites read one shared fixture of Ease vectors.
- **Planner.** A keyed Overlay's picture carries its motion (a track per keyed property, in Timeline time) and its drawn size at scale 1. A keyed picture is planned whole, not trimmed to the frame.
- **Renderer.** The renderer can take raw RGBA inputs from pipes. A new Python frame process draws a keyed image Overlay for each output frame with OpenCV: crop, sampled size, flips, rotation, opacity, and a 2 px transparent margin. ffmpeg lays it over with straight alpha where today's picture chain goes. OpenCV becomes a declared dependency. An unkeyed Overlay keeps today's chain.
- **Preview.** A keyed Overlay samples its motion on every frame of the playback clock and writes its styles directly, outside React's render. The Grips and Smart Guides use its bounds at the playhead.
- **MCP.**
  - `keys` in the edit tools, merged by property in `merge_candidate_items`.
  - A change of the Overlay's `start` or `secs` that strands a Keyframe is refused, with a message naming it.
  - The dry run lists the Keyframes in Timeline time and the bounds at each.
  - The instructions get the Keyframes paragraph.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] Seam K:
  - [x] each preset and some Custom Eases (one overshooting) at x 0, 0.25, 0.5, 0.75 and 1, within 1e-6, in pytest and vitest from the shared fixture;
  - [x] the value before the first Keyframe, after the last, between two, and at two a frame apart.
- [x] Seam B:
  - [x] an Overlay keyed in `scale` 1 → 2 plans a scale track at its start plus each `at`, with its drawn size at scale 1;
  - [x] a keyed zoomed picture is planned whole.
- [x] Seam A, real ffmpeg:
  - [x] an image Overlay keyed in `x` 200 → 800 over 2 s, Ease in-out, has its centre at 500 ± 2 px in the frame at 1 s;
  - [x] held at 0.5 opacity and 90°, it matches the static chain's frame above a set PSNR;
  - [x] an unkeyed Clip's ffmpeg command is unchanged.
- [x] Seam A, HTTP and MCP:
  - [x] Keyframes a frame apart are accepted, closer ones refused;
  - [x] a 101st Keyframe, an `at` past the Overlay and an out-of-range value are refused;
  - [x] an MCP change of `secs` that strands a Keyframe is refused, naming it;
  - [x] a merge with only opacity Keyframes keeps the scale Keyframes;
  - [x] `ease_out` is stored as four numbers;
  - [x] the dry run lists the Keyframes and their bounds.
- [ ] The preview's motion matches the rendered Clip at a few times (checked by hand on one Clip). Checked by tests only (see Comments); the look in the browser is left for 11's walkthrough.
- [x] `pytest`, `npm run typecheck`, `npm test` and `npm run build` pass.

## Comments

**2026-10-16: done, but for the check by hand.** Built at each seam test first, in `backend/tests/test_keyframes.py` and the frontend's `keyframes.test.ts`, `picture.test.ts` and `smartGuides.test.ts`.

- **Model.** `backend/app/candidates.py` has `Ease` (a NamedTuple of four numbers, so it is stored and sent as `[x1, y1, x2, y2]`), the presets `LINEAR`, `EASE_IN`, `EASE_OUT`, `EASE_IN_OUT` and `EASES` by name, `tidy_ease`, `ease_name` (a preset within 0.005), and `EaseField`, which takes a name or four numbers and keeps the tidied numbers (its JSON schema says both). `Keyframe(at, value, ease)`, `KeyProperty` (x, y, scale, rotation, opacity and volume), `PICTURE_KEYS`, `KEY_RANGES`, `Keys` (a dict from property to its list) and `checked_keys(keys, item, allowed, length)`, which sorts, clamps x and y, drops empty lists, and raises a ValueError naming the item, property and time for the rest. `Overlay.keys` is checked in `Overlay.__post_init__` against `PICTURE_KEYS` and its `secs`, so the API, MCP and a stored Job all go through it; pydantic turns the ValueError into a 422. A gap of a frame less half a millisecond is accepted (times come rounded); an `at` up to a millisecond past the length is too.
- **The sampling module** is `backend/app/keyframes.py` (`value_at(keys, time, constant)`, `eased`, `bezier_y_at_x`, Concat's solver) and `frontend/src/pages/job/editor/keyframes.ts` (`valueAt`, `eased`, `bezierYAtX`, and the presets). The shared fixture is `backend/tests/fixtures/ease_vectors.json`: the four presets, a Custom Ease, an overshooting one and one that goes under and over, solved exactly (rational bisection) by a throwaway script. The frontend imports it as JSON.
- **Planner.** `Picture` gained `motion` (Keys in Timeline time) and `unscaled` (the drawn size at scale 1: fitted crop times stretch, unrounded). `moving(picture, transform, keys, start)` sets them for an Overlay; its other fields stay at the constants. `picture_at(picture, time)` is the one rule for a keyed picture at a time: sampled values held to their ranges (rotation free), sizes in fractions of a pixel, bounds turned about the sampled centre, motion dropped. `key_times(picture)` gives the instants with any Keyframe. `on_frame` gives a keyed picture back whole. A second shared fixture, `backend/tests/fixtures/keyed_picture.json` (a Picture keyed in all five properties, flipped and stretched, and `picture_at` at ten times), pins the frontend's `pictureAt` to it.
- **Renderer.** `backend/app/frames.py`: `PictureFrames(picture, image).draw(time)` crops and flips the item once, then for each frame takes only the part on the frame (and a few pixels round it), resizes it to its sampled size (INTER_AREA when both sides shrink, else bilinear), pads it with 2 px of its edge colour at alpha 0, and `warpAffine`s it into its bounding box of one reused 1080×1920 RGBA canvas (the previous box cleared), alpha times opacity. `FrameFeed` owns an `os.pipe()` and a writer thread. In `renderer.py`, `render()` reads each keyed image once (`_keyed_items`, `read_image`), makes fresh feeds for each encoder tried (`_feeds`), `_command(..., feeds)` gives each a `-f rawvideo -pixel_format rgba -video_size 1080x1920 -framerate <fps> -i pipe:<fd>` input and lays it with `setpts=PTS-STARTPTS+<first frame>` and `overlay=0:0:enable=…:eof_action=pass` where the still chain's result would go, and `_run` passes the fds (`pass_fds`), starts the writers after Popen, and always kills a live ffmpeg and joins them. A writer that raises kills ffmpeg and its error is the encode's ("A keyed picture couldn't be drawn: …"); ffmpeg dying makes the writers stop at their next write. `opencv-contrib-python` is declared in `pyproject.toml` (and `uv.lock`).
- **Preview.** `pictureAt`, `isKeyed` and `overlaysAt` are in `frontend/src/pages/job/editor/picture.ts`. `PicturePanel` takes `playback`; for a keyed picture it renders at `playback.shownTime` and repaints its box, turn, opacity and corners from a `playback.subscribe` callback, outside React's render. `PreviewOverlays` passes the playback. `picturesAt` (the Smart Guides' targets) samples at the playhead. `ClipPreview` builds the stage's pictures (handles and Grips) from `overlaysAt(plan, time)` via `useKeyedTime`: the playhead's time while paused, the last paused time while playing. `Overlay.keys` is required in `api.ts` (a new Overlay has `{}`); `Picture.motion` and `unscaled` are optional.
- **MCP.** `keys` comes in through `_patch_model` as a dict field, and `_merged_fields` already merges a dict into a dict key by key, so a property given replaces its list and `[]` clears it. A stranding `secs` comes back as the model's message ("Overlay o1's scale Keyframe at 1 s is past its length of 0.8 s; send its keys too"). `_plan_view`'s Overlays get `keys` (Timeline time, preset names or numbers) and `bounds_at_keys` (`_motion_view`, through `picture_at`). The instructions got the Keyframes paragraph. The tool list is 58.2 kB of its 60 kB budget (55.6 kB before).

Choices:
- **OpenCV is the contrib build,** not the headless one the spec names: mediapipe already depends on `opencv-contrib-python`, and a second OpenCV package would install over the same `cv2`.
- **A keyed Clip's frames are brought to its frame rate** (`fps=<rate>` on the joined frames, only when there is a frame process), so that frame n is at n / fps exactly, the time its picture is sampled at, and the rawvideo input shares that timebase. Without it the Source's own frame times (a seek lands up to a frame off n / fps) put the picture up to a frame off, 20 px on the test's slide. This can move the picture up to half a frame against the sound.
- **Keyed video Overlays and keyed decorated Overlays are refused for now** (`_check_media_of` in `api.py`), rather than drawn wrong: the frame process draws only a still, undecorated image. 02 lifts both refusals.
- **A volume Keyframe on any Overlay is refused** (the Overlay's allowed properties are `PICTURE_KEYS`); 03 adds volume for videos.
- **Sampled values are held to their ranges** (an overshooting Ease can't take opacity past 1 or a centre off the frame), in both copies.
- **An unkeyed Clip's command is pinned by a golden file,** `backend/tests/fixtures/unkeyed_command.json`, made from the code before this ticket (an image and a video Overlay, a Music Clip and a hook).

Measured on this Mac (VideoToolbox, a 30 s 1920×1080 Source, no captions): no Overlay 5.1× realtime, a still image Overlay 5.3×, the same image keyed in scale, x, rotation and opacity 2.0×. Drawing alone is 4.8 ms a frame; the rest is ffmpeg reading, converting and laying a whole RGBA frame each frame. The held 90°, 0.5 opacity picture is 48.4 dB PSNR from the still chain's over its box (the test's bar is 32 dB).

Not checked by hand: the preview playing a keyed Overlay in the browser against its rendered Clip. What stands in for it: the render test measures the rendered centre at five frame times against `value_at`, and `keyed_picture.json` holds the frontend's `pictureAt` to the backend's `picture_at` at ten times (centre, size, turn, opacity and bounds). Not tried: the Grips on a keyed Overlay while playing (they stay where it was when play started), and an owner's trim of an Overlay keyed by the agent, which the server now refuses when it strands a Keyframe until 07 re-anchors them in the editor.
