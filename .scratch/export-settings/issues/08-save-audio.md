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

**Status:** ready-for-agent

- [ ] The WAV is 48 kHz 16-bit with the Clip's duration, and the M4A is AAC.
- [ ] With a −14 Preset it measures near −14 LUFS. With "Archive" (off) a quiet tone stays quiet.
- [ ] A Music Clip's fade and a reversed media Segment's sound are heard as in the Clip.
- [ ] The Job's status and its render queue are unchanged by it.
- [ ] `export_audio` returns a path to the file on this Mac.
