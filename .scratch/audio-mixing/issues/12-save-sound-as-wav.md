# 12: Save sound as WAV

**Parent spec:** `spec.md` in this feature folder (user stories 50–53; Solution "Save sound as WAV"; Implementation Decisions "Save sound as WAV"); GLOSSARY "Segment", "Music Clip", "Overlay".

**What to build:** from the context menu of a Segment, a Music Clip or a video Overlay, the owner saves that item's sound as a WAV file. It is the item alone as it is heard in the Clip (with unsaved edits), and the browser downloads it.

- **Endpoint.** It takes the Candidate's draft edits (as the Preview Plan does) and an item id. It returns `audio/wav`, 48 kHz stereo 16-bit PCM, with a download filename made from the Candidate and the item.
- **What is rendered:**
  - Included: the item's range, Speed, pitch and Reverse, volume or Keyframes, fades, and `source_volume` for the Source's sound.
  - Left out: Muted, the Track mute, Ducking and the loudness passes.
  - It reuses the renderer's own sound chains, not a copy of them.
- **Refused:** a Freeze frame, an image, an item without sound, and an id the draft doesn't have.
- **Editor.** "Save sound as WAV" on those items' context menus (desktop). It shows progress while the file is made, and an error notice if it fails.

**Blocked by:** 04, 07, 08.

**Status:** done

- [x] A Source Segment's WAV is PCM at 48 kHz, as long as its Timeline length, with its fade in audible (tone).
- [x] A 2× Music Clip's WAV is half its read length; a Music Clip of the Source's WAV is the episode's sound at `source_volume`.
- [x] A Muted item's WAV is not silent; a ducked Music Clip's WAV is not ducked.
- [x] Unsaved draft edits (a changed volume) are in the WAV.
- [x] A Freeze frame, an image Overlay and an unknown id are refused.
- [x] The context menu item downloads the file in the browser.

## Comments

**2026-10-18: done.**

**What was built:**
- **Endpoint.** `POST /api/jobs/{job}/candidates/{candidate}/sound/{kind}/{item}`. `kind` is `segment`, `music` or `overlay`, because ids are unique only within a kind. The body is the draft, as `/preview-plan` takes it.
  - Both routes now share `_drafted` (`api.py`), which applies the draft as an update would, without saving it.
  - The answer is a `FileResponse`: `audio/wav`, `pcm_s16le` at the render's `audio_rate` (48 kHz), stereo. It is made in a `.sound-*` folder of the Job's directory, which is removed once the file is sent.
  - Its `Content-Disposition` name is "<Candidate title> - <item>.wav". The item is "Segment N", the song's name, "the episode's sound", or "Overlay <video>". The characters that file systems refuse are taken out, as `Clips.tsx` does for a Clip.
  - 404 for an id the draft hasn't, including an item the draft removed.
  - 422 for a Freeze frame, an image Overlay, a video without sound, an Overlay with no sound in the plan (volume 0 and unkeyed), a Music Clip whose song is gone, an invalid draft, and an invalid kind.
- **`app/item_sound.py`.**
  - `save_item_sound` plans the draft with `rendering.candidate_plan`, without Words or analysis.
  - `_alone` keeps only the item's own `SegmentPlan` or `AudioEvent`. It drops the Transitions and every other sound. A Clip that isn't cut is its one Segment, `main`.
  - `_from_start` moves the kept item to 0 s and unmutes it.
  - A Music Clip's event is the first in the plan's `audio` with its id and media. An Overlay's is the last, because the Overlays' sounds follow the Music Clips.
  - A reversed item reads its full-size Retimed copy (`read_from_copies`, made if missing), as a render's does. Only the kept item's copy is made.
- **`Renderer.save_sound`** uses the render's own builders:
  - A Segment, or the Clip's one range, goes through `_source_inputs`, then `_audio_mix` without music.
  - A Music Clip or an Overlay's sound goes through `_music_inputs` and `_audio_mix`. It is mixed over `anullsrc` as long as it, in place of the Clip's own sound.
  - No loudness pass runs. `renderer.py` has no other change.
