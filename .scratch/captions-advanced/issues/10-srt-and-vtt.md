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

**Status:** ready-for-agent

- [ ] Pure: the writer's output for given Cues (two-line cues, times past an hour, punctuation and case kept, VTT header) equals expected text.
- [ ] HTTP and real ffmpeg: a render writes both files, whose cues match the plan's Cues. With an uppercase Caption Style the files keep the original case.
- [ ] A Job with captions off writes neither. Deleting a Clip removes them.
- [ ] HTTP: the download endpoint returns SRT and VTT for an unrendered Candidate, and refuses while a Segment is pending.
- [ ] Browser walkthrough: download from the Advanced Edit and from the Clips list.
