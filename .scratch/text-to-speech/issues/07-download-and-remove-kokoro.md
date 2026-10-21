# 07: Download and remove Kokoro's model

**Parent spec:** `spec.md` in this feature folder (User Stories 39–44; Implementation Decisions "Kokoro download", "HTTP API" (download, remove)); ADR 0019.

**What to build:** the engine picker lists Kokoro ("On this Mac") with "Download Kokoro (132 MB)" while its model isn't here. The download shows progress, can be cancelled, resumes after an interruption, and is checked before Kokoro counts as installed. "Remove Kokoro (132 MB)" deletes it. Kokoro can't read yet (ticket 08); once downloaded it shows as installed.

- **Pinned source.** One archive URL (sherpa-onnx's Kokoro int8 multi-language v1.0) and its SHA-256, pinned in code after checking them.
- **Resume.** Writes a `.part` file under `DATA_DIR/models`, resumed with an HTTP Range request.
- **Check and install.** A digest mismatch deletes the file and reports failed. The archive is unpacked into a staging folder and renamed into place. Members whose paths escape it are refused.
- **HTTP.** `POST /api/voices/kokoro/download` starts it, `DELETE` on the same path cancels it, and `DELETE /api/voices/kokoro` removes the model (409 while a Narration or sample is being made). `GET /api/voices` carries the state: absent, downloading (bytes done and total), ready, or failed with a message. The tab polls it while downloading.
- **One download at a time,** in its own thread, apart from the runner.

**Blocked by:** 03.

**Status:** ready-for-agent

- [ ] Local server: a good archive is fetched, checked, unpacked and reported ready.
- [ ] Local server: a wrong digest deletes the file and reports failed.
- [ ] Local server: an interrupted download resumes with a Range request from the `.part` size.
- [ ] An archive member escaping the folder is refused, and nothing is installed.
- [ ] Cancel leaves the `.part` for a later resume and reports absent.
- [ ] Remove deletes the model; it is refused while a Narration runs.
- [ ] Vitest: the Download / progress / Cancel / Remove states of the picker.