- **Editor.**
  - **The menu.** Right-clicking a Segment, Music Clip or Overlay on the desktop Timeline opens a context menu (`ItemMenu.tsx`).
    - It is a `popover="auto"` at the pointer, kept inside the window, with its first entry focused.
    - ↑ and ↓ move between entries. Escape or a click elsewhere closes it, and its keys don't reach the editor's shortcuts.
  - **The wiring.**
    - `TimelineItem` takes `onMenu`. A right-click picks the item alone, unless it is already in the Pick.
    - The keyboard's menu key opens the menu at the item's corner.
    - `Tracks` takes `onItemMenu`, which `AdvancedEdit` passes only when `wide`.
  - **The entry.** The menu's one entry is "Save sound as WAV" (`SoundMenu`).
    - It is off, saying why, on a Freeze frame, an image, a silent video or an Overlay at volume 0 (`itemSound.ts`).
    - It is also off while another WAV is being made.
  - **Saving.**
    - It posts `draft`, not `heardDraft`, so the Track mutes are left out.
    - While the WAV is made, a busy notice with a spinner shows. `ChangeNotice` gained `busy`; such a notice stays until the next one.
    - The browser then downloads the file through an object URL and `<a download>`, named from its `Content-Disposition` (`attachmentName`).
    - The last notice is "Saved a WAV of …" or "Couldn't save a WAV of …: <reason>".
  - `api.saveSound` and the `SoundKind` type are in `api.ts`.
- **Tests.**
  - `backend/tests/test_item_sound.py` (5, Seam A, real ffmpeg):
    - **A Muted Source Segment faded in over 1 s:** 48 kHz stereo s16 PCM, as long as its Timeline length. Its level at ¼, ½ and ¾ of the fade is within 0.5 dB, and it isn't silent.
    - **A Clip not cut, as `main`:** an unsaved `source_volume` of 0.5 in the draft is heard 6 dB down.
    - **A 2× song Music Clip:** lasts half its read, at its pitch.
    - **A reversed song Music Clip:** read from its copy.
    - **A Music Clip of the Source:** 6 dB down at `source_volume` 0.5, and at its own volume of 0.5 in the draft.
    - **A Muted video Overlay:** heard while it shows.
    - **The refusals.**
  - `frontend/src/pages/job/advanced/itemSound.test.ts` (6):
    - which items offer the entry, and why not;
    - the request, through a stubbed `fetch`;
    - the refusal's message;
    - the file name.
- **Browser check.** The built app ran on a copy of a real Job, in Chrome at 1440 px.
  - Right-clicking a Segment and choosing "Save sound as WAV" downloaded `Gojek Adalah Kita Solidaritas Driver yang Menginspirasi - Segment 1.wav`: 48 kHz stereo 16-bit PCM.
  - Escape closed the menu, and Enter chose the focused entry.
  - A failing request showed the error notice.

**Decided differently / left for later:**
- **Ducking (10) isn't in this branch yet.** "A ducked Music Clip's WAV is not ducked" holds for now only because no duck exists. When 10 merges:
  - If the duck lives on `AudioEvent` (its ducked spans, say), `_from_start` must clear it, since `Renderer.save_sound` goes through `_audio_mix`.
  - Add a test that a ducked Music Clip's WAV is as loud as with `duck` off.
- **The context menu is new here.** 09 also puts "Detach audio" on a Segment's context menu. On merging, add it as another `MenuEntry` in `AdvancedEdit.tsx`. `ItemMenu` already takes any list of entries; `SoundMenu` can then become a general item menu.
- **The progress is a spinner, not a share.** The WAV is made inside the request. A reversed item's copy, made on first use, can take a while.
- **No phone entry** (14).
