# 17: Upload master file

**Parent spec:** `spec.md` in this feature folder (Milestone M5; user stories 75–76; Video Source upload implementation).

**What to build:** Home gets an Upload option: I drag-drop or pick a master file, and it streams to disk with a progress bar. The Job transcribes the whole episode locally and reaches `review`. From there everything works exactly like a URL Job.

**Blocked by:** 03 (Full local transcription fallback), 10 (Home & live progress UI).

**Status:** ready-for-agent

- [ ] Multipart uploads are streamed to disk without buffering the whole file in memory. The UI shows upload progress.
- [ ] An upload is refused up front, with a clear message, when free disk space is insufficient.
- [ ] The upload implementation of Video Source returns the stored file and its metadata, with no captions, so full local transcription runs.
- [ ] When the master's codec can't play in the browser (for example ProRes or HEVC), a 720p H.264 preview proxy is generated for Review. Rendering still uses the master.
- [ ] Seam A test: uploading the fixture through the API, with a fake Transcriber, gets the Job to `review`.
- [ ] Browser check: upload a real file and reach Review.
