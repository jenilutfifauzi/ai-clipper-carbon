# 10: SRT and VTT caption files

**Parent spec:** `../spec.md` (Rendering: caption files, downloads); user stories 41–45.

**What to build:** every render writes subtitles beside the video, and the editor can download them for any Candidate.

**The writer:** a pure writer turns a plan's Cues into SRT and VTT:
- cues numbered in order;
- the Cue's shown start and end;
- its `plain` lines (the words' own case and punctuation, with Word Edits);
- VTT gets its `WEBVTT` header.

**Sidecars:**
- Every render writes `<clip>.srt` and `<clip>.vtt` beside the MP4.
- The Clip record lists them, and the API serves them.
- Deleting the Clip deletes them.
- A Job with captions off writes none.

**Downloads:**
- An endpoint returns a Candidate's SRT or VTT from its saved state's Preview Plan. It refuses while any captioned Segment is pending.
- The Advanced Edit's menu and the Clips list offer the downloads.

**Blocked by:** 01.

**Status:** done

- [x] Pure: the writer's output for given Cues (two-line cues, times past an hour, punctuation and case kept, VTT header) equals expected text.
- [x] HTTP and real ffmpeg: a render writes both files, whose cues match the plan's Cues. With an uppercase Caption Style the files keep the original case.
- [x] A Job with captions off writes neither. Deleting a Clip removes them.
- [x] HTTP: the download endpoint returns SRT and VTT for an unrendered Candidate, and refuses while a Segment is pending.
- [x] Browser walkthrough: download from the Advanced Edit and from the Clips list.

## Comments

**2026-10-19, agent:** Done, with one hook left for ticket 04.

- Writer: `app/caption_files.py`, `caption_file(cues, CaptionFormat.SRT | CaptionFormat.VTT) -> str`. Entries sharing a key that touch (a Cue split at a Layout change) are written as one subtitle cue. A Cue with no plain text left is skipped. VTT escapes `&`, `<` and `>`. No Cues gives an empty SRT and a bare `WEBVTT` header.
- Sidecars: a render writes `clips/<candidate>.srt` and `.vtt` beside the MP4 (`caption_paths` in `app/clips.py`). `RenderedClip.srt` and `.vtt` hold their paths relative to the Job directory, or null with captions off. `/media/{job}/{path}` serves them as `application/x-subrip` and `text/vtt`. There is no per-Clip delete: a Clip's files go with its Job (tested) and are replaced on a re-render.
- Download: `GET /api/jobs/{job}/candidates/{candidate}/captions/{srt|vtt}` builds the file from the saved Preview Plan. It returns 409 with captions off, without Candidates, or while `editor.captions_pending(preview)` is true; 404 for an unknown Job or Candidate; 422 for any other format.
- **Hook for 04:** `captions_pending` in `app/editor.py` always returns False for now, because no Words status exists on this branch yet. When ticket 04 adds the per-Segment `pending` status, this function should read it. The HTTP test for the refusal monkeypatches the hook, so the "refuses while pending" box covers the 409 path only, not a real pending Segment.
- Frontend: a shared popover menu `components/Menu.tsx` (`useMenu`, `Menu`, `MenuItem`), taken from the TextPresets menu, which now uses it. `pages/job/downloads.ts` has `clipFileName` and `saveText`. The Advanced Edit top bar has a Downloads menu (Captions .srt / .vtt from the endpoint) when the Job has captions; its items wait while an edit is still saving. Each Clips list card has SRT and VTT links to the rendered files.
- Browser walkthrough on a copy of Job 7f52281ef592: SRT downloaded from the Clips list and VTT from the Advanced Edit menu, both named after the title. A sibling agent's server shared that copy and added a media Segment during the walkthrough. The Advanced Edit VTT followed that saved state, with cues starting at 6 s, while the rendered SRT started at 0 s.

**2026-10-19, orchestrator:** On merging with ticket 04, `captions_pending` reads the Preview Plan's `words_status` (true while any Segment is `pending`), and the captions endpoint passes the Media Words store to `preview_plan`. The monkeypatched test is gone; `test_media_words.py` now asks for the SRT while a held transcription is pending and gets the 409.
