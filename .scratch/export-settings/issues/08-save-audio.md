# 08: Save audio as WAV or M4A

**Parent spec:** `../spec.md` (Solution "Save audio"; Implementation Decisions "API": audio, export file names; "MCP"; "Frontend"); GLOSSARY (Export file).

**What to build:** I save a Candidate's mix on its own, as it would sound in its Clip.
- **`POST /jobs/{job}/candidates/{id}/audio`** takes `{format: wav|m4a, export_preset_id?}`.
  - It renders the saved Revision's audio graph alone: the Clip's sound, Music Clips, Overlay and media Segment sound, volumes, Keyframes, fades and Speed.
  - Loudness is the Preset's (the default Preset's when none is given).
  - WAV is 48 kHz 16-bit; M4A is AAC 192k.
  - It writes `<candidate>.wav` or `<candidate>.m4a` to the Job's `exports/`, overwriting it, and returns its path and a download URL.
  - It is synchronous, outside the render queue. Cached analysis only; Retimed copies are made when needed.
- **"Save audio"** (WAV or M4A, with the picked Preset) is in the Clip's and the Candidate's actions. It downloads the file named after the Candidate's title.
- **MCP:** `export_audio(job_id, candidate_id, format="wav", export_preset_id=None)` returns `{path}`.

**Blocked by:** 04

**Status:** done

- [x] The WAV is 48 kHz 16-bit with the Clip's duration, and the M4A is AAC.
- [x] With a −14 Preset it measures near −14 LUFS. With "Archive" (off) a quiet tone stays quiet.
- [x] A Music Clip's fade and a reversed media Segment's sound are heard as in the Clip.
- [x] The Job's status and its render queue are unchanged by it.
- [x] `export_audio` returns a path to the file on this Mac.

## Comments

**2026-10-19, agent:** Built.
- **Renderer** (`app/renderer.py`): the sound graph that the encode and the measuring pass built separately is now one helper, `_sound(plan, source, files, rate, between)` (the Source's or Segments' inputs, the songs' inputs after `between` others, and the mix ending in the link it is heard from), and loudnorm's second pass is `_normalized(tuning, lufs, measured)`. `_measure` and `_command` use both (the encode's command is unchanged). `Renderer.render_audio(source, plan, audio, kind, lufs, files)` uses them too: measure (unless loudness is off), then one ffmpeg that decodes no picture and writes `pcm_s16le` WAV or AAC 192k in MP4 (`.m4a`), under a `.part` name then renamed. `AudioFormat = Literal["wav", "m4a"]`.
- **`app/saved_audio.py`** (new): `EXPORTS_DIR = "exports"`, `audio_file(candidate_id, kind)` and `save_audio(...)`: plans the saved Revision with `candidate_plan` with no Words and no analysis (neither changes the sound, so "cached analysis only" holds trivially), drops the Overlays' pictures (their sound is in `plan.audio`), and reads reversed Segments' and Overlays' sound from full-size Retimed copies, made when missing. A separate `Renderer` instance runs it with `subprocess.run`, so it never touches the render worker's process or queue.
- **`app/rendering.py`**: the render worker's "media files and Retimed copies" step is now `played_files(plan, job_dir, source, media, ffmpeg, progress)`, reused by Save audio.
- **API**: `POST /jobs/{job}/candidates/{id}/audio` `{format: wav|m4a = wav, export_preset_id?}` → `{path, url}` (`url` is `/media/<job>/exports/<id>.<ext>?v=<mtime>`). 404 for an unknown Job or Candidate, 409 without Candidates, 422 for a bad format or an unknown Preset (refused, not silently the default as for a Clip's deleted Preset). `.wav` added to `MEDIA_SUFFIXES`, so the Job's media route serves it.
- **MCP**: `export_audio(job_id, candidate_id, format="wav", export_preset_id=None)` → `{path}`. TOOLS_BUDGET_BYTES 69_250 → 69_850.
- **Frontend**: `pages/job/SaveAudio.tsx`: `SaveAudioButton` (a popover menu, WAV / M4A, like the Render button's) and `saveAudio()`, which posts and then clicks a link whose `download` is named after the Candidate's title. The Clip card's uses that Clip's Preset (`againPreset`); the clip editor header's (the Candidate's actions, next to Revision History) uses the Preset picked on the Render button. `downloadName(title, id, ext)` moved to `format.ts` (the Clip's MP4 download uses it too).
- **For merging with 07**: 07 also writes to `exports/`; if it defines its own EXPORTS_DIR, keep one.
- Tests: `backend/tests/test_save_audio.py` (WAV 48 kHz s16 with the Clip's length at −14 LUFS by default, served by its URL; M4A AAC; overwritten; the Job stays in review with no Clips; Archive leaves a −30 dB tone under −40 LUFS while Shorts brings it to −14; a reversed counter Segment's sweep falls, and a song's 1 s fade-out halves at its middle and is gone after; its Retimed copy made; refusals; MCP `export_audio`) and `frontend/src/pages/job/SaveAudio.test.tsx` (download names, the menu's markup).
